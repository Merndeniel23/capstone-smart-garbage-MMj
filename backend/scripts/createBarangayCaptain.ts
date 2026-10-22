import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { db } from "../config/db.js";
import { isStrongPassword } from "../config/security.js";

dotenv.config();

/*
 * The Municipal role was removed, so the barangay's Admin (Barangay Captain)
 * is created once from the server. The Admin then creates Puroks, Purok
 * Leaders, Collectors and Households inside the system.
 *
 *   BARANGAY_NAME=Bangbang CAPTAIN_NAME="..." CAPTAIN_EMAIL=... \
 *   CAPTAIN_PASSWORD=... npm run create-barangay-captain
 */
function requiredEnvironment(name: string) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

const barangayName = requiredEnvironment("BARANGAY_NAME");
const fullName = requiredEnvironment("CAPTAIN_NAME");
const email = requiredEnvironment("CAPTAIN_EMAIL").toLowerCase();
const password = requiredEnvironment("CAPTAIN_PASSWORD");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("CAPTAIN_EMAIL must be a valid email address.");
}

if (!isStrongPassword(password)) {
  throw new Error(
    "CAPTAIN_PASSWORD must be 8-72 characters with uppercase, lowercase, and a number.",
  );
}

const connection = await db.getConnection();

try {
  await connection.beginTransaction();

  await connection.execute(
    "INSERT INTO barangays (name, is_active) VALUES (?, 1) ON DUPLICATE KEY UPDATE is_active = 1",
    [barangayName],
  );

  const [barangays] = await connection.query<any[]>(
    "SELECT id FROM barangays WHERE name = ? LIMIT 1 FOR UPDATE",
    [barangayName],
  );
  const barangayId = Number(barangays[0].id);

  const [existing] = await connection.query<any[]>(
    `SELECT id, email FROM users
     WHERE (LOWER(email) = ? OR (role = 'admin' AND barangay_id = ? AND email NOT LIKE '%@deleted.sgms.local'))
     LIMIT 1 FOR UPDATE`,
    [email, barangayId],
  );

  if (existing[0]) {
    throw new Error(
      existing[0].email === email
        ? "That email is already registered."
        : `Barangay ${barangayName} already has a Barangay Captain account.`,
    );
  }

  await connection.execute(
    `INSERT INTO users
     (full_name, email, password_hash, role, barangay_id, status, email_verified_at, must_change_password)
     VALUES (?, ?, ?, 'admin', ?, 'active', NOW(), 0)`,
    [fullName, email, await bcrypt.hash(password, 12), barangayId],
  );

  await connection.commit();

  console.log(`Barangay Captain created for Barangay ${barangayName}.`);
  console.log(`Email: ${email}`);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await db.end();
}
