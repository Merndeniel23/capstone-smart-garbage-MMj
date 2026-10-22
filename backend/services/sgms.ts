import type { PoolConnection } from "mysql2/promise";
import type { AuthUser } from "../middleware/auth.js";
import { db } from "../config/db.js";

export const revisionsEnabled = () => process.env.SGMS_REVISIONS_ENABLED === "true";
export const activeRecord = (alias: string) => revisionsEnabled() ? ` AND ${alias}.archived_at IS NULL` : "";
export class DomainError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function positiveId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new DomainError("A valid record ID is required.");
  return id;
}
export function requiredText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new DomainError(`Enter text between 1 and ${maximum} characters.`);
  return value.trim();
}
export function canAccess(user: AuthUser, row: any): boolean {
  if (user.role === "super_admin") return true;
  if (!user.barangay_id || Number(user.barangay_id) !== Number(row.barangay_id)) return false;
  if (user.role === "admin" || user.role === "collector") return true;
  if (user.role === "purok_leader") return Boolean(user.purok_id) && Number(user.purok_id) === Number(row.purok_id);
  return user.role === "resident" && Number(row.resident_id) === user.id;
}
export async function audit(connection: PoolConnection, actor: AuthUser | null, action: string, type: string, id: number, scope: {barangay_id?: number | null; purok_id?: number | null; resident_id?: number | null} = {}, details: any = null) {
  if (!revisionsEnabled()) return;
  const [actors] = actor ? await connection.query<any[]>("SELECT full_name FROM users WHERE id = ?", [actor.id]) : [[]];
  await connection.execute(
    `INSERT INTO activity_logs (actor_id, actor_name, actor_role, barangay_id, purok_id, resident_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [actor?.id || null, actors[0]?.full_name || "Payment provider", actor?.role || "system", scope.barangay_id ?? actor?.barangay_id ?? null, scope.purok_id ?? actor?.purok_id ?? null, scope.resident_id ?? null, action, type, id, details == null ? null : JSON.stringify(details)],
  );
}
export async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db.getConnection();
  try { await connection.beginTransaction(); const value = await work(connection); await connection.commit(); return value; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function archivedAccount(id: number) {
  if (!revisionsEnabled()) return false;
  const [rows] = await db.query<any[]>("SELECT archived_at FROM users WHERE id = ?", [id]);
  return Boolean(rows[0]?.archived_at);
}
// Direct Purok Leader decisions carry their own terms; older rows use their policy's.
export async function activeSuspension(residentId: number, scope: "collection" | "account", connection?: PoolConnection) {
  const [rows]=await (connection || db).query<any[]>(`SELECT v.id, v.suspension_until FROM household_violations v LEFT JOIN barangay_violation_policies p ON p.id = v.policy_id
    WHERE v.resident_id = ? AND COALESCE(v.action, p.action) = 'suspension' AND COALESCE(v.suspension_scope, p.suspension_scope) = ? AND v.suspension_until > NOW()
    AND NOT EXISTS(SELECT 1 FROM household_violation_reviews r WHERE r.violation_id = v.id AND r.decision = 'voided') ORDER BY v.suspension_until DESC LIMIT 1`,[residentId, scope]);
  return rows[0] as {id: number; suspension_until: string} | undefined;
}
export async function accountSuspended(id: number) {
  if (!revisionsEnabled()) return false;
  return Boolean(await activeSuspension(id, "account"));
}
