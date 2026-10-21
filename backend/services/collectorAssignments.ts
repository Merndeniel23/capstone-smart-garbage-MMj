import type { PoolConnection } from "mysql2/promise";
import type { AuthUser } from "../middleware/auth.js";
import { db } from "../config/db.js";
import { DomainError, revisionsEnabled } from "./sgms.js";
import { inspectPhase1Schema } from "./phase1Schema.js";

export const phase1Configured = () => revisionsEnabled() && process.env.SGMS_PHASE1_ENABLED === "true";
let dependenciesReady = false, checkedAt = 0;
let checking: Promise<boolean> | null = null;
export const phase1Enabled = () => phase1Configured() && dependenciesReady;
export async function phase1Ready(connection?: PoolConnection): Promise<boolean> {
  if (!phase1Configured()) return false;
  if (Date.now() - checkedAt < 10_000) return dependenciesReady;
  const inspect = async () => {
    try { dependenciesReady = (await inspectPhase1Schema(connection)).ready; }
    catch { dependenciesReady = false; } // Never expose raw DB/configuration errors.
    checkedAt = Date.now();
    return dependenciesReady;
  };
  // A caller already holding a transaction must not wait for another pooled
  // connection: inspect on its own connection instead of starving the pool.
  if (connection) return inspect();
  if (!checking) checking = inspect().finally(() => { checking = null; });
  return checking!;
}

// Columns are fixed SQL identifiers supplied by routes, never request input.
export function collectorPurokScope(user: Pick<AuthUser, "id" | "role" | "barangay_id">, column: string) {
  if (user.role !== "collector") return { sql: "1=1", values: [] as number[] };
  // No migration/configuration must never mean barangay-wide collector access.
  if (!phase1Enabled() || !user.barangay_id) return { sql: "0=1", values: [] as number[] };
  return {
    sql: `EXISTS (SELECT 1 FROM collector_purok_assignments cpa JOIN puroks assigned_p ON assigned_p.id = cpa.purok_id
      WHERE cpa.collector_id = ? AND cpa.is_active = 1 AND cpa.purok_id = ${column}
        AND assigned_p.barangay_id = ? AND assigned_p.archived_at IS NULL)`,
    values: [user.id, Number(user.barangay_id)],
  };
}

export async function requireCollectionSetup(connection?: PoolConnection) {
  if (!phase1Configured()) throw new DomainError("Phase 1 collection is disabled. An authorized operator must review the migrations and configure SGMS_PHASE1_ENABLED separately.", 503);
  if (!await phase1Ready(connection)) throw new DomainError("Phase 1 dependencies are unavailable or incompatible. Run the read-only schema preflight before enabling collection.", 503);
}

export async function lockCollector(connection: PoolConnection, user: AuthUser) {
  await requireCollectionSetup(connection);
  if (!user.barangay_id) throw new DomainError("Your Collector account has no assigned barangay.", 403);
  const [rows] = await connection.query<any[]>(`SELECT id FROM users
    WHERE id = ? AND role = 'collector' AND status = 'active' AND archived_at IS NULL AND barangay_id = ? FOR UPDATE`, [user.id, user.barangay_id]);
  if (!rows[0]) throw new DomainError("An active Collector account in the assigned barangay is required.", 403);
}

export async function collectorHasPurok(user: AuthUser, purokId: number, connection?: PoolConnection) {
  if (user.role !== "collector" || !user.barangay_id || !Number.isSafeInteger(purokId) || purokId <= 0) return false;
  await requireCollectionSetup(connection);
  if (connection) await lockCollector(connection, user);
  const [rows] = await (connection || db).query<any[]>(`SELECT p.id FROM collector_purok_assignments a
    JOIN puroks p ON p.id = a.purok_id WHERE a.collector_id = ? AND a.is_active = 1
      AND p.id = ? AND p.barangay_id = ? AND p.archived_at IS NULL ${connection ? "FOR UPDATE" : ""}`, [user.id, purokId, user.barangay_id]);
  return rows.length > 0;
}

// Prevent changes to bin membership during a snapshotted run. QR rotation for
// an existing household/bin is still possible; no token is copied to the run.
export async function assertPurokNotCollecting(connection: PoolConnection, purokId: number) {
  if (!phase1Configured()) return;
  await requireCollectionSetup(connection);
  const [rows] = await connection.query<any[]>(`SELECT r.id FROM collection_runs r
    JOIN collection_run_puroks rp ON rp.run_id = r.id
    WHERE rp.purok_id = ? AND r.status = 'in_progress' LIMIT 1 FOR UPDATE`, [purokId]);
  if (rows[0]) throw new DomainError("Finish the active collection run before changing registered-bin coverage in this purok.", 409);
}

export async function collectionRunProgress(runId: number, collectorId: number, barangayId: number, connection?: PoolConnection) {
  // Completion needs current locking reads, not a transaction snapshot created
  // before waiting for another submission to release the Collector lock.
  const [rows] = await (connection || db).query<any[]>(`SELECT rb.bin_id,
    hc.id AS verified_id, hc.collection_status
    FROM collection_run_bins rb JOIN collection_runs r ON r.id = rb.run_id
    LEFT JOIN household_collections hc ON hc.run_id = rb.run_id AND hc.bin_id = rb.bin_id
      AND hc.resident_id = rb.resident_id AND hc.purok_id = rb.purok_id
      AND hc.collector_id = r.collector_user_id AND hc.barangay_id = r.barangay_id
      AND hc.collected_at >= r.started_at AND hc.collected_at <= NOW()
      AND hc.segregation IN ('segregated','not_segregated')
      AND (hc.collection_status = 'collected' OR (hc.collection_status = 'not_collected' AND CHAR_LENGTH(TRIM(hc.not_collected_reason)) > 0))
    WHERE r.id = ? AND r.collector_user_id = ? AND r.barangay_id = ? ${connection ? "FOR UPDATE" : ""}`, [runId, collectorId, barangayId]);
  const results = rows.filter(row => row.verified_id != null);
  return {required: rows.length, verified: results.length, remaining: rows.length - results.length,
    notCollected: results.filter(row => row.collection_status === "not_collected").length};
}
