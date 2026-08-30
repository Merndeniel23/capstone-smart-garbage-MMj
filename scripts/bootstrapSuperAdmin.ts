import bcrypt from "bcryptjs";
import crypto from "crypto";
import dotenv from "dotenv";
import { db } from "../config/db.js";

dotenv.config();

function requiredEnvironment(name: string) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function validatePassword(password: string) {
  if (
    password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error(
      "SUPER_ADMIN_TEMP_PASSWORD must be at least 12 characters and include uppercase, lowercase, number, and symbol.",
    );
  }
}

function createRecoveryCode() {
  return [
    "CORDOVA",
    crypto.randomBytes(4).toString("hex").toUpperCase(),
    crypto.randomBytes(4).toString("hex").toUpperCase(),
  ].join("-");
}

const fullName = requiredEnvironment("SUPER_ADMIN_NAME");
const email = requiredEnvironment("SUPER_ADMIN_EMAIL").toLowerCase();
const recoveryEmail = requiredEnvironment("SUPER_ADMIN_RECOVERY_EMAIL").toLowerCase();
const temporaryPassword = requiredEnvironment("SUPER_ADMIN_TEMP_PASSWORD");

validatePassword(temporaryPassword);

const connection = await db.getConnection();

try {
  await connection.beginTransaction();

  const [existingRows] = await connection.query<any[]>(
    `
    SELECT id, role
    FROM users
    WHERE email = ?
    LIMIT 1
    FOR UPDATE
    `,
    [email],
  );

  if (existingRows[0]) {
    if (existingRows[0].role !== "super_admin") {
      throw new Error(
        "That email already belongs to a non-Super-Admin account. Choose another email.",
      );
    }

    throw new Error(
      "The Super Admin account already exists. Use the recovery workflow instead of resetting it from a setup script.",
    );
  }

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const recoveryCode = createRecoveryCode();
  const recoveryCodeHash = await bcrypt.hash(recoveryCode, 12);

  const [result] = await connection.execute<any>(
    `
    INSERT INTO users (
      barangay_id,
      purok_id,
      full_name,
      email,
      recovery_email,
      password_hash,
      role,
      status,
      must_change_password
    )
    VALUES (NULL, NULL, ?, ?, ?, ?, 'super_admin', 'active', 1)
    `,
    [fullName, email, recoveryEmail, passwordHash],
  );

  await connection.execute(
    `
    INSERT INTO super_admin_recovery_codes (user_id, code_hash, is_used)
    VALUES (?, ?, 0)
    `,
    [result.insertId, recoveryCodeHash],
  );

  await connection.commit();

  console.log("Super Admin account created.");
  console.log(`Email: ${email}`);
  console.log(`One-time emergency recovery code: ${recoveryCode}`);
  console.log(
    "Store the recovery code offline now. The temporary password must be changed at first login.",
  );
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await db.end();
}
