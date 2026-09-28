import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { db } from "../config/db.js";
import { getJwtSecret } from "../config/security.js";
import { emailDeliveryError, sendVerificationOtp } from "./email.js";
import { assertEmailDomainAcceptsMail, EmailDomainError } from "./emailDomain.js";
import {
  EMAIL_OTP_EXPIRY_SECONDS,
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_RESEND_SECONDS,
  generateOtp,
  isValidEmail,
  normalizeEmail,
  VerificationError,
} from "./emailVerification.js";

export interface PendingRegistrationInput {
  email: string;
  full_name: string;
  password_hash: string;
  barangay_id: number | null;
  purok_id: number | null;
  phone: string | null;
  address: string | null;
}

interface PendingRegistration extends PendingRegistrationInput {
  otp_hash: string;
  registration_token_hash: string;
  attempt_count: number;
  expires_at: Date;
  created_at: Date;
}

/** Public signups have no user ID or login session until their OTP is verified. */
export function createPendingRegistrationService(options: {
  pool?: Pick<Pool, "getConnection">;
  sendOtp?: typeof sendVerificationOtp;
  checkDomain?: (email: string) => Promise<void>;
  now?: () => number;
  secret?: () => string;
} = {}) {
  const pool = options.pool || db;
  const deliver = options.sendOtp || sendVerificationOtp;
  const checkDomain = options.checkDomain || assertEmailDomainAcceptsMail;
  const now = options.now || Date.now;
  const secret = options.secret || getJwtSecret;

  function hashOtp(email: string, otp: string) {
    return crypto.createHmac("sha256", secret())
      .update(`registration:${email}:${otp}`).digest("hex");
  }

  function hashRegistrationToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  function requireRegistrationToken(request: PendingRegistration, rawToken?: string) {
    const token = String(rawToken || "");
    const actual = Buffer.from(request.registration_token_hash, "hex");
    const expected = Buffer.from(hashRegistrationToken(token), "hex");
    if (!/^[a-f0-9]{64}$/.test(token) || actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)) {
      throw new VerificationError(
        "This signup request has changed or is not available in this browser. Please register again to get a new verification code.",
        409,
        "REGISTRATION_RESTART_REQUIRED",
      );
    }
  }

  async function transaction<T>(work: (connection: PoolConnection) => Promise<T>) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      const code = (error as { code?: string })?.code;
      if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
        throw new VerificationError("Another registration request is being processed. Please try again shortly.", 503, "REGISTRATION_BUSY");
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function findPending(connection: PoolConnection, email: string) {
    const [rows] = await connection.query<any[]>(
      "SELECT * FROM pending_registrations WHERE email = ? LIMIT 1 FOR UPDATE",
      [email],
    );
    return rows[0] as PendingRegistration | undefined;
  }

  async function accountExists(connection: PoolConnection, email: string) {
    const [users] = await connection.query<any[]>(
      "SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1",
      [email],
    );
    return users.length > 0;
  }

  async function ensureEmailAvailable(connection: PoolConnection, email: string) {
    if (await accountExists(connection, email)) {
      throw new VerificationError("Email is already registered. Please sign in.", 409, "ER_DUP_ENTRY");
    }
  }

  async function validateDomain(email: string) {
    if (!isValidEmail(email)) throw new VerificationError("Enter a valid email address.");
    try {
      await checkDomain(email);
    } catch (error) {
      if (error instanceof EmailDomainError) {
        throw new VerificationError(error.message, error.status, error.code);
      }
      throw error;
    }
  }

  async function sendCode(email: string, fullName: string, otp: string) {
    try {
      await deliver(email, fullName, otp);
    } catch (error) {
      const safeError = emailDeliveryError(error);
      throw new VerificationError(safeError.message, safeError.status, safeError.code);
    }
  }

  function cooldown(request: PendingRegistration) {
    return Math.max(0, Math.ceil(
      (new Date(request.created_at).getTime() + EMAIL_OTP_RESEND_SECONDS * 1000 - now()) / 1000,
    ));
  }

  async function startPendingRegistration(input: PendingRegistrationInput) {
    const email = normalizeEmail(input.email);
    // DNS runs before a transaction is held or any registration is stored.
    await validateDomain(email);
    return transaction(async (connection) => {
      const previous = await findPending(connection, email);
      // Read account availability after taking the request lock, so a
      // verification that just consumed this request is visible here.
      await ensureEmailAvailable(connection, email);
      const remaining = previous ? cooldown(previous) : 0;
      if (remaining > 0) {
        throw new VerificationError(`Please wait ${remaining} seconds before starting registration again.`, 429, "OTP_RESEND_COOLDOWN", remaining);
      }
      let otp = generateOtp();
      while (previous?.otp_hash === hashOtp(email, otp)) otp = generateOtp();
      const registrationToken = crypto.randomBytes(32).toString("hex");
      const registrationTokenHash = hashRegistrationToken(registrationToken);
      const expiresAt = new Date(now() + EMAIL_OTP_EXPIRY_SECONDS * 1000);
      // A fresh signup replaces both details and code together, never silently
      // reusing credentials submitted by someone else for the same address.
      if (previous) {
        await connection.execute(
          `UPDATE pending_registrations SET full_name = ?, password_hash = ?, barangay_id = ?,
           purok_id = ?, phone = ?, address = ?, otp_hash = ?, registration_token_hash = ?, attempt_count = 0,
           expires_at = ?, created_at = ? WHERE email = ?`,
          [input.full_name, input.password_hash, input.barangay_id, input.purok_id,
            input.phone, input.address, hashOtp(email, otp), registrationTokenHash, expiresAt, new Date(now()), email],
        );
      } else {
        await connection.execute(
          `INSERT INTO pending_registrations
           (email, full_name, password_hash, barangay_id, purok_id, phone, address,
            otp_hash, registration_token_hash, attempt_count, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [email, input.full_name, input.password_hash, input.barangay_id, input.purok_id,
            input.phone, input.address, hashOtp(email, otp), registrationTokenHash, expiresAt, new Date(now())],
        );
      }
      await sendCode(email, input.full_name, otp);
      return {
        message: "Check your email for the verification code. Your account will only be created after verification.",
        registrationToken,
        resendAfter: EMAIL_OTP_RESEND_SECONDS,
        expiresInSeconds: EMAIL_OTP_EXPIRY_SECONDS,
      };
    });
  }

  /** null lets the existing endpoints continue verifying staff and older accounts. */
  async function verifyPendingRegistration(rawEmail: string, rawOtp: string, registrationToken?: string) {
    const email = normalizeEmail(rawEmail);
    const otp = String(rawOtp || "").trim();
    if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
      throw new VerificationError("Enter your email and the 6-digit verification code.", 400, "INVALID_OTP");
    }
    const result = await transaction(async (connection) => {
      const request = await findPending(connection, email);
      if (!request) return null;
      if (await accountExists(connection, email)) {
        await connection.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);
        return null;
      }
      requireRegistrationToken(request, registrationToken);
      if (new Date(request.expires_at).getTime() <= now()) {
        throw new VerificationError("This verification code has expired. Please request a new code.", 400, "OTP_EXPIRED");
      }
      if (Number(request.attempt_count) >= EMAIL_OTP_MAX_ATTEMPTS) {
        throw new VerificationError("Too many incorrect codes. Please request a new verification code.", 429, "OTP_ATTEMPTS_EXCEEDED");
      }
      const expected = Buffer.from(hashOtp(email, otp), "hex");
      const actual = Buffer.from(request.otp_hash, "hex");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        await connection.execute(
          "UPDATE pending_registrations SET attempt_count = attempt_count + 1 WHERE email = ?",
          [email],
        );
        // Return the error so the failed attempt is committed before throwing.
        return new VerificationError("The verification code is incorrect.", 400, "INVALID_OTP");
      }
      if (request.purok_id || request.barangay_id) {
        const [locations] = await connection.query<any[]>(
          `SELECT p.id FROM puroks p INNER JOIN barangays b ON b.id = p.barangay_id
           WHERE p.id = ? AND b.id = ? AND b.is_active = 1 LIMIT 1`,
          [request.purok_id, request.barangay_id],
        );
        if (!locations.length) {
          await connection.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);
          return new VerificationError("The selected service area is no longer available. Please register again with a valid barangay and purok.", 400, "REGISTRATION_LOCATION_UNAVAILABLE");
        }
      }
      const needsProfile = !request.barangay_id || !request.purok_id ||
        !request.phone?.trim() || !request.address?.trim();
      const status = needsProfile ? "pending" : "active";
      await connection.execute(
        `INSERT INTO users
         (email, full_name, password_hash, barangay_id, purok_id, phone, address,
          role, status, email_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'resident', ?, ?)`,
        [email, request.full_name, request.password_hash, request.barangay_id, request.purok_id,
          request.phone, request.address, status, new Date(now())],
      );
      await connection.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);
      return {
        status,
        message: needsProfile
          ? "Email verified and account created. Sign in with Google to complete your resident profile."
          : "Email verified and account created. You may now sign in.",
      };
    });
    if (result instanceof VerificationError) throw result;
    return result;
  }

  async function resendPendingRegistration(rawEmail: string, registrationToken?: string) {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new VerificationError("Enter a valid email address.");
    return transaction(async (connection) => {
      const request = await findPending(connection, email);
      if (!request) return null;
      if (await accountExists(connection, email)) {
        await connection.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);
        return null;
      }
      requireRegistrationToken(request, registrationToken);
      const remaining = cooldown(request);
      if (remaining > 0) {
        throw new VerificationError(`Please wait ${remaining} seconds before requesting another code.`, 429, "OTP_RESEND_COOLDOWN", remaining);
      }
      let otp = generateOtp();
      while (request.otp_hash === hashOtp(email, otp)) otp = generateOtp();
      await connection.execute(
        `UPDATE pending_registrations SET otp_hash = ?, attempt_count = 0, expires_at = ?, created_at = ?
         WHERE email = ?`,
        [hashOtp(email, otp), new Date(now() + EMAIL_OTP_EXPIRY_SECONDS * 1000), new Date(now()), email],
      );
      await sendCode(email, request.full_name, otp);
      return { message: "A new verification code was sent. Your account will be created after verification.", resendAfter: EMAIL_OTP_RESEND_SECONDS };
    });
  }

  return { startPendingRegistration, verifyPendingRegistration, resendPendingRegistration };
}

export const { startPendingRegistration, verifyPendingRegistration, resendPendingRegistration } = createPendingRegistrationService();
