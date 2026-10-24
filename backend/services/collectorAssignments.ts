import type { PoolConnection } from "mysql2/promise";
import type { AuthUser } from "../middleware/auth.js";
import { db } from "../config/db.js";
import { activeRecord, DomainError, revisionsEnabled } from "./sgms.js";
import { inspectPhase1Schema } from "./phase1Schema.js";

export const phase1Configured = () => revisionsEnabled() && process.env.SGMS_PHASE1_ENABLED !== "false";
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
// A Collector works across their own barangay. Once Phase 1 is configured and
// ready, the Admin's purok assignments narrow that scope. Call
// refreshCollectorScope() first so the readiness state is current.
export function collectorPurokScope(user: Pick<AuthUser, "id" | "role" | "barangay_id">, column: string) {
  if (user.role !== "collector") return { sql: "1=1", values: [] as number[] };
  if (!user.barangay_id) return { sql: "0=1", values: [] as number[] };
  if (!phase1Enabled()) {
    return {
      sql: `EXISTS (SELECT 1 FROM puroks barangay_p WHERE barangay_p.id = ${column} AND barangay_p.barangay_id = ?)`,
      values: [Number(user.barangay_id)],
    };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM collector_purok_assignments cpa JOIN puroks assigned_p ON assigned_p.id = cpa.purok_id
      WHERE cpa.collector_id = ? AND cpa.is_active = 1 AND cpa.purok_id = ${column}
        AND assigned_p.barangay_id = ? AND assigned_p.archived_at IS NULL)`,
    values: [user.id, Number(user.barangay_id)],
  };
}

/** Refreshes Phase 1 readiness before a Collector's scope is built. Never blocks the Collector. */
export async function refreshCollectorScope(connection?: PoolConnection) {
  await phase1Ready(connection);
}

/** Only collection runs and purok-assignment management need the Phase 1 tables. */
export async function requireCollectionSetup(connection?: PoolConnection) {
  if (!phase1Configured()) throw new DomainError("Collection runs and purok assignments are not enabled yet. Collectors can still scan bins directly. An operator must apply the Phase 1 migration and set SGMS_PHASE1_ENABLED=true.", 503);
  if (!await phase1Ready(connection)) throw new DomainError("Phase 1 tables are missing or incompatible. Run the read-only schema preflight before enabling collection runs.", 503);
}

export async function lockCollector(connection: PoolConnection, user: AuthUser) {
  await refreshCollectorScope(connection);
  if (!user.barangay_id) throw new DomainError("Your Collector account has no assigned barangay.", 403);
  const [rows] = await connection.query<any[]>(`SELECT id FROM users
    WHERE id = ? AND role = 'collector' AND status = 'active' AND barangay_id = ?${activeRecord("users")} FOR UPDATE`, [user.id, user.barangay_id]);
  if (!rows[0]) throw new DomainError("An active Collector account in the assigned barangay is required.", 403);
}

export async function collectorHasPurok(user: AuthUser, purokId: number, connection?: PoolConnection) {
  if (user.role !== "collector" || !user.barangay_id || !Number.isSafeInteger(purokId) || purokId <= 0) return false;
  await refreshCollectorScope(connection);
  if (connection) await lockCollector(connection, user);
  const [rows] = phase1Enabled()
    ? await (connection || db).query<any[]>(`SELECT p.id FROM collector_purok_assignments a
      JOIN puroks p ON p.id = a.purok_id WHERE a.collector_id = ? AND a.is_active = 1
        AND p.id = ? AND p.barangay_id = ? AND p.archived_at IS NULL ${connection ? "FOR UPDATE" : ""}`, [user.id, purokId, user.barangay_id])
    : await (connection || db).query<any[]>(`SELECT p.id FROM puroks p
      WHERE p.id = ? AND p.barangay_id = ?${activeRecord("p")} ${connection ? "FOR UPDATE" : ""}`, [purokId, user.barangay_id]);
  return rows.length > 0;
}

// Prevent changes to bin membership during a snapshotted run. QR rotation for
// an existing household/bin is still possible; no token is copied to the run.
// Runs only exist with Phase 1, so there is nothing to protect without it.
export async function assertPurokNotCollecting(connection: PoolConnection, purokId: number) {
  await refreshCollectorScope(connection);
  if (!phase1Enabled()) return;
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
