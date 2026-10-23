-- Four-role workflow for Barangay Bangbang:
-- Admin (Barangay Captain), Collector, Purok Leader and Resident.
--
-- Apply AFTER 20261021_sgms_panel.sql and before running the backend with
-- SGMS_REVISIONS_ENABLED=true. Compare with a schema-only export and back up
-- data first. MySQL DDL auto-commits; do not rerun after a partial failure.

-- 1. Collectors scan bins directly. A collection run is optional, so a scan
--    is no longer required to belong to a run.
ALTER TABLE household_collections
  DROP FOREIGN KEY fk_pickup_run;
ALTER TABLE household_collections
  MODIFY run_id BIGINT UNSIGNED NULL;
ALTER TABLE household_collections
  ADD CONSTRAINT fk_pickup_run FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE RESTRICT,
  ADD KEY idx_bin_pickups (bin_id, collected_at);

-- 2. Purok Leaders decide warning / fine / suspension directly. A decision
--    may come from a "not segregated" scan or be a direct account suspension.
--    Approved policies remain optional references.
ALTER TABLE household_violations
  DROP FOREIGN KEY fk_violation_collection,
  DROP FOREIGN KEY fk_violation_policy;
ALTER TABLE household_violations
  DROP INDEX uq_collection_policy,
  MODIFY collection_id BIGINT UNSIGNED NULL,
  MODIFY policy_id BIGINT UNSIGNED NULL,
  ADD COLUMN barangay_id INT UNSIGNED NULL AFTER resident_id,
  ADD COLUMN purok_id INT UNSIGNED NULL AFTER barangay_id,
  ADD COLUMN action ENUM('warning','fine','suspension') NULL AFTER purok_id,
  ADD COLUMN fine_amount DECIMAL(10,2) NULL AFTER action,
  ADD COLUMN suspension_scope ENUM('collection','account') NULL AFTER fine_amount,
  ADD KEY idx_violation_collection (collection_id),
  ADD KEY idx_violation_area (barangay_id, purok_id, issued_at);
ALTER TABLE household_violations
  ADD CONSTRAINT fk_violation_collection FOREIGN KEY (collection_id) REFERENCES household_collections(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_violation_policy FOREIGN KEY (policy_id) REFERENCES barangay_violation_policies(id) ON DELETE RESTRICT;

-- Copy existing decisions' terms and area onto the violation row.
UPDATE household_violations v
  JOIN household_collections c ON c.id = v.collection_id
  JOIN barangay_violation_policies p ON p.id = v.policy_id
SET v.barangay_id = c.barangay_id,
    v.purok_id = c.purok_id,
    v.action = p.action,
    v.fine_amount = p.fine_amount,
    v.suspension_scope = p.suspension_scope;

-- 3. Residents may file a complaint about their Purok Leader or a Collector.
--    These complaints go straight to the Admin.
ALTER TABLE complaints
  ADD COLUMN subject_user_id INT UNSIGNED NULL,
  ADD COLUMN subject_role ENUM('purok_leader','collector') NULL,
  ADD KEY idx_complaint_subject (subject_user_id),
  ADD CONSTRAINT fk_complaint_subject FOREIGN KEY (subject_user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- 4. Complaints soft-deleted before this migration (complaint_archives) move
--    into complaints.archived_at so they can be restored from Archives.
CREATE TABLE IF NOT EXISTS complaint_archives (
  complaint_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  archived_by INT UNSIGNED NOT NULL,
  archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
UPDATE complaints c
  JOIN complaint_archives a ON a.complaint_id = c.id
SET c.archived_at = a.archived_at,
    c.archived_by = a.archived_by
WHERE c.archived_at IS NULL;
DELETE FROM complaint_archives;
