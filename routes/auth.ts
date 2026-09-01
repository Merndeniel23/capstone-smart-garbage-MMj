import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { Resend } from "resend";
import { db } from "../config/db.js";
import {
  requireAuth,
  requireAuthenticatedAccount,
  requireSessionAccount,
  requireTemporaryPasswordAccount,
  type AuthRequest,
} from "../middleware/auth.js";
import {
  getJwtSecret,
  isStrongPassword,
} from "../config/security.js";

const router = Router();

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
);

function getResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  return apiKey ? new Resend(apiKey) : null;
}

function getResendFromAddress() {
  const configured = String(process.env.RESEND_FROM_EMAIL || "").trim();

  // The Resend test sender works for local development. A deployed app must
  // replace it with a sender from a verified domain.
  if (
    !configured ||
    /YOUR-VERIFIED-SENDER|YOUR-DOMAIN|noreply@example\.com/i.test(configured)
  ) {
    return "Smart Garbage <onboarding@resend.dev>";
  }

  return configured;
}

function createToken(user: {
  id: number;
  role: string;
  email: string;
  barangay_id?: number | null;
  purok_id?: number | null;
}) {
  const jwtSecret = getJwtSecret();

  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email,
      barangay_id:
        user.barangay_id ?? null,
      purok_id:
        user.purok_id ?? null,
    },
    jwtSecret,
    {
      expiresIn: "12h",
    },
  );
}

function normalizeEmail(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(value: string) {
  return value.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePhilippinePhone(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[\s()-]/g, "");
}

function isValidPhilippinePhone(value: string) {
  return /^(?:09\d{9}|\+639\d{9})$/.test(value);
}

function createOtpHash(email: string, otp: string) {
  const secret = getJwtSecret();

  return crypto
    .createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}:${otp}`)
    .digest("hex");
}

function otpMatches(email: string, otp: string, storedHash: unknown) {
  const expected = Buffer.from(createOtpHash(email, otp), "hex");
  const actual = Buffer.from(String(storedHash || ""), "hex");

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function sendRegistrationVerificationEmail(
  email: string,
  fullName: string,
  otp: string,
) {
  const client = getResendClient();

  if (!client) {
    return new Error("Email verification is not configured on the server.");
  }

  try {
    const { error } = await client.emails.send({
      from: getResendFromAddress(),
      to: email,
      subject: "Verify your Smart Garbage account",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
          <h2>Verify your Smart Garbage account</h2>
          <p>Hello ${escapeHtml(fullName)},</p>
          <p>Your 6-digit email verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${otp}</div>
          <p>This code expires after 10 minutes. If you did not create this account, ignore this email.</p>
        </div>
      `,
    });

    return error ? new Error("Unable to send the verification email.") : null;
  } catch {
    return new Error("Unable to send the verification email.");
  }
}

async function notifyBarangayAdminOfApprovalRequest(user: {
  id: number;
  full_name: string;
  barangay_id: number;
}) {
  await db.execute(
    `
    INSERT INTO notifications
    (
      recipient_user_id,
      recipient_role,
      barangay_id,
      purok_id,
      notification_type,
      priority,
      title,
      message,
      related_entity_type,
      related_entity_id,
      created_by
    )
    SELECT
      NULL,
      'admin',
      ?,
      NULL,
      'account_approval_request',
      'notice',
      'Account approval requested',
      ?,
      'user_account',
      ?,
      ?
    WHERE NOT EXISTS
    (
      SELECT 1
      FROM notifications
      WHERE notification_type = 'account_approval_request'
        AND related_entity_type = 'user_account'
        AND related_entity_id = ?
        AND recipient_role = 'admin'
        AND barangay_id = ?
      LIMIT 1
    )
    `,
    [
      user.barangay_id,
      `${user.full_name} submitted a resident account for approval. Review it in Manage Users.`,
      user.id,
      user.id,
      user.id,
      user.barangay_id,
    ],
  );

  // Municipal administrators have a global view, so keep this notification
  // unscoped by barangay while still targeting only super-admin accounts.
  await db.execute(
    `
    INSERT INTO notifications
    (
      recipient_user_id,
      recipient_role,
      barangay_id,
      purok_id,
      notification_type,
      priority,
      title,
      message,
      related_entity_type,
      related_entity_id,
      created_by
    )
    SELECT
      NULL,
      'super_admin',
      NULL,
      NULL,
      'account_approval_request',
      'notice',
      'Account approval requested',
      ?,
      'user_account',
      ?,
      ?
    WHERE NOT EXISTS
    (
      SELECT 1
      FROM notifications
      WHERE notification_type = 'account_approval_request'
        AND related_entity_type = 'user_account'
        AND related_entity_id = ?
        AND recipient_role = 'super_admin'
      LIMIT 1
    )
    `,
    [
      `${user.full_name} submitted a resident account for approval. Review it in Manage Users.`,
      user.id,
      user.id,
      user.id,
    ],
  );
}

async function findPasswordResetUser(
  identifier: string,
) {
  const [rows] = await db.query<any[]>(
    `
    SELECT
      id,
      full_name,
      email,
      recovery_email,
      status
    FROM users
    WHERE LOWER(email) = ?
       OR LOWER(COALESCE(recovery_email, '')) = ?
    LIMIT 1
    `,
    [identifier, identifier],
  );

  return rows[0] || null;
}

function getResetRecipientEmail(
  user: {
    email: string;
    recovery_email?: string | null;
  },
  identifier: string,
) {
  const recoveryEmail = normalizeEmail(
    user.recovery_email,
  );

  if (
    recoveryEmail &&
    recoveryEmail === identifier
  ) {
    return recoveryEmail;
  }

  return normalizeEmail(user.email);
}

/**
 * PUBLIC: Load real barangays and puroks for registration.
 */
router.get(
  "/registration-locations",
  async (_req, res) => {
    try {
      const [barangays] =
        await db.query<any[]>(
          `
          SELECT
            id,
            name
          FROM barangays
          WHERE is_active = 1
          ORDER BY name ASC
          `,
        );

      const [puroks] =
        await db.query<any[]>(
          `
          SELECT
            p.id,
            p.barangay_id,
            p.name,
            b.name AS barangay_name
          FROM puroks p
          INNER JOIN barangays b
            ON b.id = p.barangay_id
          WHERE b.is_active = 1
          ORDER BY
            b.name ASC,
            p.name ASC
          `,
        );

      return res.json({
        success: true,
        barangays,
        puroks,
      });
    } catch (error) {
      console.error(
        "Registration locations error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load registration locations.",
      });
    }
  },
);

router.post(
  "/login",
  async (req, res) => {
    try {
      const email = String(
        req.body.email || "",
      )
        .trim()
        .toLowerCase();

      const password = String(
        req.body.password || "",
      );

      if (!email || email.length > 150 || !password || password.length > 72) {
        return res.status(400).json({
          message:
            "Email and password are required.",
        });
      }

      const [rows] =
        await db.query<any[]>(
          `
          SELECT
            u.id,
            u.barangay_id,
            u.purok_id,
            u.full_name,
            u.email,
            u.password_hash,
            u.role,
            u.phone,
            u.address,
            u.duty_latitude,
            u.duty_longitude,
            u.status,
            u.must_change_password,
            b.name AS barangay_name,
            p.name AS purok_name
          FROM users u
          LEFT JOIN barangays b
            ON b.id = u.barangay_id
          LEFT JOIN puroks p
            ON p.id = u.purok_id
          WHERE u.email = ?
          LIMIT 1
          `,
          [email],
        );

      const user = rows[0];

      if (
        !user ||
        !(await bcrypt.compare(
          password,
          user.password_hash,
        ))
      ) {
        return res.status(401).json({
          message:
            "Incorrect email or password.",
        });
      }

      if (user.status === "pending") {
        return res.status(403).json({
          message:
            "Your account is waiting for Barangay Captain approval.",
        });
      }

      if (user.status !== "active") {
        return res.status(403).json({
          message:
            "This account is inactive. Please contact the Barangay Captain.",
        });
      }

      const token =
        createToken(user);

      delete user.password_hash;

      return res.json({
        message:
          "Login successful.",
        token,
        user,
        mustChangePassword: Boolean(user.must_change_password),
        needsLocationSetup:
          user.role === "resident" &&
          (
            !user.barangay_id ||
            !user.purok_id ||
            !String(user.address || "").trim() ||
            !String(user.phone || "").trim()
          ),
      });
    } catch (error) {
      console.error(
        "Login error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to login. Check the database connection.",
      });
    }
  },
);

/**
 * PUBLIC REGISTRATION
 *
 * Every new public account is automatically a Civilian:
 * role = resident
 *
 * The real barangay_id is taken from the selected purok.
 */
router.post(
  "/register",
  async (req, res) => {
    try {
      const fullName = String(
        req.body.fullName || "",
      ).trim();

      const email = String(
        req.body.email || "",
      )
        .trim()
        .toLowerCase();

      const password = String(
        req.body.password || "",
      );

      const phone = String(
        req.body.phone || "",
      ).trim();

      const normalizedPhone = normalizePhilippinePhone(phone);

      const address = String(
        req.body.address || "",
      ).trim();

      const purokId = Number(
        req.body.purokId,
      );

      if (
        !fullName ||
        !email ||
        !isStrongPassword(password)
      ) {
        return res.status(400).json({
          message:
            "Full name, valid email, and a password with at least 8 characters, uppercase, lowercase, and a number are required.",
        });
      }

      if (fullName.length > 150 || address.length > 255) {
        return res.status(400).json({
          message: "Full name or address is too long.",
        });
      }

      if (!phone || !address) {
        return res.status(400).json({
          message:
            "Phone number and complete address are required.",
        });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({
          message: "Enter a valid email address.",
        });
      }

      if (!isValidPhilippinePhone(normalizedPhone)) {
        return res.status(400).json({
          message:
            "Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).",
        });
      }

      if (!getResendClient()) {
        return res.status(503).json({
          message: "Email verification is not configured on the server.",
        });
      }

      if (
        !Number.isInteger(purokId) ||
        purokId <= 0
      ) {
        return res.status(400).json({
          message:
            "Please select a valid barangay and purok.",
        });
      }

      const [purokRows] =
        await db.query<any[]>(
          `
          SELECT
            p.id,
            p.barangay_id,
            p.name AS purok_name,
            b.name AS barangay_name
          FROM puroks p
          INNER JOIN barangays b
            ON b.id = p.barangay_id
          WHERE p.id = ?
            AND b.is_active = 1
          LIMIT 1
          `,
          [purokId],
        );

      const selectedPurok =
        purokRows[0];

      if (!selectedPurok) {
        return res.status(404).json({
          message:
            "The selected barangay or purok was not found.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12,
        );

      const [result] =
        await db.execute<any>(
          `
          INSERT INTO users
          (
            barangay_id,
            purok_id,
            full_name,
            email,
            password_hash,
            role,
            phone,
            address,
            status
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?,
            'resident',
            ?,
            ?,
            'pending'
          )
          `,
          [
            selectedPurok.barangay_id,
            selectedPurok.id,
            fullName,
            email,
            passwordHash,
            normalizedPhone,
            address,
          ],
        );

      const userId = Number(result.insertId);
      const verificationOtp = String(crypto.randomInt(100000, 1000000));

      await db.execute(
        `
        INSERT INTO email_verifications
          (user_id, email, otp_hash, attempt_count, expires_at)
        VALUES (?, ?, ?, 0, ?)
        `,
        [
          userId,
          email,
          createOtpHash(email, verificationOtp),
          new Date(Date.now() + 10 * 60 * 1000),
        ],
      );

      const emailError = await sendRegistrationVerificationEmail(
        email,
        fullName,
        verificationOtp,
      );

      if (emailError) {
        await db.execute("DELETE FROM users WHERE id = ? AND status = 'pending'", [userId]);
        return res.status(503).json({
          message: "Unable to send the verification email. Please try again.",
        });
      }

      return res.status(201).json({
        message:
          "Registration started. Check your email for the verification code.",
        verificationRequired: true,
        email,
        userId,
        assignment: {
          barangay_id:
            selectedPurok.barangay_id,
          barangay_name:
            selectedPurok.barangay_name,
          purok_id:
            selectedPurok.id,
          purok_name:
            selectedPurok.purok_name,
        },
      });
    } catch (error: any) {
      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          message:
            "Email is already registered.",
        });
      }

      console.error(
        "Registration error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to register user.",
      });
    }
  },
);

/**
 * Confirm the email address used for a new public registration. Verification
 * is deliberately separate from login so an unverified address cannot create
 * an active account or access tenant data.
 */
router.post("/verify-registration-email", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();

  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      message: "A valid email and 6-digit verification code are required.",
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [userRows] = await connection.query<any[]>(
      `
      SELECT id, full_name, status, email_verified_at
      FROM users
      WHERE LOWER(email) = ?
        AND role = 'resident'
      LIMIT 1
      FOR UPDATE
      `,
      [email],
    );

    const user = userRows[0];

    if (!user || user.status !== "pending" || user.email_verified_at) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    const [verificationRows] = await connection.query<any[]>(
      `
      SELECT id, otp_hash, attempt_count, expires_at
      FROM email_verifications
      WHERE user_id = ?
        AND email = ?
        AND verified_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [user.id, email],
    );

    const verification = verificationRows[0];

    if (
      !verification ||
      Number(verification.attempt_count || 0) >= 5 ||
      new Date(verification.expires_at).getTime() <= Date.now()
    ) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    if (!otpMatches(email, otp, verification.otp_hash)) {
      await connection.execute(
        `UPDATE email_verifications SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [verification.id],
      );
      await connection.commit();
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    await connection.execute(
      `UPDATE email_verifications SET verified_at = NOW() WHERE id = ? AND verified_at IS NULL`,
      [verification.id],
    );
    await connection.execute(
      `
      UPDATE users
      SET status = 'active', email_verified_at = NOW(), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending' AND email_verified_at IS NULL
      `,
      [user.id],
    );

    await connection.commit();
    return res.json({
      message: "Email verified successfully. You can now sign in.",
      email,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Verify registration email error:", error);
    return res.status(500).json({ message: "Unable to verify the email address." });
  } finally {
    connection.release();
  }
});

router.post("/resend-registration-email", async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }

  try {
    const [userRows] = await db.query<any[]>(
      `SELECT id, full_name, status, email_verified_at FROM users WHERE LOWER(email) = ? AND role = 'resident' LIMIT 1`,
      [email],
    );
    const user = userRows[0];

    if (!user || user.status !== "pending" || user.email_verified_at) {
      return res.json({ message: "If the account is awaiting verification, a new code has been sent." });
    }

    const [recentRows] = await db.query<any[]>(
      `
      SELECT created_at
      FROM email_verifications
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [user.id],
    );
    const recentCreatedAt = recentRows[0]?.created_at
      ? new Date(recentRows[0].created_at).getTime()
      : 0;

    if (recentCreatedAt && Date.now() - recentCreatedAt < 60 * 1000) {
      return res.status(429).json({
        message: "Please wait before requesting another verification code.",
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    await db.execute("DELETE FROM email_verifications WHERE user_id = ?", [user.id]);
    await db.execute(
      `INSERT INTO email_verifications (user_id, email, otp_hash, attempt_count, expires_at) VALUES (?, ?, ?, 0, ?)`,
      [user.id, email, createOtpHash(email, otp), new Date(Date.now() + 10 * 60 * 1000)],
    );

    const emailError = await sendRegistrationVerificationEmail(email, user.full_name, otp);

    if (emailError) {
      return res.status(503).json({ message: "Unable to send the verification email. Please try again." });
    }

    return res.json({ message: "If the account is awaiting verification, a new code has been sent." });
  } catch (error) {
    console.error("Resend registration email error:", error);
    return res.status(500).json({ message: "Unable to resend the verification email." });
  }
});

router.post(
  "/google",
  async (req, res) => {
    try {
      const credential = String(
        req.body.credential || "",
      ).trim();

      const googleClientId =
        process.env.GOOGLE_CLIENT_ID;

      if (!googleClientId) {
        return res.status(500).json({
          message:
            "Google login is not configured on the server.",
        });
      }

      if (!credential) {
        return res.status(400).json({
          message:
            "Google credential is required.",
        });
      }

      const ticket =
        await googleClient.verifyIdToken(
          {
            idToken: credential,
            audience:
              googleClientId,
          },
        );

      const payload =
        ticket.getPayload();

      if (
        !payload?.email ||
        !payload.email_verified
      ) {
        return res.status(401).json({
          message:
            "Google account email could not be verified.",
        });
      }

      const email =
        payload.email
          .trim()
          .toLowerCase();

      const fullName =
        String(
          payload.name || "",
        ).trim() ||
        String(
          payload.given_name || "",
        ).trim() ||
        email.split("@")[0];

      const [existingRows] =
        await db.query<any[]>(
          `
          SELECT
            u.id,
            u.barangay_id,
            u.purok_id,
            u.full_name,
            u.email,
            u.email_verified_at,
            u.role,
            u.status,
            u.phone,
            u.address,
            u.created_at,
            b.name AS barangay_name,
            p.name AS purok_name
          FROM users u
          LEFT JOIN barangays b
            ON b.id = u.barangay_id
          LEFT JOIN puroks p
            ON p.id = u.purok_id
          WHERE u.email = ?
          LIMIT 1
          `,
          [email],
        );

      let user =
        existingRows[0];

      if (user) {
        await db.execute(
          `
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, NOW())
          WHERE id = ?
          `,
          [user.id],
        );

        user.email_verified_at =
          user.email_verified_at || new Date();

        const isIncompleteResidentSetup =
          user.role === "resident" &&
          (
            !user.barangay_id ||
            !user.purok_id ||
            !String(user.address || "").trim() ||
            !String(user.phone || "").trim()
          );

        if (user.status === "inactive") {
          return res.status(403).json({
            message:
              "This account is inactive. Please contact the Barangay Captain.",
          });
        }

        if (
          user.status === "pending" &&
          !isIncompleteResidentSetup
        ) {
          try {
            await notifyBarangayAdminOfApprovalRequest({
              id: Number(user.id),
              full_name: String(user.full_name),
              barangay_id: Number(user.barangay_id),
            });
          } catch (notificationError) {
            console.error(
              "Account approval notification error:",
              notificationError,
            );
          }

          return res.status(403).json({
            message:
              "Your resident profile is waiting for Barangay Captain approval.",
            pendingApproval: true,
          });
        }

        if (
          user.status === "pending" &&
          user.role !== "resident"
        ) {
          return res.status(403).json({
            message:
              "This account is waiting for administrator approval.",
          });
        }
      } else {
        /*
         * Google-created Civilian accounts have no location yet.
         * The frontend should ask the user to complete barangay,
         * purok, phone, and address before using location-based features.
         */
        const randomPassword =
          crypto
            .randomBytes(32)
            .toString("hex");

        const passwordHash =
          await bcrypt.hash(
            randomPassword,
            12,
          );

        try {
          const [insertResult] =
            await db.execute<any>(
              `
              INSERT INTO users
              (
                barangay_id,
                purok_id,
                full_name,
                email,
                email_verified_at,
                password_hash,
                role,
                status
              )
              VALUES
              (
                NULL,
                NULL,
                ?,
                ?,
                NOW(),
                ?,
                'resident',
                'pending'
              )
              `,
              [
                fullName,
                email,
                passwordHash,
              ],
            );

          const [newRows] =
            await db.query<any[]>(
              `
              SELECT
                id,
                barangay_id,
                purok_id,
                full_name,
                email,
                email_verified_at,
                role,
                status,
                phone,
                address,
                created_at
              FROM users
              WHERE id = ?
              LIMIT 1
              `,
              [
                insertResult.insertId,
              ],
            );

          user = newRows[0];
        } catch (
          insertError: any
        ) {
          if (
            insertError?.code !==
            "ER_DUP_ENTRY"
          ) {
            throw insertError;
          }

          const [duplicateRows] =
            await db.query<any[]>(
              `
              SELECT
                id,
                barangay_id,
                purok_id,
                full_name,
                email,
                email_verified_at,
                role,
                status,
                phone,
                address,
                created_at
              FROM users
              WHERE email = ?
              LIMIT 1
              `,
              [email],
            );

          user =
            duplicateRows[0];
        }
      }

      if (!user) {
        return res.status(500).json({
          message:
            "Unable to create or retrieve the Google account.",
        });
      }

      const token =
        createToken(user);

      return res.json({
        message: existingRows[0]
          ? "Google login successful."
          : "Google Civilian account created. Complete your barangay and purok assignment before using location-based features.",
        token,
        user,
        needsLocationSetup:
          !user.barangay_id ||
          !user.purok_id ||
          !String(user.address || "").trim() ||
          !String(user.phone || "").trim(),
        needsApproval:
          user.role === "resident" &&
          user.status === "pending",
      });
    } catch (error: any) {
      console.error(
        "Google login error:",
        error,
      );

      if (
        error?.message?.includes(
          "Wrong recipient",
        ) ||
        error?.message?.includes(
          "Invalid token signature",
        ) ||
        error?.message?.includes(
          "Token used too late",
        )
      ) {
        return res.status(401).json({
          message:
            "Invalid or expired Google credential.",
        });
      }

      return res.status(500).json({
        message:
          "Unable to complete Google login.",
      });
    }
  },
);

router.get(
  "/me",
  requireSessionAccount,
  async (
    req: AuthRequest,
    res,
  ) => {
    try {
      const [rows] =
        await db.query<any[]>(
          `
          SELECT
            u.id,
            u.barangay_id,
            b.name AS barangay_name,
            u.purok_id,
            p.name AS purok_name,
            u.full_name,
            u.email,
            u.role,
            u.phone,
            u.address,
            u.status,
            u.must_change_password,
            u.created_at
          FROM users u
          LEFT JOIN barangays b
            ON b.id = u.barangay_id
          LEFT JOIN puroks p
            ON p.id = u.purok_id
          WHERE u.id = ?
          LIMIT 1
          `,
          [req.user!.id],
        );

      if (!rows[0]) {
        return res.status(404).json({
          message:
            "User not found.",
        });
      }

      return res.json({
        success: true,
        user: rows[0],
      });
    } catch (error) {
      console.error(
        "Profile error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load user profile.",
      });
    }
  },
);

router.put(
  "/update-profile",
  requireAuthenticatedAccount,
  async (
    req: AuthRequest,
    res,
  ) => {
    try {
      const fullName = String(
        req.body.fullName || "",
      ).trim();

      const phone = String(
        req.body.phone || "",
      ).trim();

      const submittedAddress =
        String(
          req.body.address || "",
        ).trim();

      const submittedPurokId =
        req.body.purokId === null ||
        req.body.purokId === undefined ||
        req.body.purokId === ""
          ? null
          : Number(req.body.purokId);

      const submittedDutyLatitude =
        req.body.dutyLatitude === null ||
        req.body.dutyLatitude === undefined ||
        req.body.dutyLatitude === ""
          ? null
          : Number(req.body.dutyLatitude);

      const submittedDutyLongitude =
        req.body.dutyLongitude === null ||
        req.body.dutyLongitude === undefined ||
        req.body.dutyLongitude === ""
          ? null
          : Number(req.body.dutyLongitude);

      if (!fullName) {
        return res.status(400).json({
          message:
            "Full name is required.",
        });
      }

      if (fullName.length > 150 || submittedAddress.length > 255) {
        return res.status(400).json({
          message: "Full name or address is too long.",
        });
      }

      if (
        phone &&
        !/^\+?\d{7,15}$/.test(phone)
      ) {
        return res.status(400).json({
          message:
            "Phone number must contain digits only (7 to 15 digits, optional + at the start).",
        });
      }

      const [currentRows] =
        await db.query<any[]>(
          `
          SELECT
            role,
            barangay_id,
            purok_id,
            phone,
            address,
            duty_latitude,
            duty_longitude
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [req.user!.id],
        );

      const currentUser =
        currentRows[0];

      if (!currentUser) {
        return res.status(404).json({
          message:
            "User not found.",
        });
      }

      /*
       * Resident address/location becomes locked after the
       * initial profile has been completed.
       *
       * Google-created resident accounts start with NULL
       * barangay/purok/address, so they are allowed one
       * initial setup here.
       */
      const needsInitialResidentSetup =
        currentUser.role === "resident" &&
        (
          !currentUser.barangay_id ||
          !currentUser.purok_id ||
          !String(currentUser.address || "").trim()
        );

      let finalBarangayId =
        currentUser.barangay_id ?? null;

      let finalPurokId =
        currentUser.purok_id ?? null;

      let finalAddress =
        currentUser.role === "resident"
          ? currentUser.address
          : submittedAddress ||
            currentUser.address;

      if (needsInitialResidentSetup) {
        if (!phone) {
          return res.status(400).json({
            message:
              "Mobile number is required to complete your resident profile.",
          });
        }

        if (!submittedAddress) {
          return res.status(400).json({
            message:
              "Physical address is required to complete your resident profile.",
          });
        }

        if (
          !Number.isInteger(submittedPurokId) ||
          Number(submittedPurokId) <= 0
        ) {
          return res.status(400).json({
            message:
              "Select a valid purok to complete your resident profile.",
          });
        }

        const [locationRows] =
          await db.query<any[]>(
            `
            SELECT
              p.id AS purok_id,
              p.barangay_id
            FROM puroks p
            INNER JOIN barangays b
              ON b.id = p.barangay_id
            WHERE p.id = ?
              AND b.is_active = 1
            LIMIT 1
            `,
            [submittedPurokId],
          );

        const selectedLocation =
          locationRows[0];

        if (!selectedLocation) {
          return res.status(400).json({
            message:
              "The selected barangay/purok assignment is invalid.",
          });
        }

        finalBarangayId =
          Number(selectedLocation.barangay_id);

        finalPurokId =
          Number(selectedLocation.purok_id);

        finalAddress = submittedAddress;
      }

      let finalDutyLatitude =
        currentUser.duty_latitude ?? null;
      let finalDutyLongitude =
        currentUser.duty_longitude ?? null;

      if (currentUser.role === "purok_leader") {
        const hasLatitude =
          submittedDutyLatitude !== null;
        const hasLongitude =
          submittedDutyLongitude !== null;

        if (hasLatitude !== hasLongitude) {
          return res.status(400).json({
            message:
              "Both duty latitude and longitude are required.",
          });
        }

        if (hasLatitude && hasLongitude) {
          if (
            !Number.isFinite(submittedDutyLatitude) ||
            submittedDutyLatitude! < -90 ||
            submittedDutyLatitude! > 90 ||
            !Number.isFinite(submittedDutyLongitude) ||
            submittedDutyLongitude! < -180 ||
            submittedDutyLongitude! > 180
          ) {
            return res.status(400).json({
              message:
                "The selected duty location is invalid.",
            });
          }

          finalDutyLatitude =
            submittedDutyLatitude;
          finalDutyLongitude =
            submittedDutyLongitude;
        }
      }

      await db.execute(
        `
        UPDATE users
        SET
          full_name = ?,
          phone = ?,
          barangay_id = ?,
          purok_id = ?,
          address = ?,
          duty_latitude = ?,
          duty_longitude = ?,
          email_verified_at = CASE
            WHEN role = 'resident' AND status = 'pending'
              THEN COALESCE(email_verified_at, NOW())
            ELSE email_verified_at
          END
        WHERE id = ?
        `,
        [
          fullName,
          phone || null,
          finalBarangayId,
          finalPurokId,
          finalAddress || null,
          finalDutyLatitude,
          finalDutyLongitude,
          req.user!.id,
        ],
      );

      const [rows] =
        await db.query<any[]>(
          `
          SELECT
            u.id,
            u.barangay_id,
            b.name AS barangay_name,
            u.purok_id,
            p.name AS purok_name,
            u.full_name,
            u.email,
            u.email_verified_at,
            u.role,
            u.phone,
            u.address,
            u.duty_latitude,
            u.duty_longitude,
            u.status,
            u.created_at
          FROM users u
          LEFT JOIN barangays b
            ON b.id = u.barangay_id
          LEFT JOIN puroks p
            ON p.id = u.purok_id
          WHERE u.id = ?
          LIMIT 1
          `,
          [req.user!.id],
        );

      const updatedUser = rows[0];

      const pendingResidentApproval =
        updatedUser?.role === "resident" &&
        updatedUser?.status === "pending" &&
        updatedUser?.email_verified_at &&
        updatedUser?.barangay_id &&
        updatedUser?.purok_id &&
        String(updatedUser?.address || "").trim() &&
        String(updatedUser?.phone || "").trim();

      if (pendingResidentApproval) {
        try {
          await notifyBarangayAdminOfApprovalRequest({
            id: Number(updatedUser.id),
            full_name: String(updatedUser.full_name),
            barangay_id: Number(updatedUser.barangay_id),
          });
        } catch (notificationError) {
          console.error(
            "Account approval notification error:",
            notificationError,
          );
        }
      }

      return res.json({
        message: pendingResidentApproval
          ? "Resident profile submitted. Please wait for Barangay Captain approval."
          : "Profile updated successfully.",
        user: updatedUser,
        pendingApproval:
          Boolean(pendingResidentApproval),
      });
    } catch (error) {
      console.error(
        "Update profile error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to update profile.",
      });
    }
  },
);

router.put(
  "/change-temporary-password",
  requireTemporaryPasswordAccount,
  async (req: AuthRequest, res) => {
    const connection = await db.getConnection();

    try {
      const userId = Number(req.user?.id);
      const currentPassword = String(req.body.currentPassword || "");
      const newPassword = String(req.body.newPassword || "");
      const confirmPassword = String(req.body.confirmPassword || "");

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      if (!currentPassword || !newPassword || newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "Complete the password fields and ensure the new passwords match.",
        });
      }

      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
          success: false,
          message:
            "Use 8-72 characters with uppercase, lowercase, and a number.",
        });
      }

      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `
        SELECT id, password_hash, must_change_password
        FROM users
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [userId],
      );

      const user = rows[0];

      if (!user) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Account was not found.",
        });
      }

      if (!Boolean(user.must_change_password)) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "This account no longer has a temporary password.",
        });
      }

      const currentMatches = await bcrypt.compare(
        currentPassword,
        user.password_hash,
      );

      if (!currentMatches) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Current temporary password is incorrect.",
        });
      }

      if (await bcrypt.compare(newPassword, user.password_hash)) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Choose a password different from the temporary password.",
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      const [result]: any = await connection.execute(
        `
        UPDATE users
        SET
          password_hash = ?,
          must_change_password = 0,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND must_change_password = 1
        `,
        [passwordHash, userId],
      );

      if (Number(result.affectedRows) !== 1) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "The temporary password was already changed.",
        });
      }

      await connection.commit();

      return res.json({
        success: true,
        mustChangePassword: false,
        message: "Permanent password saved successfully.",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Change temporary password error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to change the temporary password.",
      });
    } finally {
      connection.release();
    }
  },
);

router.post(
  "/forgot-password",
  async (req, res) => {
    try {
      const identifier = normalizeEmail(
        req.body.email,
      );

      if (!identifier || identifier.length > 150) {
        return res.status(400).json({
          message:
            "Email is required.",
        });
      }

      const user =
        await findPasswordResetUser(
          identifier,
        );

      if (!user) {
        return res.json({
          message:
            "If the account exists, an OTP has been sent to its registered email.",
        });
      }

      if (user.status !== "active") {
        return res.json({
          message:
            "If the account exists, an OTP has been sent to its registered email.",
        });
      }

      const accountEmail =
        normalizeEmail(user.email);

      const recipientEmail =
        getResetRecipientEmail(
          user,
          identifier,
        );

      const otp = String(
        crypto.randomInt(
          100000,
          1000000,
        ),
      );

      const expiresAt = new Date(
        Date.now() + 10 * 60 * 1000,
      );
      const otpHash = createOtpHash(accountEmail, otp);

      await db.execute(
        `
        DELETE FROM password_resets
        WHERE email = ?
        `,
        [accountEmail],
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
          accountEmail,
          otpHash,
          expiresAt,
        ],
      );

      if (
        !String(
          process.env.RESEND_API_KEY || "",
        ).trim()
      ) {
        await db.execute(
          `
          DELETE FROM password_resets
          WHERE email = ?
          `,
          [accountEmail],
        );

        return res.status(500).json({
          message:
            "Password-reset email service is not configured.",
        });
      }

      const resendClient = getResendClient();

      if (!resendClient) {
        await db.execute(
          `DELETE FROM password_resets WHERE email = ?`,
          [accountEmail],
        );
        return res.status(503).json({
          message: "Password-reset email service is not configured.",
        });
      }

      let emailError: unknown = null;

      try {
        const { error } =
          await resendClient.emails.send({
          from: getResendFromAddress(),
          to: recipientEmail,
          subject:
            "Smart Garbage Password Reset OTP",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
              <h2>Smart Garbage Password Reset</h2>
              <p>Hello ${escapeHtml(user.full_name)},</p>
              <p>Your 6-digit password reset OTP is:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">
                ${otp}
              </div>
              <p>This OTP expires after 10 minutes.</p>
              <p>If you did not request this reset, ignore this email.</p>
            </div>
          `,
          });
        emailError = error;
      } catch (sendError) {
        emailError = sendError;
      }

      if (emailError) {
        console.error(
          "Resend email error:",
          emailError,
        );

        await db.execute(
          `
          DELETE FROM password_resets
          WHERE email = ?
          `,
          [accountEmail],
        );

        return res.status(500).json({
          message:
            "Unable to send the OTP email.",
        });
      }

      return res.json({
        message:
          "If the account exists, an OTP has been sent to its registered email.",
      });
    } catch (error) {
      console.error(
        "Forgot password error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to process the password reset request.",
      });
    }
  },
);

router.post(
  "/verify-otp",
  async (req, res) => {
    try {
      const identifier = normalizeEmail(
        req.body.email,
      );

      const otp = String(
        req.body.otp || "",
      ).trim();

      if (
        !identifier ||
        identifier.length > 150 ||
        !/^\d{6}$/.test(otp)
      ) {
        return res.status(400).json({
          message:
            "A valid email and 6-digit OTP are required.",
        });
      }

      const user =
        await findPasswordResetUser(
          identifier,
        );

      if (!user) {
        return res.status(400).json({
          message:
            "Incorrect or expired OTP.",
        });
      }

      const accountEmail =
        normalizeEmail(user.email);

      const [rows] =
        await db.query<any[]>(
          `
          SELECT
            id,
            email,
            otp_hash,
            attempt_count,
            consumed_at,
            expires_at
          FROM password_resets
          WHERE email = ?
            AND consumed_at IS NULL
          ORDER BY id DESC
          LIMIT 1
          `,
          [accountEmail],
        );

      const resetRequest =
        rows[0];

      if (!resetRequest) {
        return res.status(400).json({
          message:
            "Incorrect or expired OTP.",
        });
      }

      if (Number(resetRequest.attempt_count || 0) >= 5) {
        return res.status(429).json({
          message: "Too many incorrect OTP attempts. Request a new code.",
        });
      }

      if (
        new Date(
          resetRequest.expires_at,
        ).getTime() <= Date.now()
      ) {
        await db.execute(
          `
          DELETE FROM password_resets
          WHERE email = ?
          `,
          [accountEmail],
        );

        return res.status(400).json({
          message:
            "The OTP has expired. Request a new one.",
        });
      }

      if (!otpMatches(accountEmail, otp, resetRequest.otp_hash)) {
        const [attemptResult] = await db.execute<any>(
          `
          UPDATE password_resets
          SET attempt_count = attempt_count + 1
          WHERE id = ?
            AND consumed_at IS NULL
            AND attempt_count < 5
          `,
          [resetRequest.id],
        );

        if (Number(attemptResult.affectedRows) !== 1) {
          return res.status(429).json({
            message: "Too many incorrect OTP attempts. Request a new code.",
          });
        }

        return res.status(400).json({
          message: "Incorrect or expired OTP.",
        });
      }

      await db.execute(
        `
        UPDATE password_resets
        SET verified_at = NOW()
        WHERE id = ?
          AND consumed_at IS NULL
        `,
        [resetRequest.id],
      );

      return res.json({
        message:
          "OTP verified successfully.",
      });
    } catch (error) {
      console.error(
        "Verify OTP error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to verify the OTP.",
      });
    }
  },
);

router.post(
  "/reset-password",
  async (req, res) => {
    try {
      const identifier = normalizeEmail(
        req.body.email,
      );

      const otp = String(
        req.body.otp || "",
      ).trim();

      const newPassword = String(
        req.body.newPassword || "",
      );

      if (
        !identifier ||
        identifier.length > 150 ||
        !/^\d{6}$/.test(otp)
      ) {
        return res.status(400).json({
          message:
            "A valid email and 6-digit OTP are required.",
        });
      }

      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
          message:
            "The new password must contain 8-72 characters with uppercase, lowercase, and a number.",
        });
      }

      const user =
        await findPasswordResetUser(
          identifier,
        );

      if (!user) {
        return res.status(400).json({
          message:
            "Incorrect or expired OTP.",
        });
      }

      const accountEmail =
        normalizeEmail(user.email);

      const [resetRows] =
        await db.query<any[]>(
          `
          SELECT
            id,
            otp_hash,
            attempt_count,
            verified_at,
            consumed_at,
            expires_at
          FROM password_resets
          WHERE email = ?
            AND consumed_at IS NULL
          ORDER BY id DESC
          LIMIT 1
          `,
          [accountEmail],
        );

      const resetRequest =
        resetRows[0];

      if (!resetRequest) {
        return res.status(400).json({
          message:
            "Incorrect or expired OTP.",
        });
      }

      if (
        Number(resetRequest.attempt_count || 0) >= 5 ||
        !otpMatches(accountEmail, otp, resetRequest.otp_hash)
      ) {
        return res.status(400).json({
          message: "Incorrect or expired OTP.",
        });
      }

      if (
        new Date(
          resetRequest.expires_at,
        ).getTime() <= Date.now()
      ) {
        await db.execute(
          `
          DELETE FROM password_resets
          WHERE email = ?
          `,
          [accountEmail],
        );

        return res.status(400).json({
          message:
            "The OTP has expired. Request a new one.",
        });
      }

      if (!resetRequest.verified_at) {
        return res.status(400).json({
          message: "Verify the OTP before resetting the password.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          newPassword,
          12,
        );

      const connection =
        await db.getConnection();

      try {
        await connection.beginTransaction();

        const [consumeResult] = await connection.execute<any>(
          `
          UPDATE password_resets
          SET consumed_at = NOW()
          WHERE id = ?
            AND consumed_at IS NULL
            AND verified_at IS NOT NULL
            AND expires_at > NOW()
          `,
          [resetRequest.id],
        );

        if (Number(consumeResult.affectedRows) !== 1) {
          await connection.rollback();
          return res.status(409).json({
            message: "This OTP has already been used or has expired.",
          });
        }

        await connection.execute(
          `
          UPDATE users
          SET
            password_hash = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [
            passwordHash,
            user.id,
          ],
        );

        await connection.commit();
      } catch (transactionError) {
        await connection.rollback();
        throw transactionError;
      } finally {
        connection.release();
      }

      return res.json({
        message:
          "Password reset successfully. You can now log in.",
      });
    } catch (error) {
      console.error(
        "Reset password error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to reset the password.",
      });
    }
  },
);

/*
 * These older collector-verification endpoints are kept for compatibility.
 * New public registrations are Civilian accounts, while the Barangay Captain
 * promotes users through /api/admin/users/:id/role.
 */
router.get(
  "/admin/pending-collectors",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    try {
      if (
        String(req.user?.role || "").toLowerCase() !== "admin"
      ) {
        return res.status(403).json({
          message:
            "Barangay Captain access is required.",
        });
      }

      const barangayId = Number(req.user?.barangay_id);

      if (!Number.isInteger(barangayId) || barangayId <= 0) {
        return res.status(403).json({
          message:
            "Your Barangay Captain account must be assigned to a barangay.",
        });
      }

      const [rows] =
        await db.query<any[]>(
          `
          SELECT
            id,
            barangay_id,
            purok_id,
            full_name,
            email,
            phone,
            address,
            status,
            created_at
          FROM users
          WHERE role = 'collector'
            AND status = 'pending'
            AND barangay_id = ?
          ORDER BY
            created_at DESC,
            id DESC
          `,
          [barangayId],
        );

      return res.json({
        collectors: rows,
      });
    } catch (error) {
      console.error(
        "Pending collectors error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to load pending collector registrations.",
      });
    }
  },
);

router.patch(
  "/admin/collectors/:id/verification",
  requireAuth,
  async (
    req: AuthRequest,
    res,
  ) => {
    try {
      if (
        String(req.user?.role || "").toLowerCase() !== "admin"
      ) {
        return res.status(403).json({
          message:
            "Barangay Captain access is required.",
        });
      }

      const reviewerId = Number(req.user?.id);
      const barangayId = Number(req.user?.barangay_id);

      if (
        !Number.isInteger(reviewerId) ||
        reviewerId <= 0 ||
        !Number.isInteger(barangayId) ||
        barangayId <= 0
      ) {
        return res.status(403).json({
          message:
            "Your Barangay Captain account must be assigned to a barangay.",
        });
      }

      const collectorId =
        Number(req.params.id);

      const action = String(
        req.body.action || "",
      )
        .trim()
        .toLowerCase();

      if (
        !Number.isInteger(
          collectorId,
        ) ||
        collectorId <= 0
      ) {
        return res.status(400).json({
          message:
            "A valid collector ID is required.",
        });
      }

      if (
        action !== "approve" &&
        action !== "reject"
      ) {
        return res.status(400).json({
          message:
            "Action must be approve or reject.",
        });
      }

      const nextStatus =
        action === "approve"
          ? "active"
          : "inactive";

      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        // Lock and re-check the reviewer so a simultaneous role, status, or
        // tenant change cannot authorize a collector transition with stale
        // request data.
        const [reviewerRows] = await connection.query<any[]>(
          `
          SELECT
            role,
            status,
            barangay_id
          FROM users
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [reviewerId],
        );

        const reviewer = reviewerRows[0];

        if (
          !reviewer ||
          String(reviewer.role || "").toLowerCase() !== "admin" ||
          String(reviewer.status || "").toLowerCase() !== "active" ||
          Number(reviewer.barangay_id) !== barangayId
        ) {
          await connection.rollback();
          return res.status(403).json({
            message:
              "Barangay Captain access is required.",
          });
        }

        const [rows] = await connection.query<any[]>(
          `
          SELECT
            id,
            full_name,
            email,
            role,
            status
          FROM users
          WHERE id = ?
            AND role = 'collector'
            AND barangay_id = ?
          LIMIT 1
          FOR UPDATE
          `,
          [collectorId, barangayId],
        );

        const collector = rows[0];

        if (!collector) {
          await connection.rollback();
          return res.status(404).json({
            message:
              "Collector account was not found.",
          });
        }

        if (String(collector.status).toLowerCase() !== "pending") {
          await connection.rollback();
          return res.status(409).json({
            message:
              "This collector account has already been reviewed.",
          });
        }

        const [updateResult] = await connection.execute<any>(
          `
          UPDATE users
          SET status = ?
          WHERE id = ?
            AND role = 'collector'
            AND barangay_id = ?
            AND status = 'pending'
          `,
          [nextStatus, collectorId, barangayId],
        );

        if (Number(updateResult.affectedRows) !== 1) {
          await connection.rollback();
          return res.status(409).json({
            message:
              "This collector account has already been reviewed.",
          });
        }

        await connection.commit();

        return res.json({
          message:
            action === "approve"
              ? "Garbage Collector account approved successfully."
              : "Garbage Collector account rejected successfully.",
          collector: {
            ...collector,
            status: nextStatus,
          },
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error(
        "Collector verification error:",
        error,
      );

      return res.status(500).json({
        message:
          "Unable to review the Garbage Collector account.",
      });
    }
  },
);

export default router;
