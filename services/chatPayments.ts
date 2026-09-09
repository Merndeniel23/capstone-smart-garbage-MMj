import type { AuthUser } from "../middleware/auth.js";

export function canSummarizePayments(user: AuthUser) {
  return ["admin", "super_admin"].includes(user.role);
}

export function isPaymentSummaryRequest(message: string) {
  return /\b(payment\w*|bayad|remittance\w*|paid|unpaid|total collections|nakolekta|kabayranan|ledger|revenue|income)\b/i.test(message)
    && /\b(summar\w*|samar\w*|total\w*|pila|how much|how many|report\w*|overview|breakdown|paid|unpaid|tanan|tanang|all|status)\b/i.test(message);
}

type Query = (sql: string, parameters: any[]) => Promise<any>;

// Role and tenant checks live here as well as at the endpoint. No model-generated SQL.
export async function paymentSummary(user: AuthUser, message: string, language: "Cebuano" | "English", query: Query) {
  if (!canSummarizePayments(user)) {
    return { restricted: true, text: language === "Cebuano"
      ? "Admin ug Super Admin ra ang maka-access sa payment summaries. Makatabang gihapon ko sa paggamit sa payment features nga allowed sa imong role."
      : "Payment summaries are available only to Admins and Super Admins. I can still explain the payment features available to your role." };
  }
  if (user.role === "admin" && !user.barangay_id) {
    return { restricted: true, text: language === "Cebuano" ? "Wala kay assigned barangay. Dili nako ma-load ang payment summary." : "Your account has no assigned barangay, so I cannot load a payment summary." };
  }

  const conditions = user.role === "admin" ? ["pay.barangay_id = ?"] : ["1 = 1"];
  const parameters: any[] = user.role === "admin" ? [user.barangay_id] : [];
  const month = message.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  let period = "All time / tanang panahon";
  if (month) {
    const year = Number(month[1]);
    const number = Number(month[2]);
    conditions.push("pay.created_at >= ?", "pay.created_at < ?");
    parameters.push(`${year}-${month[2]}-01`, `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}-01`);
    period = `${month[0]} (payment submission month)`;
  } else if (/\b(month|bulan|year|tuig|today|karon|yesterday|gahapon|week|semana|january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b/i.test(message)) {
    return { text: language === "Cebuano" ? "Para sa monthly payment summary, ibutang ang bulan sa YYYY-MM format, pananglitan: Summarize payments 2026-09. Ang basehan kay petsa sa pag-submit sa payment." : "For a monthly payment summary, use YYYY-MM, for example: Summarize payments 2026-09. This uses the payment submission date." };
  }
  const [rows] = await query(`
    SELECT pay.status, COUNT(*) AS count,
      CAST(COALESCE(SUM(pay.amount), 0) AS CHAR) AS amount
    FROM payments pay
    WHERE ${conditions.join(" AND ")}
    GROUP BY pay.status ORDER BY pay.status`, parameters);
  const scope = user.role === "admin" ? "Assigned barangay / imong barangay" : "All barangays / tanang barangay";
  const labels: Record<string, string> = {
    completed: "Completed / confirmed",
    pending_leader_verification: "Awaiting leader verification",
    rejected_by_leader: "Rejected by leader",
    pending_remittance: "Awaiting remittance",
    pending_admin_confirmation: "Awaiting admin confirmation",
    discrepancy: "Discrepancy — needs review",
  };
  const lines = rows.map((row: any) => `${labels[row.status] || row.status}: ${row.count} payment(s), PHP ${row.amount}`);
  return { text: ["Payment summary", `Scope: ${scope}`, `Period: ${period}`,
    ...(lines.length ? lines : [language === "Cebuano" ? "Walay payment records niini nga scope ug panahon." : "No payment records in this scope and period."]),
    language === "Cebuano"
      ? "Ang Completed ra ang kumpirmadong bayad. Ang pending, rejected ug discrepancy dili apil sa confirmed collections. Dili kini lista sa wala makabayad: payment submissions ra ang basehan. Para sa usa ka bulan, pangutana og Summarize payments YYYY-MM."
      : "Only Completed amounts are confirmed collections. Pending, rejected and discrepancy amounts are separate. This does not count unpaid residents: these are payment submissions only. For one month, ask: Summarize payments YYYY-MM.",
  ].join("\n") };
}
