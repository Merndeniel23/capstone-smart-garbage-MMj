-- Proposed additive migration, based on scripts/setupDatabase.ts, not a live
-- schema inspection. Review against a schema-only export before applying.
-- Run once on a backed-up staging database first. Never run automatically.
-- Existing runtime tables (payment_archives / purok_weekly_fees) are retained.
ALTER TABLE users MODIFY status ENUM('active','inactive','pending','pending_activation') NOT NULL DEFAULT 'active';
ALTER TABLE users ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL;
ALTER TABLE puroks ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL;
ALTER TABLE garbage_bins ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL;
ALTER TABLE garbage_bins ADD archive_was_active TINYINT NULL;
ALTER TABLE bin_inspections ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL;
ALTER TABLE complaints ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL;
ALTER TABLE complaints ADD admin_only TINYINT(1) NOT NULL DEFAULT 0;
-- Resident complaints are private to their reporter and the assigned Admin.
-- Preserve earlier collector assignments as history, without granting access.
UPDATE complaints c JOIN users u ON u.id = c.reported_by SET c.admin_only = 1 WHERE u.role = 'resident';
ALTER TABLE barangay_collection_schedules ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL;
ALTER TABLE barangay_collection_schedules ADD archive_was_active TINYINT NULL;
ALTER TABLE endorsement_requests ADD archived_at DATETIME NULL, ADD archived_by INT UNSIGNED NULL, ADD issued_document_text TEXT NULL;
ALTER TABLE payments MODIFY payment_method ENUM('gcash','maya','over_the_counter','xendit') NOT NULL;

CREATE TABLE account_activations (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Reuse resident users as household account holders; do not fabricate separate
-- resident accounts for household members or auto-infer family relationships.
CREATE TABLE household_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  resident_id INT UNSIGNED NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  relationship VARCHAR(80) NOT NULL,
  archived_at DATETIME NULL,
  archived_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_member_resident FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE household_bins (
  bin_id INT UNSIGNED NOT NULL PRIMARY KEY,
  resident_id INT UNSIGNED NOT NULL,
  qr_hash CHAR(64) NOT NULL UNIQUE,
  registered_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_household_bin FOREIGN KEY (bin_id) REFERENCES garbage_bins(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bin_household FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bin_registrar FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE household_collections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  bin_id INT UNSIGNED NOT NULL,
  resident_id INT UNSIGNED NOT NULL,
  collector_id INT UNSIGNED NOT NULL,
  purok_id INT UNSIGNED NOT NULL,
  barangay_id INT UNSIGNED NOT NULL,
  segregation ENUM('segregated','not_segregated') NOT NULL,
  collection_status ENUM('collected','not_collected') NOT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_run_bin (run_id, bin_id),
  UNIQUE KEY uq_collector_submission (collector_id, idempotency_key),
  CONSTRAINT fk_pickup_run FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pickup_bin FOREIGN KEY (bin_id) REFERENCES garbage_bins(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pickup_resident FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pickup_collector FOREIGN KEY (collector_id) REFERENCES users(id) ON DELETE RESTRICT,
  KEY idx_household_pickups (resident_id, collected_at),
  KEY idx_purok_pickups (purok_id, collected_at)
) ENGINE=InnoDB;
CREATE TABLE barangay_violation_policies (
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
  archive_was_active TINYINT NULL,
  CONSTRAINT fk_policy_barangay FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE RESTRICT,
  CONSTRAINT fk_policy_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE household_violations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  collection_id BIGINT UNSIGNED NOT NULL,
  policy_id BIGINT UNSIGNED NOT NULL,
  resident_id INT UNSIGNED NOT NULL,
  issued_by INT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  suspension_until DATETIME NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_collection_policy (collection_id, policy_id),
  CONSTRAINT fk_violation_collection FOREIGN KEY (collection_id) REFERENCES household_collections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_violation_policy FOREIGN KEY (policy_id) REFERENCES barangay_violation_policies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_violation_resident FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_violation_issuer FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE activity_logs (
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
  KEY idx_activity_resident (resident_id, occurred_at),
  CONSTRAINT fk_activity_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE household_violation_reviews (
  violation_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  decision ENUM('upheld','voided') NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  reviewed_by INT UNSIGNED NOT NULL,
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_review_violation FOREIGN KEY (violation_id) REFERENCES household_violations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_actor FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE barangay_endorsement_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  barangay_id INT UNSIGNED NOT NULL,
  official_reference VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  approved_by INT UNSIGNED NOT NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_template_barangay FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE RESTRICT,
  CONSTRAINT fk_template_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE online_payment_attempts (
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
  UNIQUE KEY uq_online_household_period (resident_id, category, billing_period),
  CONSTRAINT fk_online_resident FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_online_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- These two tables also exist in the legacy payment router's schema initializer.
CREATE TABLE IF NOT EXISTS payment_archives (
  payment_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  archived_by INT UNSIGNED NULL,
  archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_archive_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_archive_actor FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS purok_weekly_fees (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purok_id INT UNSIGNED NOT NULL,
  weekly_fee DECIMAL(10,2) NOT NULL,
  effective_from DATE NOT NULL,
  set_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purok_weekly_fee_date (purok_id,effective_from),
  KEY idx_purok_weekly_fee_lookup (purok_id,effective_from),
  CONSTRAINT fk_purok_weekly_fee_purok FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE CASCADE,
  CONSTRAINT fk_purok_weekly_fee_set_by FOREIGN KEY (set_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- No policies, penalty amounts, official templates, or household links seeded.
-- activity_logs is append-only in application code. Use a dedicated DB user
-- with SELECT/INSERT but no UPDATE/DELETE privileges on that table in deployment.
