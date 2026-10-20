import type { Pool } from "mysql2/promise";

// This additive startup migration is deliberately limited to temporary
// registrations. It must never seed or rewrite existing application data.
export async function ensureRegistrationSchema(database: Pick<Pool, "query">) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      email VARCHAR(150) NOT NULL,
      full_name VARCHAR(150) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      barangay_id INT UNSIGNED NULL,
      purok_id INT UNSIGNED NULL,
      phone VARCHAR(30) NULL,
      address VARCHAR(255) NULL,
      otp_hash VARCHAR(64) NOT NULL,
      registration_token_hash VARCHAR(64) NOT NULL,
      attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (email),
      KEY idx_pending_registrations_expiry (expires_at)
    ) ENGINE=InnoDB
  `);
}
