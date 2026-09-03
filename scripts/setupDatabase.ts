import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mysql, { type Connection } from "mysql2/promise";

dotenv.config();

const databaseName = String(
  process.env.DB_NAME || "smart_garbage_manual_db",
).trim();

if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
  throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  multipleStatements: true,
});

function safeIdentifier(value: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }

  return `\`${value}\``;
}

async function tableExists(table: string) {
  const [rows] = await connection.query<any[]>(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = ?
      AND table_name = ?
    LIMIT 1
    `,
    [databaseName, table],
  );

  return Boolean(rows[0]);
}

async function columnExists(table: string, column: string) {
  const [rows] = await connection.query<any[]>(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = ?
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
    `,
    [databaseName, table, column],
  );

  return Boolean(rows[0]);
}

async function indexExists(table: string, index: string) {
  const [rows] = await connection.query<any[]>(
    `
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = ?
      AND table_name = ?
      AND index_name = ?
    LIMIT 1
    `,
    [databaseName, table, index],
  );

  return Boolean(rows[0]);
}

async function ensureColumn(
  table: string,
  column: string,
  definition: string,
) {
  if (await columnExists(table, column)) return;

  await connection.query(
    `ALTER TABLE ${safeIdentifier(table)} ADD COLUMN ${safeIdentifier(column)} ${definition}`,
  );
}

async function ensureIndex(
  table: string,
  index: string,
  definition: string,
) {
  if (await indexExists(table, index)) return;

  await connection.query(
    `ALTER TABLE ${safeIdentifier(table)} ADD ${definition}`,
  );
}

async function createCurrentSchema() {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(60) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS barangays (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_barangays_name (name)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS puroks (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      barangay_id INT UNSIGNED NULL,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_puroks_barangay_name (barangay_id, name),
      KEY idx_puroks_barangay (barangay_id),
      CONSTRAINT fk_puroks_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      purok_id INT UNSIGNED NULL,
      barangay_id INT UNSIGNED NULL,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(150) NOT NULL,
      email_verified_at DATETIME NULL,
      recovery_email VARCHAR(255) NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('super_admin','admin','purok_leader','collector','resident')
        NOT NULL DEFAULT 'resident',
      phone VARCHAR(30) NULL,
      address VARCHAR(255) NULL,
      status ENUM('active','inactive','pending') NOT NULL DEFAULT 'active',
      must_change_password TINYINT(1) NOT NULL DEFAULT 0,
      duty_latitude DECIMAL(10,7) NULL,
      duty_longitude DECIMAL(10,7) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      KEY idx_users_barangay_role (barangay_id, role, status),
      KEY idx_users_purok_role (purok_id, role, status),
      CONSTRAINT fk_users_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_users_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS password_resets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      otp VARCHAR(6) NULL,
      otp_hash VARCHAR(64) NULL,
      attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
      verified_at DATETIME NULL,
      consumed_at DATETIME NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_password_resets_email_created (email, created_at),
      KEY idx_password_resets_expiry (expires_at)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS email_verifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      email VARCHAR(150) NOT NULL,
      otp_hash VARCHAR(64) NOT NULL,
      attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
      verified_at DATETIME NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_verifications_user_created (user_id, created_at),
      KEY idx_email_verifications_expiry (expires_at),
      CONSTRAINT fk_email_verifications_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS super_admin_recovery_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      is_used TINYINT(1) NOT NULL DEFAULT 0,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_recovery_user_active (user_id, is_used),
      CONSTRAINT fk_super_admin_recovery_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS garbage_bins (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      purok_id INT UNSIGNED NOT NULL,
      bin_code VARCHAR(50) NOT NULL,
      location_name VARCHAR(180) NOT NULL,
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,
      current_status ENUM('empty','half_full','full','overflowing','damaged')
        NOT NULL DEFAULT 'empty',
      condition_status ENUM('good','needs_repair','out_of_service')
        NOT NULL DEFAULT 'good',
      last_inspected_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_garbage_bins_code (bin_code),
      KEY idx_garbage_bins_purok_active (purok_id, is_active),
      CONSTRAINT fk_garbage_bins_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS bin_inspections (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bin_id INT UNSIGNED NOT NULL,
      purok_leader_id INT UNSIGNED NOT NULL,
      status ENUM('empty','half_full','full','overflowing','damaged') NOT NULL,
      estimated_fill_level TINYINT UNSIGNED NULL,
      remarks TEXT NULL,
      photo_path VARCHAR(255) NULL,
      inspected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_inspections_bin_time (bin_id, inspected_at),
      KEY idx_inspections_leader_time (purok_leader_id, inspected_at),
      CONSTRAINT fk_inspections_bin
        FOREIGN KEY (bin_id) REFERENCES garbage_bins(id) ON DELETE CASCADE,
      CONSTRAINT fk_inspections_leader
        FOREIGN KEY (purok_leader_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS collection_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      bin_id INT UNSIGNED NOT NULL,
      inspection_id BIGINT UNSIGNED NULL,
      requested_by INT UNSIGNED NOT NULL,
      priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
      status ENUM('pending','approved','assigned','in_progress','completed','cancelled')
        NOT NULL DEFAULT 'pending',
      reason VARCHAR(255) NULL,
      assigned_collector_id INT UNSIGNED NULL,
      requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_collection_requests_bin_status (bin_id, status),
      KEY idx_collection_requests_collector_status (assigned_collector_id, status),
      KEY idx_collection_requests_requester (requested_by),
      CONSTRAINT fk_collection_requests_bin
        FOREIGN KEY (bin_id) REFERENCES garbage_bins(id) ON DELETE CASCADE,
      CONSTRAINT fk_collection_requests_inspection
        FOREIGN KEY (inspection_id) REFERENCES bin_inspections(id) ON DELETE SET NULL,
      CONSTRAINT fk_collection_requests_requester
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_requests_collector
        FOREIGN KEY (assigned_collector_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS barangay_collection_schedules (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      barangay_id INT UNSIGNED NOT NULL,
      day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
        NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      notes VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schedule_barangay_day (barangay_id, day_of_week),
      KEY idx_schedule_creator (created_by),
      CONSTRAINT fk_schedule_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE CASCADE,
      CONSTRAINT fk_schedule_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS garbage_trucks (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      truck_code VARCHAR(50) NOT NULL,
      plate_number VARCHAR(50) NOT NULL,
      vehicle_description VARCHAR(150) NULL,
      barangay_id INT UNSIGNED NULL,
      collector_user_id INT UNSIGNED NULL,
      status ENUM('active','maintenance','inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_garbage_trucks_code (truck_code),
      UNIQUE KEY uq_garbage_trucks_plate (plate_number),
      KEY idx_garbage_trucks_barangay_status (barangay_id, status),
      KEY idx_garbage_trucks_collector (collector_user_id),
      CONSTRAINT fk_garbage_trucks_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE SET NULL,
      CONSTRAINT fk_garbage_trucks_collector
        FOREIGN KEY (collector_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS truck_crew_members (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      truck_id INT UNSIGNED NOT NULL,
      full_name VARCHAR(150) NOT NULL,
      crew_role ENUM('driver','crew_leader','loader','helper') NOT NULL,
      phone VARCHAR(30) NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_truck_crew_truck_status (truck_id, status),
      CONSTRAINT fk_truck_crew_truck
        FOREIGN KEY (truck_id) REFERENCES garbage_trucks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS collection_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      schedule_id INT UNSIGNED NULL,
      barangay_id INT UNSIGNED NOT NULL,
      truck_id INT UNSIGNED NOT NULL,
      collector_user_id INT UNSIGNED NOT NULL,
      collection_date DATE NOT NULL,
      status ENUM('pending','in_progress','completed','cancelled')
        NOT NULL DEFAULT 'pending',
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_collection_runs_barangay_date (barangay_id, collection_date),
      KEY idx_collection_runs_collector_date (collector_user_id, collection_date),
      KEY idx_collection_runs_truck (truck_id),
      CONSTRAINT fk_collection_runs_schedule
        FOREIGN KEY (schedule_id) REFERENCES barangay_collection_schedules(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_collection_runs_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_runs_truck
        FOREIGN KEY (truck_id) REFERENCES garbage_trucks(id) ON DELETE RESTRICT,
      CONSTRAINT fk_collection_runs_collector
        FOREIGN KEY (collector_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS collector_locations (
      collector_id INT UNSIGNED NOT NULL,
      latitude DECIMAL(10,7) NOT NULL,
      longitude DECIMAL(10,7) NOT NULL,
      accuracy_meters DECIMAL(10,2) NULL,
      heading_degrees DECIMAL(10,2) NULL,
      speed_mps DECIMAL(10,2) NULL,
      is_on_duty TINYINT(1) NOT NULL DEFAULT 1,
      last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (collector_id),
      KEY idx_collector_locations_updated (last_updated_at),
      CONSTRAINT fk_collector_locations_user
        FOREIGN KEY (collector_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS collector_location_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      collector_id INT UNSIGNED NOT NULL,
      latitude DECIMAL(10,7) NOT NULL,
      longitude DECIMAL(10,7) NOT NULL,
      accuracy_meters DECIMAL(10,2) NULL,
      heading_degrees DECIMAL(10,2) NULL,
      speed_mps DECIMAL(10,2) NULL,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_collector_history_user_time (collector_id, recorded_at),
      KEY idx_collector_history_time (recorded_at),
      CONSTRAINT fk_collector_history_user
        FOREIGN KEY (collector_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS complaints (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      reported_by INT UNSIGNED NOT NULL,
      purok_id INT UNSIGNED NULL,
      complaint_type VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      phone VARCHAR(30) NULL,
      photo_url VARCHAR(255) NULL,
      status ENUM('pending','assigned','in_progress','completed','resolved','cancelled')
        NOT NULL DEFAULT 'pending',
      assigned_collector_id INT UNSIGNED NULL,
      resolution_remark TEXT NULL,
      assigned_at DATETIME NULL,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      resolved_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_complaints_status (status),
      KEY idx_complaints_reporter (reported_by, created_at),
      KEY idx_complaints_collector (assigned_collector_id, status),
      KEY idx_complaints_purok (purok_id, status),
      CONSTRAINT fk_complaints_reporter
        FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_complaints_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE SET NULL,
      CONSTRAINT fk_complaints_collector
        FOREIGN KEY (assigned_collector_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS complaint_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      complaint_id BIGINT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_complaint_messages_request_time (complaint_id, created_at),
      KEY idx_complaint_messages_sender (sender_id),
      CONSTRAINT fk_complaint_messages_complaint
        FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
      CONSTRAINT fk_complaint_messages_sender
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS payments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      transaction_code VARCHAR(40) NOT NULL,
      resident_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NULL,
      purok_id INT UNSIGNED NULL,
      category ENUM('weekly_fee','special_heavy_trash','hazardous_disposal')
        NOT NULL DEFAULT 'weekly_fee',
      billing_period VARCHAR(80) NOT NULL,
      payment_reference VARCHAR(120) NOT NULL,
      receipt_proof LONGTEXT NOT NULL,
      status ENUM(
        'pending_leader_verification','rejected_by_leader','pending_remittance',
        'pending_admin_confirmation','discrepancy','completed'
      ) NOT NULL DEFAULT 'pending_leader_verification',
      amount DECIMAL(10,2) NOT NULL,
      payment_method ENUM('gcash','maya','over_the_counter') NOT NULL,
      leader_verified_by INT UNSIGNED NULL,
      leader_verified_at DATETIME NULL,
      leader_remarks VARCHAR(500) NULL,
      remittance_reference VARCHAR(120) NULL,
      remittance_proof LONGTEXT NULL,
      remitted_at DATETIME NULL,
      admin_confirmed_by INT UNSIGNED NULL,
      admin_confirmed_at DATETIME NULL,
      admin_remarks VARCHAR(500) NULL,
      discrepancy_amount DECIMAL(10,2) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_payments_transaction_code (transaction_code),
      UNIQUE KEY uq_payments_reference_method (payment_method, payment_reference),
      KEY idx_payments_resident (resident_id, created_at),
      KEY idx_payments_purok_status (purok_id, status, created_at),
      KEY idx_payments_barangay_status (barangay_id, status, created_at),
      CONSTRAINT fk_payments_resident
        FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_payments_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE RESTRICT,
      CONSTRAINT fk_payments_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE RESTRICT,
      CONSTRAINT fk_payments_leader
        FOREIGN KEY (leader_verified_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_payments_admin
        FOREIGN KEY (admin_confirmed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      recipient_user_id INT UNSIGNED NULL,
      recipient_role VARCHAR(40) NULL,
      barangay_id INT UNSIGNED NULL,
      purok_id INT UNSIGNED NULL,
      notification_type VARCHAR(60) NOT NULL DEFAULT 'notice',
      priority ENUM('emergency','schedule','notice') NOT NULL DEFAULT 'notice',
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      related_entity_type VARCHAR(60) NULL,
      related_entity_id BIGINT UNSIGNED NULL,
      created_by INT UNSIGNED NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_notifications_user (recipient_user_id, created_at),
      KEY idx_notifications_role (recipient_role, created_at),
      KEY idx_notifications_barangay (barangay_id, created_at),
      KEY idx_notifications_purok (purok_id, created_at),
      KEY idx_notifications_entity (related_entity_type, related_entity_id),
      CONSTRAINT fk_notifications_recipient
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS notification_receipts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      notification_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      is_seen TINYINT(1) NOT NULL DEFAULT 0,
      seen_at DATETIME NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_notification_receipt (notification_id, user_id),
      KEY idx_notification_receipts_user (user_id),
      CONSTRAINT fk_notification_receipts_notification
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
      CONSTRAINT fk_notification_receipts_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS endorsement_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      request_code VARCHAR(40) NOT NULL,
      requester_id INT UNSIGNED NOT NULL,
      barangay_id INT UNSIGNED NOT NULL,
      purok_id INT UNSIGNED NOT NULL,
      request_type VARCHAR(64) NOT NULL,
      requested_service VARCHAR(255) NULL,
      purpose VARCHAR(1000) NOT NULL,
      status ENUM(
        'pending_leader_review','leader_endorsed','leader_rejected',
        'approved','admin_rejected','withdrawn'
      ) NOT NULL DEFAULT 'pending_leader_review',
      requester_name_snapshot VARCHAR(150) NOT NULL,
      requester_email_snapshot VARCHAR(150) NOT NULL,
      requester_phone_snapshot VARCHAR(30) NULL,
      requester_address_snapshot VARCHAR(255) NOT NULL,
      barangay_name_snapshot VARCHAR(120) NOT NULL,
      purok_name_snapshot VARCHAR(100) NOT NULL,
      leader_reviewed_by INT UNSIGNED NULL,
      leader_name_snapshot VARCHAR(150) NULL,
      leader_reviewed_at DATETIME NULL,
      leader_remarks VARCHAR(1000) NULL,
      admin_reviewed_by INT UNSIGNED NULL,
      admin_name_snapshot VARCHAR(150) NULL,
      admin_reviewed_at DATETIME NULL,
      admin_remarks VARCHAR(1000) NULL,
      certificate_number VARCHAR(64) NULL,
      verification_code VARCHAR(64) NULL,
      issued_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_endorsement_request_code (request_code),
      UNIQUE KEY uq_endorsement_certificate (certificate_number),
      UNIQUE KEY uq_endorsement_verification (verification_code),
      KEY idx_endorsement_requester (requester_id, created_at),
      KEY idx_endorsement_purok_status (purok_id, status, created_at),
      KEY idx_endorsement_barangay_status (barangay_id, status, created_at),
      CONSTRAINT fk_endorsement_requester
        FOREIGN KEY (requester_id) REFERENCES users(id),
      CONSTRAINT fk_endorsement_barangay
        FOREIGN KEY (barangay_id) REFERENCES barangays(id),
      CONSTRAINT fk_endorsement_purok
        FOREIGN KEY (purok_id) REFERENCES puroks(id),
      CONSTRAINT fk_endorsement_leader
        FOREIGN KEY (leader_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_endorsement_admin
        FOREIGN KEY (admin_reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS endorsement_request_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      endorsement_request_id BIGINT UNSIGNED NOT NULL,
      actor_user_id INT UNSIGNED NULL,
      actor_name_snapshot VARCHAR(150) NOT NULL,
      actor_role_snapshot VARCHAR(40) NOT NULL,
      action VARCHAR(40) NOT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NOT NULL,
      remarks VARCHAR(1000) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_endorsement_history_request (endorsement_request_id, created_at),
      KEY idx_endorsement_history_actor (actor_user_id),
      CONSTRAINT fk_endorsement_history_request
        FOREIGN KEY (endorsement_request_id) REFERENCES endorsement_requests(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_endorsement_history_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);
}

async function migrateLegacySchema(defaultBarangayId: number) {
  await ensureColumn("puroks", "barangay_id", "INT UNSIGNED NULL AFTER id");
  await connection.execute(
    "UPDATE puroks SET barangay_id = ? WHERE barangay_id IS NULL",
    [defaultBarangayId],
  );

  if (await indexExists("puroks", "name")) {
    await connection.query("ALTER TABLE puroks DROP INDEX `name`");
  }

  await ensureIndex(
    "puroks",
    "uq_puroks_barangay_name",
    "UNIQUE KEY uq_puroks_barangay_name (barangay_id, name)",
  );

  await ensureColumn("users", "barangay_id", "INT UNSIGNED NULL AFTER purok_id");
  await ensureColumn("users", "recovery_email", "VARCHAR(255) NULL AFTER email");
  await ensureColumn("users", "email_verified_at", "DATETIME NULL AFTER email");
  await ensureColumn(
    "users",
    "must_change_password",
    "TINYINT(1) NOT NULL DEFAULT 0 AFTER status",
  );
  await ensureColumn("users", "duty_latitude", "DECIMAL(10,7) NULL");
  await ensureColumn("users", "duty_longitude", "DECIMAL(10,7) NULL");
  await connection.query(`
    ALTER TABLE users
      MODIFY role ENUM('super_admin','admin','purok_leader','collector','resident')
        NOT NULL DEFAULT 'resident'
  `);
  await connection.execute(`
    UPDATE users u
    LEFT JOIN puroks p ON p.id = u.purok_id
    SET u.barangay_id = COALESCE(p.barangay_id, ?)
    WHERE u.barangay_id IS NULL
      AND u.role <> 'super_admin'
  `, [defaultBarangayId]);

  if (await tableExists("endorsement_requests")) {
    await connection.query(`
      ALTER TABLE endorsement_requests
        MODIFY request_type VARCHAR(64) NOT NULL
    `);
    await connection.query(`
      UPDATE endorsement_requests
      SET request_type = 'barangay_service_endorsement'
      WHERE request_type <> 'barangay_service_endorsement'
    `);
    await ensureColumn(
      "endorsement_requests",
      "requested_service",
      "VARCHAR(255) NULL AFTER request_type",
    );
  }

  await ensureColumn("garbage_bins", "latitude", "DECIMAL(10,7) NULL AFTER location_name");
  await ensureColumn("garbage_bins", "longitude", "DECIMAL(10,7) NULL AFTER latitude");
  await ensureColumn(
    "garbage_bins",
    "current_status",
    "VARCHAR(40) NOT NULL DEFAULT 'empty'",
  );
  await ensureColumn(
    "garbage_bins",
    "condition_status",
    "VARCHAR(40) NOT NULL DEFAULT 'good'",
  );
  await connection.query(
    "ALTER TABLE garbage_bins MODIFY current_status VARCHAR(40) NOT NULL DEFAULT 'empty'",
  );
  await connection.query(
    "ALTER TABLE garbage_bins MODIFY condition_status VARCHAR(40) NOT NULL DEFAULT 'good'",
  );
  await connection.query(`
    UPDATE garbage_bins
    SET
      current_status = CASE
        WHEN LOWER(REPLACE(REPLACE(current_status, '-', '_'), ' ', '_')) = 'half_full'
          THEN 'half_full'
        WHEN LOWER(current_status) = 'full' THEN 'full'
        WHEN LOWER(current_status) IN ('overflow', 'overflowing') THEN 'overflowing'
        WHEN LOWER(current_status) = 'damaged' THEN 'damaged'
        ELSE 'empty'
      END,
      condition_status = CASE
        WHEN LOWER(REPLACE(REPLACE(condition_status, '-', '_'), ' ', '_'))
          IN ('damaged', 'repair', 'needs_repair')
          THEN 'needs_repair'
        WHEN LOWER(REPLACE(REPLACE(condition_status, '-', '_'), ' ', '_'))
          IN ('inactive', 'out_of_service')
          THEN 'out_of_service'
        ELSE 'good'
      END
  `);
  await connection.query(`
    ALTER TABLE garbage_bins
      MODIFY current_status
        ENUM('empty','half_full','full','overflowing','damaged')
        NOT NULL DEFAULT 'empty',
      MODIFY condition_status
        ENUM('good','needs_repair','out_of_service')
        NOT NULL DEFAULT 'good'
  `);

  if (await tableExists("collection_requests")) {
    await connection.query(
      "ALTER TABLE collection_requests MODIFY reason VARCHAR(255) NULL",
    );
  }

  await ensureColumn("password_resets", "otp_hash", "VARCHAR(64) NULL AFTER otp");
  await ensureColumn(
    "password_resets",
    "attempt_count",
    "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER otp_hash",
  );
  await ensureColumn("password_resets", "verified_at", "DATETIME NULL");
  await ensureColumn("password_resets", "consumed_at", "DATETIME NULL");
  if (await columnExists("password_resets", "otp")) {
    await connection.query("ALTER TABLE password_resets MODIFY otp VARCHAR(6) NULL");
  }

  if (await tableExists("payments")) {
    const hadLegacyReference = await columnExists("payments", "reference_number");
    const hadLegacyStatus = await columnExists("payments", "payment_status");

    await ensureColumn("payments", "transaction_code", "VARCHAR(40) NULL AFTER id");
    await ensureColumn("payments", "barangay_id", "INT UNSIGNED NULL AFTER resident_id");
    await ensureColumn("payments", "purok_id", "INT UNSIGNED NULL AFTER barangay_id");
    await ensureColumn(
      "payments",
      "category",
      "ENUM('weekly_fee','special_heavy_trash','hazardous_disposal') NOT NULL DEFAULT 'weekly_fee'",
    );
    await ensureColumn(
      "payments",
      "billing_period",
      "VARCHAR(80) NOT NULL DEFAULT 'Legacy Record'",
    );
    await ensureColumn("payments", "payment_reference", "VARCHAR(120) NULL");
    await ensureColumn("payments", "receipt_proof", "LONGTEXT NULL");
    await ensureColumn(
      "payments",
      "status",
      "ENUM('pending_leader_verification','rejected_by_leader','pending_remittance','pending_admin_confirmation','discrepancy','completed') NOT NULL DEFAULT 'pending_leader_verification'",
    );
    await ensureColumn("payments", "leader_verified_by", "INT UNSIGNED NULL");
    await ensureColumn("payments", "leader_verified_at", "DATETIME NULL");
    await ensureColumn("payments", "leader_remarks", "VARCHAR(500) NULL");
    await ensureColumn("payments", "remittance_reference", "VARCHAR(120) NULL");
    await ensureColumn("payments", "remittance_proof", "LONGTEXT NULL");
    await ensureColumn("payments", "remitted_at", "DATETIME NULL");
    await ensureColumn("payments", "admin_confirmed_by", "INT UNSIGNED NULL");
    await ensureColumn("payments", "admin_confirmed_at", "DATETIME NULL");
    await ensureColumn("payments", "admin_remarks", "VARCHAR(500) NULL");
    await ensureColumn("payments", "discrepancy_amount", "DECIMAL(10,2) NULL");
    await ensureColumn(
      "payments",
      "updated_at",
      "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    );

    if (hadLegacyReference) {
      await connection.query("ALTER TABLE payments MODIFY reference_number VARCHAR(100) NULL");
      await connection.query(`
        UPDATE payments
        SET payment_reference = COALESCE(payment_reference, reference_number)
      `);
    }

    if (hadLegacyStatus) {
      await connection.query("ALTER TABLE payments MODIFY payment_status VARCHAR(40) NULL");
    }

    await connection.query(`
      UPDATE payments p
      INNER JOIN users u ON u.id = p.resident_id
      SET
        p.transaction_code = COALESCE(
          NULLIF(p.transaction_code, ''),
          CONCAT('LEGACY-', LPAD(p.id, 10, '0'))
        ),
        p.barangay_id = COALESCE(p.barangay_id, u.barangay_id),
        p.purok_id = COALESCE(p.purok_id, u.purok_id),
        p.payment_reference = COALESCE(
          NULLIF(p.payment_reference, ''),
          CONCAT('LEGACY-REF-', p.id)
        ),
        p.receipt_proof = COALESCE(p.receipt_proof, 'Legacy migrated record')
    `);

    if (await columnExists("payments", "payment_method")) {
      await connection.query(`
        ALTER TABLE payments MODIFY payment_method
          ENUM('cash','gcash','bank_transfer','other','maya','over_the_counter') NOT NULL
      `);
      await connection.query(`
        UPDATE payments
        SET payment_method = 'over_the_counter'
        WHERE payment_method IN ('cash','bank_transfer','other')
      `);
      await connection.query(`
        ALTER TABLE payments MODIFY payment_method
          ENUM('gcash','maya','over_the_counter') NOT NULL
      `);
    }

    await connection.query("ALTER TABLE payments MODIFY transaction_code VARCHAR(40) NOT NULL");
    await connection.query("ALTER TABLE payments MODIFY payment_reference VARCHAR(120) NOT NULL");
    await connection.query("ALTER TABLE payments MODIFY receipt_proof LONGTEXT NOT NULL");
    await ensureIndex(
      "payments",
      "uq_payments_transaction_code",
      "UNIQUE KEY uq_payments_transaction_code (transaction_code)",
    );
    await ensureIndex(
      "payments",
      "uq_payments_reference_method",
      "UNIQUE KEY uq_payments_reference_method (payment_method, payment_reference)",
    );
  }

  if (await tableExists("notifications")) {
    const hadLegacyUser = await columnExists("notifications", "user_id");
    const hadLegacyType = await columnExists("notifications", "type");
    const hadLegacyRelatedId = await columnExists("notifications", "related_id");

    await ensureColumn("notifications", "recipient_user_id", "INT UNSIGNED NULL AFTER id");
    await ensureColumn("notifications", "recipient_role", "VARCHAR(40) NULL");
    await ensureColumn("notifications", "barangay_id", "INT UNSIGNED NULL");
    await ensureColumn("notifications", "purok_id", "INT UNSIGNED NULL");
    await ensureColumn(
      "notifications",
      "notification_type",
      "VARCHAR(60) NOT NULL DEFAULT 'notice'",
    );
    await ensureColumn(
      "notifications",
      "priority",
      "ENUM('emergency','schedule','notice') NOT NULL DEFAULT 'notice'",
    );
    await ensureColumn("notifications", "related_entity_type", "VARCHAR(60) NULL");
    await ensureColumn("notifications", "related_entity_id", "BIGINT UNSIGNED NULL");
    await ensureColumn("notifications", "created_by", "INT UNSIGNED NULL");

    if (hadLegacyUser) {
      await connection.query("ALTER TABLE notifications MODIFY user_id INT UNSIGNED NULL");
      await connection.query(`
        UPDATE notifications
        SET recipient_user_id = COALESCE(recipient_user_id, user_id)
      `);
    }

    if (hadLegacyType) {
      await connection.query(`
        UPDATE notifications
        SET notification_type = COALESCE(NULLIF(notification_type, 'notice'), type, 'notice')
      `);
    }

    if (hadLegacyRelatedId) {
      await connection.query(`
        UPDATE notifications
        SET related_entity_id = COALESCE(related_entity_id, related_id)
      `);
    }
  }

  if (await tableExists("notification_receipts")) {
    await connection.query(`
      ALTER TABLE notification_receipts
      MODIFY notification_id BIGINT UNSIGNED NOT NULL
    `);
  }

  await connection.execute(
    `INSERT IGNORE INTO schema_migrations (version) VALUES (?)`,
    ["2026-08-complete-system-v1"],
  );
}

async function seedReferenceData() {
  const defaultBarangay = String(
    process.env.DEFAULT_BARANGAY_NAME || "Bang-bang",
  ).trim();
  const purokCount = Math.max(
    1,
    Math.min(99, Number(process.env.DEFAULT_PUROK_COUNT || 9)),
  );

  await connection.execute(
    `
    INSERT INTO barangays (name, is_active)
    VALUES (?, 1)
    ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)
    `,
    [defaultBarangay],
  );

  const [barangayRows] = await connection.query<any[]>(
    "SELECT id FROM barangays WHERE name = ? LIMIT 1",
    [defaultBarangay],
  );
  const barangayId = Number(barangayRows[0].id);

  await migrateLegacySchema(barangayId);

  for (let index = 1; index <= purokCount; index += 1) {
    await connection.execute(
      `
      INSERT INTO puroks (barangay_id, name, description)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE description = VALUES(description)
      `,
      [barangayId, `Purok ${index}`, `Assigned collection zone ${index}`],
    );
  }

  return barangayId;
}

async function seedDemoData(barangayId: number) {
  if (String(process.env.SEED_DEMO_DATA || "false").toLowerCase() !== "true") {
    return;
  }

  const [purokRows] = await connection.query<any[]>(
    `SELECT id FROM puroks WHERE barangay_id = ? ORDER BY id LIMIT 1`,
    [barangayId],
  );
  const purokId = Number(purokRows[0]?.id);

  if (!purokId) {
    throw new Error("Cannot seed demo accounts without at least one purok.");
  }

  const passwordHash = await bcrypt.hash("password123", 12);
  const demoUsers = [
    [barangayId, null, "Demo Barangay Captain", "admin@barangay.gov", "admin"],
    [barangayId, purokId, "Demo Purok Leader", "leader@barangay.gov", "purok_leader"],
    [barangayId, null, "Demo Garbage Collector", "collector@barangay.gov", "collector"],
    [barangayId, purokId, "Demo Resident", "resident@example.com", "resident"],
  ];

  for (const [assignedBarangay, assignedPurok, name, email, role] of demoUsers) {
    await connection.execute(
      `
      INSERT IGNORE INTO users (
        barangay_id,
        purok_id,
        full_name,
        email,
        password_hash,
        role,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'active')
      `,
      [assignedBarangay, assignedPurok, name, email, passwordHash, role],
    );
  }

  const bins = [
    ["BIN-P1-001", "Near the covered court"],
    ["BIN-P1-002", "Purok main road"],
  ];

  for (const [code, location] of bins) {
    await connection.execute(
      `
      INSERT IGNORE INTO garbage_bins (purok_id, bin_code, location_name)
      VALUES (?, ?, ?)
      `,
      [purokId, code, location],
    );
  }
}

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${safeIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.query(`USE ${safeIdentifier(databaseName)}`);
  await createCurrentSchema();
  const defaultBarangayId = await seedReferenceData();
  await seedDemoData(defaultBarangayId);

  console.log(`Database '${databaseName}' is ready.`);
  console.log(
    String(process.env.SEED_DEMO_DATA || "false").toLowerCase() === "true"
      ? "Demo accounts were created only when missing; existing passwords were not reset."
      : "Demo data was not requested. Set SEED_DEMO_DATA=true to add safe development fixtures.",
  );
} finally {
  await connection.end();
}
