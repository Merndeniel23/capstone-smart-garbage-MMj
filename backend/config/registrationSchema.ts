import type { Pool } from "mysql2/promise";

async function safeAlter(database: Pick<Pool, "query">, sql: string) {
  try {
    await database.query(sql);
  } catch (error: any) {
    const ignored = new Set([
      "ER_DUP_FIELDNAME",
      "ER_DUP_KEYNAME",
      "ER_CANT_DROP_FIELD_OR_KEY",
      "ER_FK_DUP_NAME",
      "ER_MULTIPLE_PRI_KEY",
    ]);
    if (!ignored.has(String(error?.code || ""))) {
      // Log non-fatal migration notice without crashing server startup.
      console.warn("Schema alter skipped:", error?.code || error?.message);
    }
  }
}

// Ensures temporary registrations and the 4-role SGMS workflow tables/columns
// exist automatically on startup (including on Aiven / Render deployments).
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

  await safeAlter(
    database,
    "ALTER TABLE users MODIFY status ENUM('active','inactive','pending','pending_activation') NOT NULL DEFAULT 'active'",
  );
  await safeAlter(
    database,
    "ALTER TABLE users ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE puroks ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE garbage_bins ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL, ADD COLUMN archive_was_active TINYINT NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE bin_inspections ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE complaints ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL, ADD COLUMN admin_only TINYINT(1) NOT NULL DEFAULT 0",
  );
  await safeAlter(
    database,
    "ALTER TABLE complaints ADD COLUMN subject_user_id INT UNSIGNED NULL, ADD COLUMN subject_role ENUM('purok_leader','collector') NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE barangay_collection_schedules ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL, ADD COLUMN archive_was_active TINYINT NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE endorsement_requests ADD COLUMN archived_at DATETIME NULL, ADD COLUMN archived_by INT UNSIGNED NULL, ADD COLUMN issued_document_text TEXT NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE payments MODIFY payment_method ENUM('gcash','maya','over_the_counter','xendit') NOT NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE payments MODIFY category ENUM('weekly_fee','special_heavy_trash','hazardous_disposal','violation_fine') NOT NULL DEFAULT 'weekly_fee'",
  );

  await database.query(`
    CREATE TABLE IF NOT EXISTS account_activations (
      user_id INT UNSIGNED NOT NULL PRIMARY KEY,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS household_members (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      resident_id INT UNSIGNED NOT NULL,
      full_name VARCHAR(150) NOT NULL,
      relationship VARCHAR(80) NOT NULL,
      archived_at DATETIME NULL,
      archived_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS household_bins (
      bin_id INT UNSIGNED NOT NULL PRIMARY KEY,
      resident_id INT UNSIGNED NOT NULL,
      qr_hash CHAR(64) NOT NULL UNIQUE,
      registered_by INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // Resident can view their own bin QR later, so the token is kept alongside its hash.
  await safeAlter(
    database,
    "ALTER TABLE household_bins ADD COLUMN qr_token CHAR(64) NULL",
  );

  await database.query(`
    CREATE TABLE IF NOT EXISTS household_collections (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      run_id BIGINT UNSIGNED NULL,
      bin_id INT UNSIGNED NOT NULL,
      resident_id INT UNSIGNED NOT NULL,
      collector_id INT UNSIGNED NOT NULL,
      purok_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NOT NULL,
      segregation ENUM('segregated','not_segregated') NOT NULL,
      collection_status ENUM('collected','not_collected') NOT NULL,
      idempotency_key VARCHAR(80) NOT NULL,
      not_collected_reason VARCHAR(500) NULL,
      collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_collector_submission (collector_id, idempotency_key),
      KEY idx_household_pickups (resident_id, collected_at),
      KEY idx_purok_pickups (purok_id, collected_at),
      KEY idx_bin_pickups (bin_id, collected_at)
    ) ENGINE=InnoDB
  `);

  await safeAlter(
    database,
    "ALTER TABLE household_collections MODIFY run_id BIGINT UNSIGNED NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE household_collections ADD COLUMN not_collected_reason VARCHAR(500) NULL",
  );

  await database.query(`
    CREATE TABLE IF NOT EXISTS barangay_violation_policies (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      barangay_id INT UNSIGNED NOT NULL,
      title VARCHAR(180) NOT NULL,
      official_reference VARCHAR(255) NOT NULL,
      action ENUM('warning','fine','suspension') NOT NULL,
      fine_amount DECIMAL(10,2) NULL,
      suspension_days INT UNSIGNED NULL,
      suspension_scope ENUM('collection','account') NULL,
      approved_by INT UNSIGNED NOT NULL,
      approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active TINYINT NOT NULL DEFAULT 1,
      archived_at DATETIME NULL,
      archived_by INT UNSIGNED NULL,
      archive_was_active TINYINT NULL
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS household_violations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      collection_id BIGINT UNSIGNED NULL,
      policy_id BIGINT UNSIGNED NULL,
      resident_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NULL,
      purok_id INT UNSIGNED NULL,
      action ENUM('warning','fine','suspension') NULL,
      fine_amount DECIMAL(10,2) NULL,
      suspension_scope ENUM('collection','account') NULL,
      issued_by INT UNSIGNED NOT NULL,
      reason VARCHAR(1000) NOT NULL,
      suspension_until DATETIME NULL,
      issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_violation_collection (collection_id),
      KEY idx_violation_area (barangay_id, purok_id, issued_at)
    ) ENGINE=InnoDB
  `);

  await safeAlter(
    database,
    "ALTER TABLE household_violations MODIFY collection_id BIGINT UNSIGNED NULL, MODIFY policy_id BIGINT UNSIGNED NULL",
  );
  await safeAlter(
    database,
    "ALTER TABLE household_violations ADD COLUMN barangay_id INT UNSIGNED NULL, ADD COLUMN purok_id INT UNSIGNED NULL, ADD COLUMN action ENUM('warning','fine','suspension') NULL, ADD COLUMN fine_amount DECIMAL(10,2) NULL, ADD COLUMN suspension_scope ENUM('collection','account') NULL",
  );

  await database.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_id INT UNSIGNED NULL,
      actor_name VARCHAR(150) NOT NULL,
      actor_role VARCHAR(40) NOT NULL,
      barangay_id INT UNSIGNED NULL,
      purok_id INT UNSIGNED NULL,
      resident_id INT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(60) NOT NULL,
      entity_id BIGINT UNSIGNED NOT NULL,
      details JSON NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_activity_barangay (barangay_id, occurred_at),
      KEY idx_activity_resident (resident_id, occurred_at)
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS household_violation_reviews (
      violation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      decision ENUM('upheld','voided') NOT NULL,
      reason VARCHAR(1000) NOT NULL,
      reviewed_by INT UNSIGNED NOT NULL,
      reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS barangay_endorsement_templates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      barangay_id INT UNSIGNED NOT NULL,
      official_reference VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      approved_by INT UNSIGNED NOT NULL,
      approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS online_payment_attempts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      resident_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NOT NULL,
      purok_id INT UNSIGNED NOT NULL,
      external_id VARCHAR(80) NOT NULL UNIQUE,
      category VARCHAR(40) NOT NULL,
      billing_period VARCHAR(80) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      provider_id VARCHAR(120) NULL UNIQUE,
      checkout_url TEXT NULL,
      status ENUM('creating','pending','paid','expired') NOT NULL DEFAULT 'creating',
      payment_id BIGINT UNSIGNED NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME NULL,
      UNIQUE KEY uq_online_household_period (resident_id, category, billing_period)
    ) ENGINE=InnoDB
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS collector_purok_assignments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      collector_id INT UNSIGNED NOT NULL,
      purok_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NOT NULL,
      assigned_by INT UNSIGNED NULL,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_collector_purok (collector_id, purok_id)
    ) ENGINE=InnoDB
  `);
}
