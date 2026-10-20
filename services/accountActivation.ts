import { createHash, randomBytes } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { getResendClient, getResendFromAddress, emailDeliveryError, escapeEmailHtml } from "./email.js";
import { DomainError } from "./sgms.js";

export const activationHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function sendAccountActivation(connection: PoolConnection, user: {id: number; email: string; full_name: string}) {
  const client = getResendClient();
  if (!client) throw new DomainError("The account email service is not configured.", 503);
  let origin: URL;
  try { origin = new URL(String(process.env.APP_PUBLIC_URL || "")); }
  catch { throw new DomainError("APP_PUBLIC_URL must be configured before creating staff accounts.", 503); }
  if (origin.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && origin.hostname === "localhost")) throw new DomainError("Account setup requires an HTTPS application URL.", 503);
  const token = randomBytes(32).toString("hex");
  // Fragment tokens are not sent in HTTP request URLs or referrer headers.
  const link = new URL("/", origin);
  link.hash = `setup-password=${token}`;
  await connection.execute(
    `INSERT INTO account_activations (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))
     ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at), consumed_at = NULL, created_at = NOW()`,
    [user.id, activationHash(token)],
  );
  try {
    const {error} = await client.emails.send({
      from: getResendFromAddress(), to: user.email, subject: "SGMS account password setup",
      text: `Hello ${user.full_name},\nSet your SGMS password using this single-use link, valid for one hour:\n${link.href}\nIf you did not expect this account, ignore this email.`,
      html: `<p>Hello ${escapeEmailHtml(user.full_name)},</p><p><a href="${escapeEmailHtml(link.href)}">Set your SGMS password</a></p><p>This single-use link expires in one hour. If you did not expect this account, ignore this email.</p>`,
    });
    if (error) throw error;
  } catch (error) { const safe = emailDeliveryError(error); throw new DomainError(safe.message, safe.status); }
}
