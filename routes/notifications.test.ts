import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { db } from "../config/db.js";
import router from "./notifications.js";

type Viewer = {
  id: number;
  role: string;
  barangay_id: number | null;
  purok_id: number | null;
  status: string;
};
const viewer = (role: string, barangayId: number | null = null, purokId: number | null = null): Viewer => ({
  id: 1, role, barangay_id: barangayId, purok_id: purokId, status: "active",
});
const post = router.stack.find(layer => layer.route?.path === "/" && (layer.route as any).methods.post)
  .route.stack.at(-1).handle;

// Invoke the real POST handler after authentication with a lazy pool whose only
// database entry points are mocked. No connection or live database is used.
async function broadcast(t: TestContext, currentViewer: Viewer, body: Record<string, unknown> = {}) {
  const state = { status: 200, payload: null as any, inserted: null as unknown[] | null,
    commits: 0, rollbacks: 0, releases: 0, connections: 0 };
  const barangays = [{ id: 7 }, { id: 8 }];
  const puroks = [{ id: 12, barangay_id: 7 }, { id: 18, barangay_id: 8 }];
  const query = async (sql: string, values: unknown[]) => {
    if (/FROM users/.test(sql)) {
      assert.deepEqual(values, [currentViewer.id]);
      return [[currentViewer]];
    }
    if (/FROM barangays/.test(sql)) return [barangays.filter(row => row.id === values[0])];
    if (/FROM puroks/.test(sql)) return [puroks.filter(row => row.id === values[0]
      && (values.length === 1 || row.barangay_id === values[1]))];
    assert.fail(`Unexpected database query: ${sql}`);
  };
  t.mock.method(db, "query", query);
  t.mock.method(db, "getConnection", async () => {
    state.connections++;
    return {
      query,
      async beginTransaction() {},
      async commit() { state.commits++; },
      async rollback() { state.rollbacks++; },
      release() { state.releases++; },
      async execute(sql: string, values: unknown[]) {
        assert.match(sql, /INSERT INTO notifications/);
        state.inserted = values;
        return [{ insertId: 99 }];
      },
    };
  });
  await post({ user: currentViewer, body: { title: "Collection update", message: "Collection starts at 8 AM.", ...body } } as any, {
    status(code: number) { state.status = code; return this; },
    json(payload: unknown) { state.payload = payload; return this; },
  } as any, () => assert.fail("POST handler unexpectedly delegated to middleware"));
  return state;
}

function assertBroadcast(result: Awaited<ReturnType<typeof broadcast>>, scope: unknown[]) {
  assert.equal(result.status, 201, result.payload?.message);
  assert.equal(result.payload.success, true);
  assert.deepEqual(result.inserted?.slice(0, 4), scope);
  assert.equal(result.commits, 1);
  assert.equal(result.rollbacks, 0);
  assert.equal(result.releases, 1);
}

function assertRejected(result: Awaited<ReturnType<typeof broadcast>>, status: number, message: RegExp) {
  assert.equal(result.status, status);
  assert.equal(result.payload.success, false);
  assert.match(result.payload.message, message);
  assert.equal(result.inserted, null);
  assert.equal(result.commits, 0);
  assert.equal(result.releases, result.connections);
  assert.equal(result.rollbacks, result.connections);
}

test("municipal administrator without area assignments can broadcast municipality-wide", async t => {
  assertBroadcast(await broadcast(t, viewer("super_admin")), [null, null, null, null]);
});

test("municipal broadcast ignores the administrator's incidental own area assignment", async t => {
  assertBroadcast(await broadcast(t, viewer("super_admin", 7, 12)), [null, null, null, null]);
});

test("municipal administrator can broadcast to a role across the municipality", async t => {
  assertBroadcast(await broadcast(t, viewer("super_admin"), { recipientRole: "resident" }), [null, "resident", null, null]);
});

test("municipal administrator can scope a broadcast to a selected barangay", async t => {
  assertBroadcast(await broadcast(t, viewer("super_admin"), { barangayId: 7 }), [null, null, 7, null]);
});

test("municipal administrator can scope a broadcast to a selected purok", async t => {
  assertBroadcast(await broadcast(t, viewer("super_admin"), { purokId: 12, barangayId: 7 }), [null, null, 7, 12]);
});

test("municipal administrator's selected purok supplies its barangay", async t => {
  assertBroadcast(await broadcast(t, viewer("super_admin"), { purokId: 18 }), [null, null, 8, 18]);
});

test("municipal broadcast rejects mismatched barangay and purok", async t => {
  assertRejected(await broadcast(t, viewer("super_admin"), { barangayId: 7, purokId: 18 }), 400, /do not match/);
});

test("municipal broadcast rejects an unavailable barangay", async t => {
  assertRejected(await broadcast(t, viewer("super_admin"), { barangayId: 999 }), 404, /not found or is inactive/);
});

test("barangay administrator cannot override the assigned barangay", async t => {
  assertBroadcast(await broadcast(t, viewer("admin", 7), { barangayId: 8 }), [null, null, 7, null]);
});

test("barangay administrator can scope a broadcast to a purok in the assigned barangay", async t => {
  assertBroadcast(await broadcast(t, viewer("admin", 7), { purokId: 12 }), [null, null, 7, 12]);
});

test("barangay administrator cannot broadcast to another barangay's purok", async t => {
  assertRejected(await broadcast(t, viewer("admin", 7), { purokId: 18 }), 404, /not found in your barangay/);
});

test("barangay administrator without an active assignment cannot broadcast", async t => {
  assertRejected(await broadcast(t, viewer("admin")), 400, /no active assigned barangay/);
});

test("purok leader broadcasts remain scoped to the assigned area", async t => {
  assertBroadcast(await broadcast(t, viewer("purok_leader", 7, 12), { barangayId: 8, purokId: 18 }), [null, null, 7, 12]);
});

test("purok leader with missing assignments cannot broadcast", async t => {
  assertRejected(await broadcast(t, viewer("purok_leader")), 400, /no valid active assignment/);
});

test("purok leader with a mismatched assignment cannot broadcast", async t => {
  assertRejected(await broadcast(t, viewer("purok_leader", 7, 18)), 400, /no valid active assignment/);
});

test("resident cannot broadcast notifications", async t => {
  const result = await broadcast(t, viewer("resident", 7, 12));
  assertRejected(result, 403, /Only authorized administrators/);
  assert.equal(result.connections, 0);
});
