import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Resend } from "resend";
import { db } from "../config/db.js";
import {
  requireTemporaryPasswordAccount,
  type AuthRequest,
} from "../middleware/auth.js";
import { getJwtSecret, isStrongPassword } from "../config/security.js";

const router = Router();

function getResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  return apiKey ? new Resend(apiKey) : null;
}

function getResendFromAddress() {
  const configured = String(process.env.RESEND_FROM_EMAIL || "").trim();

  if (
    !configured ||
    /YOUR-VERIFIED-SENDER|YOUR-DOMAIN|noreply@example\.com/i.test(configured)
  ) {
    return "Smart Garbage <onboarding@resend.dev>";
  }

  return configured;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEmail(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function generateOtp(): string {
  return String(
    crypto.randomInt(
      100000,
      1000000,
    ),
  );
}

function createOtpHash(email: string, otp: string): string {
  const secret = getJwtSecret();

  return crypto
    .createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}:${otp}`)
    .digest("hex");
}

function otpMatches(
  email: string,
  otp: string,
  storedHash: unknown,
): boolean {
  const expected = Buffer.from(createOtpHash(email, otp), "hex");
  const actual = Buffer.from(String(storedHash || ""), "hex");

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

function generateRecoveryCode(): string {
  return [
    "CORDOVA",
    crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase(),
    crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase(),
  ].join("-");
}

function validateNewPassword(
  password: string,
): string | null {
  if (!isStrongPassword(password)) {
    return "Password must contain 8-72 characters with uppercase, lowercase, and a number.";
  }

  return null;
}

/**
 * POST /api/super-admin/recovery/request-otp
 *
 * Sends a 6-digit OTP to the Super Admin recovery email.
 *
 * Body:
 * {
 *   "email": "superadmin@cordova.gov.ph"
 * }
 */
router.post(
  "/recovery/request-otp",
  async (req, res) => {
    try {
      const email = normalizeEmail(
        req.body.email,
      );

      if (!email) {
        return res.status(400).json({
          success: false,
          message:
            "Primary Super Admin email is required.",
        });
      }

      const [rows]: any =
        await db.query(
          `
          SELECT
            id,
            full_name,
            email,
            recovery_email,
            role,
            status
          FROM users
          WHERE email = ?
            AND role = 'super_admin'
          LIMIT 1
          `,
          [email],
        );

      const user = rows[0];

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "Super Admin account was not found.",
        });
      }

      if (
        String(user.status).toLowerCase() !==
        "active"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This Super Admin account is inactive.",
        });
      }

      const recoveryEmail =
        normalizeEmail(
          user.recovery_email,
        );

      if (!recoveryEmail) {
        return res.status(400).json({
          success: false,
          message:
            "No recovery email is configured for this account.",
        });
      }

      const otp = generateOtp();
      const otpHash = createOtpHash(email, otp);

      const expiresAt = new Date(
        Date.now() +
          10 * 60 * 1000,
      );

      await db.execute(
        `
        DELETE FROM password_resets
        WHERE email = ?
        `,
        [email],
      );

      await db.execute(
        `
        INSERT INTO password_resets
        (
          email,
          otp_hash,
          attempt_count,
          expires_at
        )
        VALUES (?, ?, 0, ?)
        `,
        [
          email,
          otpHash,
          expiresAt,
        ],
      );

      const resendClient = getResendClient();

      if (!resendClient) {
        await db.execute(`DELETE FROM password_resets WHERE email = ?`, [email]);
        return res.status(503).json({
          success: false,
          message: "Email service is not configured on the server.",
        });
      }

      let emailError: unknown = null;

      try {
        const { error } =
          await resendClient.emails.send({
          from: getResendFromAddress(),
          to: recoveryEmail,
          subject:
            "Super Admin Password Recovery OTP",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
              <h2>Smart Garbage Super Admin Recovery</h2>
              <p>Hello ${escapeHtml(user.full_name)},</p>
              <p>Your password recovery OTP is:</p>
              <div style="font-size:32px;font-weight:bold;letter-spacing:8px">
                ${otp}
              </div>
              <p>This OTP expires after 10 minutes.</p>
              <p>If you did not request this recovery, contact the Municipal IT administrator immediately.</p>
            </div>
          `,
          });
        emailError = error;
      } catch (sendError) {
        emailError = sendError;
      }

      if (emailError) {
        console.error(
          "Super Admin OTP email error:",
          emailError,
        );

        await db.execute(
          `
          DELETE FROM password_resets
          WHERE email = ?
          `,
          [email],
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to send the OTP to the recovery email.",
        });
      }

      const maskedRecoveryEmail =
        recoveryEmail.replace(
          /^(.{2}).*(@.*)$/,
          "$1***$2",
        );

      return res.json({
        success: true,
        message:
          "OTP sent to the configured recovery email.",
        recoveryEmail:
          maskedRecoveryEmail,
      });
    } catch (error) {
      console.error(
        "Request Super Admin OTP error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to process the recovery request.",
      });
    }
  },
);

/**
 * POST /api/super-admin/recovery/reset-with-otp
 *
 * Body:
 * {
 *   "email": "superadmin@cordova.gov.ph",
 *   "otp": "123456",
 *   "newPassword": "NewPassword123!"
 * }
 */
router.post(
  "/recovery/reset-with-otp",
  async (req, res) => {
    const connection =
      await db.getConnection();

    try {
      const email = normalizeEmail(
        req.body.email,
      );

      const otp = String(
        req.body.otp || "",
      ).trim();

      const newPassword = String(
        req.body.newPassword || "",
      );

      if (
        !email ||
        !/^\d{6}$/.test(otp)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A valid email and 6-digit OTP are required.",
        });
      }

      const passwordError =
        validateNewPassword(
          newPassword,
        );

      if (passwordError) {
        return res.status(400).json({
          success: false,
          message: passwordError,
        });
      }

      await connection.beginTransaction();

      const [userRows]: any =
        await connection.query(
          `
          SELECT id
          FROM users
          WHERE email = ?
            AND role = 'super_admin'
            AND status = 'active'
          LIMIT 1
          `,
          [email],
        );

      const user = userRows[0];

      if (!user) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Active Super Admin account was not found.",
        });
      }

      const [resetRows]: any =
        await connection.query(
          `
          SELECT
            id,
            otp_hash,
            attempt_count,
            expires_at
          FROM password_resets
          WHERE email = ?
            AND consumed_at IS NULL
          ORDER BY id DESC
          LIMIT 1
          `,
          [email],
        );

      const resetRequest =
        resetRows[0];

      if (!resetRequest) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Incorrect recovery OTP.",
        });
      }

      if (
        Number(resetRequest.attempt_count || 0) >= 5 ||
        !otpMatches(email, otp, resetRequest.otp_hash)
      ) {
        const [attemptResult]: any = await connection.execute(
          `
          UPDATE password_resets
          SET attempt_count = attempt_count + 1
          WHERE id = ?
            AND consumed_at IS NULL
            AND attempt_count < 5
          `,
          [resetRequest.id],
        );
        await connection.commit();

        if (Number(attemptResult.affectedRows) !== 1) {
          return res.status(429).json({
            success: false,
            message: "Too many incorrect recovery OTP attempts. Request a new one.",
          });
        }

        return res.status(400).json({
          success: false,
          message: "Incorrect or expired recovery OTP.",
        });
      }

      if (
        new Date(
          resetRequest.expires_at,
        ).getTime() <= Date.now()
      ) {
        await connection.execute(
          `
          DELETE FROM password_resets
          WHERE email = ?
          `,
          [email],
        );

        await connection.commit();

        return res.status(400).json({
          success: false,
          message:
            "The OTP has expired. Request a new one.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          newPassword,
          12,
        );

      const [consumeResult]: any = await connection.execute(
        `
        UPDATE password_resets
        SET consumed_at = NOW()
        WHERE id = ?
          AND consumed_at IS NULL
          AND expires_at > NOW()
        `,
        [resetRequest.id],
      );

      if (Number(consumeResult.affectedRows) !== 1) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "This OTP has already been used or has expired.",
        });
      }

      await connection.execute(
        `
        UPDATE users
        SET
          password_hash = ?,
          must_change_password = 0
        WHERE id = ?
        `,
        [passwordHash, user.id],
      );

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Super Admin password reset successfully.",
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Reset Super Admin with OTP error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to reset the Super Admin password.",
      });
    } finally {
      connection.release();
    }
  },
);

/**
 * POST /api/super-admin/recovery/reset-with-code
 *
 * Uses the printed/offline emergency recovery code.
 *
 * Body:
 * {
 *   "email": "superadmin@cordova.gov.ph",
 *   "recoveryCode": "CORDOVA-XXXXXX-XXXXXX",
 *   "newPassword": "NewPassword123!"
 * }
 *
 * A successful reset invalidates the old code and generates a new one.
 */
router.post(
  "/recovery/reset-with-code",
  async (req, res) => {
    const connection =
      await db.getConnection();

    try {
      const email = normalizeEmail(
        req.body.email,
      );

      const recoveryCode = String(
        req.body.recoveryCode || "",
      )
        .trim()
        .toUpperCase();

      const newPassword = String(
        req.body.newPassword || "",
      );

      if (
        !email ||
        !recoveryCode
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Super Admin email and emergency recovery code are required.",
        });
      }

      const passwordError =
        validateNewPassword(
          newPassword,
        );

      if (passwordError) {
        return res.status(400).json({
          success: false,
          message: passwordError,
        });
      }

      await connection.beginTransaction();

      const [userRows]: any =
        await connection.query(
          `
          SELECT
            id,
            status
          FROM users
          WHERE email = ?
            AND role = 'super_admin'
          LIMIT 1
          `,
          [email],
        );

      const user = userRows[0];

      if (!user) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Super Admin account was not found.",
        });
      }

      if (
        String(user.status).toLowerCase() !==
        "active"
      ) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message:
            "This Super Admin account is inactive.",
        });
      }

      const [codeRows]: any =
        await connection.query(
          `
          SELECT
            id,
            code_hash
          FROM super_admin_recovery_codes
          WHERE user_id = ?
            AND is_used = 0
          ORDER BY id DESC
          LIMIT 1
          `,
          [user.id],
        );

      const storedCode =
        codeRows[0];

      if (!storedCode) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "No active emergency recovery code is available.",
        });
      }

      const codeMatches =
        await bcrypt.compare(
          recoveryCode,
          storedCode.code_hash,
        );

      if (!codeMatches) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Incorrect emergency recovery code.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          newPassword,
          12,
        );

      const nextRecoveryCode =
        generateRecoveryCode();

      const nextCodeHash =
        await bcrypt.hash(
          nextRecoveryCode,
          12,
        );

      await connection.execute(
        `
        UPDATE users
        SET
          password_hash = ?,
          must_change_password = 0
        WHERE id = ?
        `,
        [
          passwordHash,
          user.id,
        ],
      );

      await connection.execute(
        `
        UPDATE super_admin_recovery_codes
        SET
          is_used = 1,
          used_at = NOW()
        WHERE id = ?
        `,
        [storedCode.id],
      );

      await connection.execute(
        `
        INSERT INTO super_admin_recovery_codes
        (
          user_id,
          code_hash,
          is_used
        )
        VALUES (?, ?, 0)
        `,
        [
          user.id,
          nextCodeHash,
        ],
      );

      await connection.commit();

      return res.json({
        success: true,
        message:
          "Super Admin password reset successfully. Save the new emergency recovery code securely.",
        newRecoveryCode:
          nextRecoveryCode,
      });
    } catch (error) {
      await connection.rollback();

      console.error(
        "Reset Super Admin with recovery code error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to reset the Super Admin password.",
      });
    } finally {
      connection.release();
    }
  },
);

/**
 * PUT /api/super-admin/change-temporary-password
 *
 * Used after first login when must_change_password = 1.
 *
 * Body:
 * {
 *   "currentPassword": "ChangeMe123!",
 *   "newPassword": "PermanentPassword123!"
 * }
 */
router.put(
  "/change-temporary-password",
  requireTemporaryPasswordAccount,
  async (req: AuthRequest, res) => {
    try {
      const userId = Number(
        req.user?.id,
      );

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication required.",
        });
      }

      const [rows]: any =
        await db.query(
          `
          SELECT
            id,
            role,
            password_hash
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [userId],
        );

      const user = rows[0];

      if (
        !user ||
        user.role !== "super_admin"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Super Admin access required.",
        });
      }

      const currentPassword =
        String(
          req.body.currentPassword ||
            "",
        );

      const newPassword = String(
        req.body.newPassword || "",
      );

      const passwordError =
        validateNewPassword(
          newPassword,
        );

      if (passwordError) {
        return res.status(400).json({
          success: false,
          message: passwordError,
        });
      }

      const currentMatches =
        await bcrypt.compare(
          currentPassword,
          user.password_hash,
        );

      if (!currentMatches) {
        return res.status(400).json({
          success: false,
          message:
            "Current temporary password is incorrect.",
        });
      }

      const samePassword =
        await bcrypt.compare(
          newPassword,
          user.password_hash,
        );

      if (samePassword) {
        return res.status(400).json({
          success: false,
          message:
            "Choose a new password different from the temporary password.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          newPassword,
          12,
        );

      await db.execute(
        `
        UPDATE users
        SET
          password_hash = ?,
          must_change_password = 0
        WHERE id = ?
        `,
        [
          passwordHash,
          userId,
        ],
      );

      return res.json({
        success: true,
        message:
          "Permanent Super Admin password saved successfully.",
      });
    } catch (error) {
      console.error(
        "Change temporary password error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to change the temporary password.",
      });
    }
  },
);

export default router;
