import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../config/db.js";
import router from "./collectionSchedules.js";

type Method = "post" | "put" | "delete";
type Manager = { id: number; role: string; status: string; barangay_id: number | null; purok_id: number | null };
type Schedule = { id: number; barangay_id: number; day_of_week: string; start_time: string | null; end_time: string | null; notes: string | null; is_active: number; created_by: number };
const manager = (overrides: Partial<Manager> = {}): Manager => ({
  id: 1, role: "admin", status: "active", barangay_id: 7, purok_id: 12, ...overrides,
});
const seed: Schedule[] = [7, 8].map((barangay_id, index) => ({
  id: index + 1, barangay_id, day_of_week: "Thursday", start_time: "08:00:00", end_time: "10:00:00",
  notes: `Barangay ${barangay_id} collection`, is_active: 1, created_by: 5,
}));
const body = { barangay_id: 7, day_of_week: "Friday", start_time: "09:00", end_time: "11:00", notes: "  Updated collection  " };
const handler = (method: Method) => router.stack
  .find(layer => layer.route && (layer.route as any).methods[method])!.route.stack.at(-1).handle;

// Exercise the real authenticated handlers against an in-memory lazy pool. The
// fixture models unique weekdays, tenant predicates and transaction rollback;
// no live database, server, storage or email service is contacted.
async function request(t: TestContext, method: Method, options: {
  user?: Manager; reloaded?: Manager; activeBarangay?: boolean; body?: Record<string, unknown>; id?: number;
  schedules?: Schedule[]; failWrite?: boolean;
} = {}) {
  const user = options.user ?? manager();
  const reloaded = options.reloaded ?? user;
  const state = { status: 200, payload: null as any, schedules: structuredClone(options.schedules ?? seed),
    connections: 0, commits: 0, rollbacks: 0, releases: 0, writes: 0 };
  let pending: Schedule[] | null = null;
  const query = async (sql: string, values: any[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (/FROM users/.test(normalized)) {
      const requiresAdmin = /u\.role\s*=\s*'admin'/.test(normalized);
      const requiresBarangay = /INNER JOIN barangays/.test(normalized);
      const allowed = reloaded.status === "active" && (!requiresAdmin || reloaded.role === "admin")
        && (!requiresBarangay || (reloaded.barangay_id !== null && options.activeBarangay !== false));
      const barangay_id = /COALESCE/.test(normalized) ? reloaded.barangay_id ?? 7 : reloaded.barangay_id;
      return [allowed ? [{ ...reloaded, barangay_id }] : []];
    }
    if (/FROM barangays/.test(normalized)) return [options.activeBarangay === false ? [] : [{ id: values[0] }]];
    const schedules = pending ?? state.schedules;
    if (/INSERT INTO barangay_collection_schedules/.test(normalized)) {
      state.writes++;
      if (options.failWrite) throw new Error("Simulated write failure");
      const [barangay_id, day_of_week, start_time, end_time, notes, created_by] = values;
      const existing = schedules.find(row => row.barangay_id === barangay_id && row.day_of_week === day_of_week);
      const row = { id: existing?.id ?? 99, barangay_id, day_of_week, start_time, end_time, notes, created_by, is_active: 1 };
      if (existing) Object.assign(existing, row); else schedules.push(row);
      return [{ affectedRows: 1, insertId: row.id }];
    }
    if (/UPDATE barangay_collection_schedules/.test(normalized)) {
      state.writes++;
      const assignments = normalized.split(/ SET /i)[1].split(/ WHERE /i)[0].split(",");
      const updates: Record<string, any> = {};
      let valueIndex = 0;
      for (const assignment of assignments) {
        const [name, value] = assignment.split("=").map(part => part.trim());
        updates[name] = value === "?" ? values[valueIndex++] : Number(value);
      }
      const row = schedules.find(item => item.id === values[valueIndex]
        && (!/AND barangay_id\s*=\s*\?/.test(normalized) || item.barangay_id === values[valueIndex + 1]));
      if (!row) return [{ affectedRows: 0 }];
      if (schedules.some(item => item.id !== row.id && item.barangay_id === (updates.barangay_id ?? row.barangay_id)
        && item.day_of_week === updates.day_of_week)) throw Object.assign(new Error("Duplicate weekday"), { code: "ER_DUP_ENTRY" });
      Object.assign(row, updates);
      if (options.failWrite) throw new Error("Simulated write failure after mutation");
      return [{ affectedRows: 1 }];
    }
    if (/DELETE FROM barangay_collection_schedules/.test(normalized)) {
      state.writes++;
      const index = schedules.findIndex(row => row.id === values[0]
        && (!/AND barangay_id\s*=\s*\?/.test(normalized) || row.barangay_id === values[1]));
      if (index < 0) return [{ affectedRows: 0 }];
      schedules.splice(index, 1);
      if (options.failWrite) throw new Error("Simulated write failure after mutation");
      return [{ affectedRows: 1 }];
    }
    assert.fail(`Unexpected database query: ${normalized}`);
  };
  t.mock.method(db, "query", query);
  t.mock.method(db, "execute", query);
  t.mock.method(db, "getConnection", async () => {
    state.connections++;
    return { query, execute: query,
      async beginTransaction() { pending = structuredClone(state.schedules); },
      async commit() { state.commits++; state.schedules = pending!; pending = null; },
      async rollback() { state.rollbacks++; pending = null; },
      release() { state.releases++; },
    };
  });
  await handler(method)({ user, body: { ...body, ...options.body }, params: { id: String(options.id ?? 1) } } as any, {
    status(code: number) { state.status = code; return this; },
    json(payload: unknown) { state.payload = payload; return this; },
  } as any, () => assert.fail("Schedule handler unexpectedly delegated"));
  return state;
}

function assertRejected(result: Awaited<ReturnType<typeof request>>, status: number, initial = seed) {
  assert.equal(result.status, status, result.payload?.message);
  assert.equal(result.payload.success, false);
  assert.deepEqual(result.schedules, initial);
  assert.equal(result.commits, 0);
  assert.equal(result.rollbacks, result.connections);
  assert.equal(result.releases, result.connections);
}

for (const method of ["post", "put", "delete"] as Method[]) {
  test(`barangay captain can ${method} a schedule in their assigned barangay`, async t => {
    const result = await request(t, method);
    assert.equal(result.status, method === "post" ? 201 : 200, result.payload?.message);
    assert.equal(result.payload.success, true);
    assert.deepEqual(result.schedules.find(row => row.id === 2), seed[1]);
    if (method === "delete") assert.equal(result.schedules.some(row => row.id === 1), false);
    else {
      const updated = result.schedules.find(row => row.day_of_week === "Friday")!;
      assert.equal(updated.barangay_id, 7);
      assert.equal(updated.start_time, "09:00:00");
      assert.equal(updated.notes, "Updated collection");
      assert.equal(updated.created_by, 1);
    }
    assert.equal(result.connections, 1);
    assert.equal(result.commits, 1);
    assert.equal(result.rollbacks, 0);
    assert.equal(result.releases, 1);
  });
}

for (const role of ["super_admin", "resident", "collector", "purok_leader"]) {
  test(`${role} cannot manage collection schedules`, async t => {
    for (const method of ["post", "put", "delete"] as Method[]) {
      const result = await request(t, method, { user: manager({ role }) });
      assertRejected(result, 403);
      assert.equal(result.writes, 0);
    }
  });
}

for (const method of ["post", "put"] as Method[]) {
  test(`${method} rejects a requested barangay outside the captain's assignment`, async t => {
    const result = await request(t, method, { body: { barangay_id: 8 } });
    assertRejected(result, 403);
    assert.equal(result.writes, 0);
  });
}

for (const method of ["put", "delete"] as Method[]) {
  test(`${method} treats another barangay's schedule like a missing schedule`, async t => {
    const foreign = await request(t, method, { id: 2 });
    const missing = await request(t, method, { id: 999 });
    assertRejected(foreign, 404);
    assertRejected(missing, 404);
    assert.deepEqual(foreign.payload, missing.payload);
  });
}

for (const [name, options] of [
  ["missing explicit barangay even with an assigned purok", { user: manager({ barangay_id: null }) }],
  ["inactive assigned barangay", { activeBarangay: false }],
  ["inactive account at the locked reload", { reloaded: manager({ status: "inactive" }) }],
  ["demoted account at the locked reload", { reloaded: manager({ role: "resident" }) }],
] as const) {
  test(`${name} cannot manage schedules`, async t => {
    for (const method of ["post", "put", "delete"] as Method[]) {
      const result = await request(t, method, options);
      assertRejected(result, 403);
      assert.equal(result.writes, 0);
    }
  });
}

test("a changed assignment at reload cannot use the previous barangay", async t => {
  assertRejected(await request(t, "post", { reloaded: manager({ barangay_id: 8 }) }), 403);
  assertRejected(await request(t, "put", { reloaded: manager({ barangay_id: 8 }) }), 403);
  assertRejected(await request(t, "delete", { reloaded: manager({ barangay_id: 8 }) }), 404);
});

test("invalid collection times and reversed time ranges leave schedules unchanged", async t => {
  for (const method of ["post", "put"] as Method[]) {
    for (const invalid of [{ start_time: "25:00" }, { end_time: "09:00" }]) {
      const result = await request(t, method, { body: invalid });
      assertRejected(result, 400);
      assert.equal(result.writes, 0);
    }
  }
});

test("changing a weekday to an existing own-barangay weekday returns a conflict", async t => {
  const schedules = [...structuredClone(seed), { ...seed[0], id: 3, day_of_week: "Friday" }];
  assertRejected(await request(t, "put", { schedules }), 409, schedules);
});

test("write failures roll back partial changes and release the connection", async t => {
  t.mock.method(console, "error", () => {});
  for (const method of ["put", "delete"] as Method[]) {
    assertRejected(await request(t, method, { failWrite: true }), 500);
  }
});
