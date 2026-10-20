import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "mysql2/promise";
import {
  AccountDeletionError,
  canDeleteAccount,
  createAccountDeletionService,
  type AccountIdentity,
} from "./accountDeletion.js";

interface User extends AccountIdentity {
  id: number;
  email: string;
  status: string;
}
interface RecordReference { table: string; column: string; userId: number }
interface Store {
  users: User[];
  passwordResets: string[];
  pendingRegistrations: string[];
  records: RecordReference[];
}

const leader: AccountIdentity = { id: 1, role: "purok_leader", barangay_id: 7, purok_id: 12 };
const admin: AccountIdentity = { id: 2, role: "admin", barangay_id: 7 };
const superAdmin: AccountIdentity = { id: 3, role: "super_admin" };
const resident: User = {
  id: 25,
  role: "resident",
  barangay_id: 7,
  purok_id: 12,
  email: "fake@example.test",
  status: "pending",
};

function fixture(target: User | undefined = resident) {
  let state: Store = {
    users: target ? [structuredClone(target)] : [],
    passwordResets: [resident.email, "unrelated@example.test"],
    pendingRegistrations: [resident.email, "unrelated@example.test"],
    records: [],
  };
  const calls = { connections: 0, commits: 0, rollbacks: 0, releases: 0, deletes: 0 };
  let deleteError: Error | undefined;
  let zeroAffectedRows = false;
  let lastDelete: { sql: string; values: unknown[] } | undefined;
  const pool = {
    async getConnection() {
      calls.connections++;
      let working: Store | undefined;
      function current() {
        assert.ok(working, "all database operations must run within the transaction");
        return working;
      }
      return {
        async beginTransaction() { working = structuredClone(state); },
        async commit() { state = current(); working = undefined; calls.commits++; },
        async rollback() { working = undefined; calls.rollbacks++; },
        release() { calls.releases++; },
        async query(sql: string, values: unknown[]) {
          const store = current();
          if (sql.startsWith("SELECT id, role, email")) {
            assert.match(sql, /FOR UPDATE$/);
            return [store.users.filter(user => user.id === values[0]).map(user => structuredClone(user))];
          }
          if (sql.endsWith("AS has_records")) {
            let parameter = 0;
            let hasRecords = false;
            const subqueries = [...sql.matchAll(/EXISTS \(SELECT 1 FROM (\w+) WHERE ([^)]+)\)/g)];
            assert.ok(subqueries.length > 0, "history must be queried before deleting");
            for (const [, table, where] of subqueries) {
              for (const [, column] of where.matchAll(/(\w+) = \?/g)) {
                const userId = values[parameter++];
                hasRecords ||= store.records.some(record =>
                  record.table === table && record.column === column && record.userId === userId,
                );
              }
            }
            assert.equal(parameter, values.length);
            return [[{ has_records: Number(hasRecords) }]];
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        async execute(sql: string, values: unknown[]) {
          const store = current();
          if (sql.startsWith("DELETE FROM password_resets")) {
            store.passwordResets = store.passwordResets.filter(email => email !== values[0]);
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("DELETE FROM pending_registrations")) {
            store.pendingRegistrations = store.pendingRegistrations.filter(email => email !== values[0]);
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("DELETE FROM users")) {
            calls.deletes++;
            lastDelete = { sql, values };
            if (deleteError) throw deleteError;
            if (zeroAffectedRows) return [{ affectedRows: 0 }];
            const before = store.users.length;
            store.users = store.users.filter(user => {
              let allowed = user.id === values[0] && user.id !== values[1] &&
                ["resident", "collector", "purok_leader"].includes(user.role);
              if (sql.includes("barangay_id = ?")) allowed &&= user.barangay_id === values[2];
              if (sql.includes("purok_id = ?")) allowed &&= user.purok_id === values[3];
              if (sql.includes("role = 'resident'")) allowed &&= user.role === "resident";
              return !allowed;
            });
            return [{ affectedRows: before - store.users.length }];
          }
          throw new Error(`Unexpected statement: ${sql}`);
        },
      };
    },
  };
  return {
    service: createAccountDeletionService({ pool: pool as unknown as Pick<Pool, "getConnection"> }),
    state: () => structuredClone(state),
    calls,
    addRecord: (table: string, column: string, userId = resident.id) => state.records.push({ table, column, userId }),
    failDelete: (error: Error) => { deleteError = error; },
    changeTargetBeforeDelete: () => { zeroAffectedRows = true; },
    lastDelete: () => lastDelete,
  };
}

function errorIs(status: number, code: string) {
  return (error: unknown) => error instanceof AccountDeletionError && error.status === status && error.code === code;
}

test("directory deletion permissions enforce the role hierarchy and both leader location IDs", () => {
  for (const role of ["resident", "collector", "purok_leader"]) {
    const target = { ...resident, role };
    assert.equal(canDeleteAccount(admin, target), true);
    assert.equal(canDeleteAccount(superAdmin, { ...target, barangay_id: 99 }), true);
    assert.equal(canDeleteAccount(leader, target), role === "resident");
  }
  for (const actor of [leader, admin, superAdmin]) {
    assert.equal(canDeleteAccount(actor, { ...resident, role: "admin" }), false);
    assert.equal(canDeleteAccount(actor, { ...resident, role: "super_admin" }), false);
    assert.equal(canDeleteAccount(actor, { ...resident, id: Number(actor.id) }), false);
  }
  for (const target of [
    { ...resident, purok_id: 13 },
    { ...resident, barangay_id: 8 },
    { ...resident, purok_id: null },
    { ...resident, barangay_id: null },
  ]) assert.equal(canDeleteAccount(leader, target), false);
  assert.equal(canDeleteAccount(admin, { ...resident, barangay_id: 8 }), false);
  assert.equal(canDeleteAccount({ ...leader, purok_id: null }, resident), false);
  assert.equal(canDeleteAccount({ ...admin, barangay_id: null }, resident), false);
  assert.equal(canDeleteAccount({ ...leader, role: "resident" }, resident), false);
  assert.equal(canDeleteAccount(undefined, resident), false);
});

test("leader can delete a pending unused resident and clear only that email's stale credentials", async () => {
  const f = fixture();
  await f.service.deleteAccount(leader, String(resident.id));
  assert.deepEqual(f.state().users, []);
  assert.deepEqual(f.state().passwordResets, ["unrelated@example.test"]);
  assert.deepEqual(f.state().pendingRegistrations, ["unrelated@example.test"]);
  assert.deepEqual(f.calls, { connections: 1, commits: 1, rollbacks: 0, releases: 1, deletes: 1 });
  assert.match(f.lastDelete()!.sql, /barangay_id = \? AND purok_id = \? AND role = 'resident'/);
  assert.deepEqual(f.lastDelete()!.values, [resident.id, leader.id, leader.barangay_id, leader.purok_id]);
});

test("admin can delete staff within the barangay; super admin can delete staff across barangays", async () => {
  for (const [actor, target] of [
    [admin, { ...resident, role: "purok_leader" }],
    [superAdmin, { ...resident, role: "collector", barangay_id: 99 }],
  ] as const) {
    const f = fixture(target);
    await f.service.deleteAccount(actor, target.id);
    assert.deepEqual(f.state().users, []);
    assert.match(f.lastDelete()!.sql, /role IN \('resident', 'collector', 'purok_leader'\)/);
    assert.equal(f.lastDelete()!.sql.includes("barangay_id = ?"), actor.role === "admin");
  }
});

test("crafted cross-purok and cross-barangay deletion requests cannot touch targets or tokens", async () => {
  for (const [actor, target] of [
    [leader, { ...resident, purok_id: 13 }],
    [leader, { ...resident, barangay_id: 8 }],
    [admin, { ...resident, barangay_id: 8 }],
  ] as const) {
    const f = fixture(target);
    const before = f.state();
    await assert.rejects(f.service.deleteAccount(actor, target.id), errorIs(404, "USER_NOT_FOUND"));
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.deletes, 0);
    assert.equal(f.calls.rollbacks, 1);
    assert.equal(f.calls.releases, 1);
  }
});

test("leaders cannot delete staff and no manager can delete administrator accounts", async () => {
  const pairs: Array<[AccountIdentity, string]> = [
    [leader, "collector"], [leader, "purok_leader"],
    ...[leader, admin, superAdmin].flatMap(actor => [[actor, "admin"], [actor, "super_admin"]] as Array<[AccountIdentity, string]>),
  ];
  for (const [actor, role] of pairs) {
    const f = fixture({ ...resident, role });
    await assert.rejects(f.service.deleteAccount(actor, resident.id), errorIs(403, "ACCOUNT_DELETE_FORBIDDEN"));
    assert.equal(f.calls.deletes, 0);
    assert.equal(f.calls.rollbacks, 1);
  }
});

test("unauthorized roles, absent scope, invalid IDs and self deletion fail without opening a connection", async () => {
  const cases: Array<[AccountIdentity | undefined, unknown, number, string]> = [
    [undefined, resident.id, 401, "AUTHENTICATION_REQUIRED"],
    [{ ...leader, role: "resident" }, resident.id, 403, "ACCOUNT_DELETE_FORBIDDEN"],
    [{ ...leader, role: "collector" }, resident.id, 403, "ACCOUNT_DELETE_FORBIDDEN"],
    [{ ...leader, purok_id: null }, resident.id, 403, "ACCOUNT_DELETE_FORBIDDEN"],
    [{ ...admin, barangay_id: null }, resident.id, 403, "ACCOUNT_DELETE_FORBIDDEN"],
    [leader, leader.id, 400, "SELF_DELETE_FORBIDDEN"],
    [admin, admin.id, 400, "SELF_DELETE_FORBIDDEN"],
    [superAdmin, superAdmin.id, 400, "SELF_DELETE_FORBIDDEN"],
    ...[0, -1, 1.5, "abc", Number.MAX_SAFE_INTEGER + 1].map(id => [admin, id, 400, "INVALID_USER_ID"] as [AccountIdentity, unknown, number, string]),
  ];
  for (const [actor, id, status, code] of cases) {
    const f = fixture();
    await assert.rejects(f.service.deleteAccount(actor, id), errorIs(status, code));
    assert.equal(f.calls.connections, 0);
  }
});

test("a missing target returns 404 without any deletion", async () => {
  const f = fixture();
  await assert.rejects(f.service.deleteAccount(admin, 999), errorIs(404, "USER_NOT_FOUND"));
  assert.equal(f.calls.deletes, 0);
  assert.equal(f.calls.rollbacks, 1);
});

test("every operational reference protects history including rows that would otherwise cascade or lose attribution", async () => {
  const references = [
    ["payments", "resident_id"], ["payments", "leader_verified_by"], ["payments", "admin_confirmed_by"],
    ["complaints", "reported_by"], ["complaints", "assigned_collector_id"], ["complaint_messages", "sender_id"],
    ["bin_inspections", "purok_leader_id"], ["collection_requests", "requested_by"], ["collection_requests", "assigned_collector_id"],
    ["collection_runs", "collector_user_id"], ["garbage_trucks", "collector_user_id"],
    ["barangay_collection_schedules", "created_by"], ["endorsement_requests", "requester_id"],
    ["endorsement_requests", "leader_reviewed_by"], ["endorsement_requests", "admin_reviewed_by"],
    ["endorsement_request_history", "actor_user_id"], ["collector_locations", "collector_id"], ["collector_location_history", "collector_id"],
  ];
  for (const [table, column] of references) {
    const f = fixture();
    f.addRecord(table, column);
    const before = f.state();
    await assert.rejects(f.service.deleteAccount(admin, resident.id), errorIs(409, "ACCOUNT_HAS_RECORDS"), `${table}.${column} must block deletion`);
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.deletes, 0);
    assert.equal(f.calls.rollbacks, 1);
    assert.equal(f.calls.releases, 1);
  }
});

test("record conflicts give leaders an action they can take and managers suspension guidance", async () => {
  for (const actor of [leader, admin, superAdmin]) {
    const f = fixture();
    f.addRecord("complaints", "reported_by");
    await assert.rejects(f.service.deleteAccount(actor, resident.id), error => {
      assert.ok(error instanceof AccountDeletionError);
      assert.match(error.message, actor.role === "purok_leader" ? /Contact the Barangay Captain/ : /Suspend account access/);
      return true;
    });
  }
});

test("another account's operational records do not block deletion", async () => {
  const f = fixture();
  f.addRecord("payments", "resident_id", 999);
  await f.service.deleteAccount(admin, resident.id);
  assert.equal(f.calls.commits, 1);
  assert.equal(f.state().records.length, 1);
});

test("an unexpected FK restriction returns a conflict and restores stale tokens atomically", async () => {
  const f = fixture();
  const before = f.state();
  f.failDelete(Object.assign(new Error("Referenced row"), { code: "ER_ROW_IS_REFERENCED_2", errno: 1451 }));
  await assert.rejects(f.service.deleteAccount(admin, resident.id), errorIs(409, "ACCOUNT_HAS_RECORDS"));
  assert.deepEqual(f.state(), before);
  assert.equal(f.calls.commits, 0);
  assert.equal(f.calls.rollbacks, 1);
  assert.equal(f.calls.releases, 1);
});

test("a final scope recheck that changes zero rows fails and rolls back credential cleanup", async () => {
  const f = fixture();
  const before = f.state();
  f.changeTargetBeforeDelete();
  await assert.rejects(f.service.deleteAccount(leader, resident.id), errorIs(404, "USER_NOT_FOUND"));
  assert.deepEqual(f.state(), before);
  assert.equal(f.calls.commits, 0);
  assert.equal(f.calls.rollbacks, 1);
});

test("unexpected database errors remain failures and leave the account and tokens intact", async () => {
  const f = fixture();
  const before = f.state();
  const failure = new Error("Database unavailable");
  f.failDelete(failure);
  await assert.rejects(f.service.deleteAccount(admin, resident.id), error => error === failure);
  assert.deepEqual(f.state(), before);
  assert.equal(f.calls.releases, 1);
});
