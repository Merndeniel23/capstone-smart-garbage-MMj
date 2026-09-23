import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import { getJwtSecret } from "../config/security.js";
import { emailDeliveryError, sendVerificationOtp } from "./email.js";

export { sendVerificationOtp } from "./email.js";
export const EMAIL_OTP_EXPIRY_SECONDS = 10 * 60;
export const EMAIL_OTP_RESEND_SECONDS = 60;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

export class VerificationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "EMAIL_VERIFICATION_ERROR",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

export function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return email.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Existing active/inactive accounts without an OTP record remain legacy
 * accounts. New accounts always create a verification record in the same
 * transaction as the user, and consumed records are retained as provenance. */
export function requiresEmailVerification(user: {
  role?: string;
  status?: string;
  email_verified_at?: unknown;
  has_email_verification?: unknown;
}) {
  return user.role !== "super_admin" && !user.email_verified_at &&
    (user.status === "pending" || Boolean(Number(user.has_email_verification)));
}

interface VerificationUser {
  id: number;
  email: string;
  full_name: string;
  role: string;
  status: string;
  email_verified_at: Date | null;
  barangay_id: number | null;
  purok_id: number | null;
  phone: string | null;
  address: string | null;
}

/** Dependencies keep the production flow testable with an isolated database
 * and an in-memory mail transport; no test delivery shortcuts exist in routes. */
export function createEmailVerificationService(options: {
  pool?: Pick<Pool, "getConnection">;
  sendOtp?: typeof sendVerificationOtp;
  now?: () => number;
  secret?: () => string;
} = {}) {
  const pool = options.pool || db;
  const deliver = options.sendOtp || sendVerificationOtp;
  const now = options.now || Date.now;
  const secret = options.secret || getJwtSecret;

  function hashOtp(email: string, otp: string) {
    return crypto.createHmac("sha256", secret())
      .update(`${normalizeEmail(email)}:${otp}`).digest("hex");
  }

  async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function pendingUser(connection: PoolConnection, email: string) {
    const [users] = await connection.query<any[]>(
      `SELECT id, email, full_name, role, status, email_verified_at,
              barangay_id, purok_id, phone, address
       FROM users WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE`,
      [email],
    );
    const user = users[0] as VerificationUser | undefined;
    if (!user || !["resident", "purok_leader", "collector", "admin"].includes(user.role)) {
      throw new VerificationError("No account is waiting for email verification with these details.", 400, "VERIFICATION_NOT_PENDING");
    }
    if (user.email_verified_at) {
      throw new VerificationError("This email is already verified. Please sign in.", 409, "EMAIL_ALREADY_VERIFIED");
    }
    if (user.status !== "pending") {
      throw new VerificationError(
        user.status === "inactive"
          ? "This account is inactive. Please contact the administrator."
          : "This account is not waiting for email verification. Please sign in.",
        409,
        "VERIFICATION_NOT_PENDING",
      );
    }
    return user;
  }

  /** Caller must hold the user/account-creation transaction. Failed delivery
   * rolls back both the new account and its verification request. */
  async function createEmailVerification(
    connection: PoolConnection,
    user: { id: number; email: string; full_name: string },
  ) {
    const email = normalizeEmail(user.email);
    if (!isValidEmail(email)) {
      throw new VerificationError("Enter a valid email address.");
    }
    const [previous] = await connection.query<any[]>(
      "SELECT otp_hash FROM email_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [user.id],
    );
    let otp = generateOtp();
    while (previous[0]?.otp_hash === hashOtp(email, otp)) otp = generateOtp();
    const expiresAt = new Date(now() + EMAIL_OTP_EXPIRY_SECONDS * 1000);
    await connection.execute("DELETE FROM email_verifications WHERE user_id = ?", [user.id]);
    await connection.execute(
      `INSERT INTO email_verifications (user_id, email, otp_hash, attempt_count, expires_at)
       VALUES (?, ?, ?, 0, ?)`,
      [user.id, email, hashOtp(email, otp), expiresAt],
    );
    try {
      await deliver(email, user.full_name, otp);
    } catch (error) {
      const safeError = emailDeliveryError(error);
      throw new VerificationError(safeError.message, safeError.status, safeError.code);
    }
    return { expiresInSeconds: EMAIL_OTP_EXPIRY_SECONDS, resendAfter: EMAIL_OTP_RESEND_SECONDS };
  }

  async function verifyEmailOtp(rawEmail: string, rawOtp: string) {
    const email = normalizeEmail(rawEmail);
    const otp = String(rawOtp || "").trim();
    if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
      throw new VerificationError("Enter your email and the 6-digit verification code.", 400, "INVALID_OTP");
    }
    const result = await transaction(async (connection) => {
      const user = await pendingUser(connection, email);
      const [rows] = await connection.query<any[]>(
        `SELECT id, otp_hash, attempt_count, expires_at, verified_at
         FROM email_verifications WHERE user_id = ? AND email = ?
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [user.id, email],
      );
      const request = rows[0];
      if (!request || request.verified_at) {
        throw new VerificationError("No unused verification code is available. Please request a new code.", 400, "INVALID_OTP");
      }
      if (new Date(request.expires_at).getTime() <= now()) {
        throw new VerificationError("This verification code has expired. Please request a new code.", 400, "OTP_EXPIRED");
      }
      if (Number(request.attempt_count) >= EMAIL_OTP_MAX_ATTEMPTS) {
        throw new VerificationError("Too many incorrect codes. Please request a new verification code.", 429, "OTP_ATTEMPTS_EXCEEDED");
      }
      const expected = Buffer.from(hashOtp(email, otp), "hex");
      const actual = Buffer.from(String(request.otp_hash), "hex");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        await connection.execute(
          "UPDATE email_verifications SET attempt_count = attempt_count + 1 WHERE id = ?",
          [request.id],
        );
        // Commit the attempt before returning an error so attempts cannot be
        // retried indefinitely through transaction rollback.
        return new VerificationError("The verification code is incorrect.", 400, "INVALID_OTP");
      }

      const needsProfile = user.role === "resident" &&
        (!user.barangay_id || !user.purok_id || !user.phone?.trim() || !user.address?.trim());
      const status = needsProfile ? "pending" : "active";
      await connection.execute(
        "UPDATE email_verifications SET verified_at = NOW() WHERE id = ? AND verified_at IS NULL",
        [request.id],
      );
      await connection.execute(
        `UPDATE users SET email_verified_at = NOW(), status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending' AND email_verified_at IS NULL`,
        [status, user.id],
      );
      return {
        status,
        message: needsProfile
          ? "Email verified. Sign in to complete your resident profile."
          : "Email verified successfully. You may now sign in.",
      };
    });
    if (result instanceof VerificationError) throw result;
    return result;
  }

  async function resendVerificationOtp(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new VerificationError("Enter a valid email address.");
    return transaction(async (connection) => {
      const user = await pendingUser(connection, email);
      const [rows] = await connection.query<any[]>(
        `SELECT created_at FROM email_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [user.id],
      );
      if (rows[0]) {
        const remaining = Math.ceil((new Date(rows[0].created_at).getTime() + EMAIL_OTP_RESEND_SECONDS * 1000 - now()) / 1000);
        if (remaining > 0) {
          throw new VerificationError(`Please wait ${remaining} seconds before requesting another code.`, 429, "OTP_RESEND_COOLDOWN", remaining);
        }
      }
      const delivery = await createEmailVerification(connection, user);
      return { message: "A new verification code has been sent to your email.", resendAfter: delivery.resendAfter };
    });
  }

  return { createEmailVerification, verifyEmailOtp, resendVerificationOtp };
}

export const { createEmailVerification, verifyEmailOtp, resendVerificationOtp } = createEmailVerificationService();
