import type { Pool } from "mysql2/promise";
import { db } from "../config/db.js";

export interface AccountIdentity {
  id: number | string;
  role: string;
  barangay_id?: number | string | null;
  purok_id?: number | string | null;
}

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

function positiveId(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

const managedRoles = ["resident", "collector", "purok_leader"];

/** Permission only; linked records are checked transactionally when deleting. */
export function canDeleteAccount(
  actor: AccountIdentity | null | undefined,
  target: AccountIdentity | null | undefined,
): boolean {
  if (!actor || !target || !positiveId(actor.id) || !positiveId(target.id)) return false;
  if (Number(actor.id) === Number(target.id) || !managedRoles.includes(target.role)) return false;
  if (actor.role === "super_admin") return true;
  const barangayId = positiveId(actor.barangay_id);
  if (!barangayId || positiveId(target.barangay_id) !== barangayId) return false;
  if (actor.role === "admin") return true;
  const purokId = positiveId(actor.purok_id);
  return actor.role === "purok_leader" && target.role === "resident" &&
    Boolean(purokId) && positiveId(target.purok_id) === purokId;
}

// Include CASCADE and SET NULL references as well as restrictive foreign keys:
// deleting an unused account must never erase complaint or operational history.
const businessReferences = [
  ["payments", ["resident_id", "leader_verified_by", "admin_confirmed_by"]],
  ["complaints", ["reported_by", "assigned_collector_id"]],
  ["complaint_messages", ["sender_id"]],
  ["bin_inspections", ["purok_leader_id"]],
  ["collection_requests", ["requested_by", "assigned_collector_id"]],
  ["collection_runs", ["collector_user_id"]],
  ["garbage_trucks", ["collector_user_id"]],
  ["barangay_collection_schedules", ["created_by"]],
  ["endorsement_requests", ["requester_id", "leader_reviewed_by", "admin_reviewed_by"]],
  ["endorsement_request_history", ["actor_user_id"]],
  ["collector_locations", ["collector_id"]],
  ["collector_location_history", ["collector_id"]],
] as const;

const historySql = `SELECT (${businessReferences.map(([table, columns]) =>
  `EXISTS (SELECT 1 FROM ${table} WHERE ${columns.map(column => `${column} = ?`).join(" OR ")})`,
).join(" OR ")}) AS has_records`;
const historyParameterCount = businessReferences.reduce((count, [, columns]) => count + columns.length, 0);

function linkedRecordsError(actor: AccountIdentity) {
  return new AccountDeletionError(
    actor.role === "purok_leader"
      ? "This account has linked records and cannot be deleted. Contact the Barangay Captain to suspend account access instead."
      : "This account has linked records and cannot be deleted. Suspend account access instead to preserve its history.",
    409,
    "ACCOUNT_HAS_RECORDS",
  );
}

export function createAccountDeletionService(options: {
  pool?: Pick<Pool, "getConnection">;
} = {}) {
  const pool = options.pool || db;

  async function deleteAccount(
    actor: AccountIdentity | null | undefined,
    rawTargetId: unknown,
  ): Promise<void> {
    if (!actor || !positiveId(actor.id)) {
      throw new AccountDeletionError("Authentication required.", 401, "AUTHENTICATION_REQUIRED");
    }
    if (!["admin", "super_admin", "purok_leader"].includes(actor.role)) {
      throw new AccountDeletionError("Administrator or Purok Leader access is required.", 403, "ACCOUNT_DELETE_FORBIDDEN");
    }
    const targetId = positiveId(rawTargetId);
    if (!targetId) {
      throw new AccountDeletionError("Invalid user ID.", 400, "INVALID_USER_ID");
    }
    if (Number(actor.id) === targetId) {
      throw new AccountDeletionError("You cannot delete your own account.", 400, "SELF_DELETE_FORBIDDEN");
    }
    const barangayId = positiveId(actor.barangay_id);
    const purokId = positiveId(actor.purok_id);
    if (actor.role !== "super_admin" && !barangayId) {
      throw new AccountDeletionError("Your account has no assigned barangay.", 403, "ACCOUNT_DELETE_FORBIDDEN");
    }
    if (actor.role === "purok_leader" && !purokId) {
      throw new AccountDeletionError("Your account has no assigned purok.", 403, "ACCOUNT_DELETE_FORBIDDEN");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<any[]>(
        "SELECT id, role, email, barangay_id, purok_id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [targetId],
      );
      const target = rows[0] as (AccountIdentity & { email: string }) | undefined;
      if (!target || (actor.role !== "super_admin" && positiveId(target.barangay_id) !== barangayId) ||
        (actor.role === "purok_leader" && positiveId(target.purok_id) !== purokId)) {
        throw new AccountDeletionError("User was not found in your managed area.", 404, "USER_NOT_FOUND");
      }
      if (!canDeleteAccount(actor, target)) {
        throw new AccountDeletionError(
          actor.role === "purok_leader"
            ? "Purok Leaders can only delete resident accounts in their assigned purok."
            : "Administrator accounts cannot be deleted.",
          403,
          "ACCOUNT_DELETE_FORBIDDEN",
        );
      }

      // Holding the parent row lock also prevents new FK-backed references
      // from appearing between this check and the delete.
      const [history] = await connection.query<any[]>(historySql, Array(historyParameterCount).fill(targetId));
      if (Number(history[0]?.has_records) !== 0) throw linkedRecordsError(actor);

      // These tokens are keyed by email, not a user FK. Reusing the email must
      // never revive the old signup or password recovery credentials.
      await connection.execute("DELETE FROM password_resets WHERE email = ?", [target.email]);
      await connection.execute("DELETE FROM pending_registrations WHERE email = ?", [target.email]);

      const conditions = ["id = ?", "id <> ?", "role IN ('resident', 'collector', 'purok_leader')"];
      const parameters: Array<number | null> = [targetId, Number(actor.id)];
      if (actor.role !== "super_admin") {
        conditions.push("barangay_id = ?");
        parameters.push(barangayId);
      }
      if (actor.role === "purok_leader") {
        conditions.push("purok_id = ?", "role = 'resident'");
        parameters.push(purokId);
      }
      const [result]: any = await connection.execute(
        `DELETE FROM users WHERE ${conditions.join(" AND ")}`,
        parameters,
      );
      if (result.affectedRows !== 1) {
        throw new AccountDeletionError("User was not found in your managed area or cannot be deleted.", 404, "USER_NOT_FOUND");
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      const sqlError = error as { code?: string; errno?: number };
      if (sqlError?.code === "ER_ROW_IS_REFERENCED_2" || sqlError?.errno === 1451) {
        throw linkedRecordsError(actor);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  return { deleteAccount };
}

export const { deleteAccount } = createAccountDeletionService();
