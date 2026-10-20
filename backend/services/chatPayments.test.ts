import test from "node:test";
import assert from "node:assert/strict";
import { isPaymentSummaryRequest, paymentSummary } from "./chatPayments.ts";

const viewer = (role: string, barangay_id: number | null = 7) => ({ id: 1, email: "", role, barangay_id });
test("non-admin roles and unassigned admins cannot query payments", async () => {
  for (const role of ["resident", "purok_leader", "collector", "unknown"]) {
    const result = await paymentSummary(viewer(role), "summarize payments", "English", async () => { throw new Error("Must not query"); });
    assert.equal(result.restricted, true);
  }
  assert.equal((await paymentSummary(viewer("admin", null), "summarize payments", "English", async () => { throw new Error("Must not query"); })).restricted, true);
});
test("admin summary uses assigned barangay and bounded submission month", async () => {
  const result = await paymentSummary(viewer("admin"), "summarize payments 2026-12 for all barangays", "English", async (sql, parameters) => {
    assert.match(sql, /pay.barangay_id = \?/);
    assert.match(sql, /SUM\(pay.amount\)/);
    assert.deepEqual(parameters, [7, "2026-12-01", "2027-01-01"]);
    return [[{ status: "completed", count: 2, amount: "125.50" }, { status: "pending_remittance", count: 1, amount: "20.00" }]];
  });
  assert.match(result.text, /Completed \/ confirmed: 2 payment\(s\), PHP 125.50/);
  assert.match(result.text, /Awaiting remittance: 1 payment\(s\), PHP 20.00/);
});
test("super admin may summarize all barangays; empty records are explicit", async () => {
  const result = await paymentSummary(viewer("super_admin"), "summarize payments", "English", async (sql, parameters) => {
    assert.doesNotMatch(sql, /barangay_id =/);
    assert.deepEqual(parameters, []);
    return [[]];
  });
  assert.match(result.text, /No payment records/);
});
test("unsupported date wording asks for a precise month without querying", async () => {
  const result = await paymentSummary(viewer("admin"), "payment summary this month", "English", async () => { throw new Error("Must not query"); });
  assert.match(result.text, /YYYY-MM/);
});
test("summary intent supports English and Cebuano without intercepting payment how-to", () => {
  for (const message of ["summarize payments", "pila tanan bayad", "total collections", "show unpaid residents"]) assert.equal(isPaymentSummaryRequest(message), true);
  assert.equal(isPaymentSummaryRequest("How do I submit a payment?"), false);
});
