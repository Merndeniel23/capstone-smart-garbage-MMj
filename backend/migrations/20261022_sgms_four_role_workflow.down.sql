-- Reverts 20261022_sgms_four_role_workflow.up.sql.
-- Only possible while no rows use the new nullable columns: run-less scans,
-- direct leader decisions without a policy, or complaints about staff.
-- Archive/reconcile those records first; this script does not delete them.

ALTER TABLE complaints
  DROP FOREIGN KEY fk_complaint_subject;
ALTER TABLE complaints
  DROP KEY idx_complaint_subject,
  DROP COLUMN subject_role,
  DROP COLUMN subject_user_id;

ALTER TABLE household_violations
  DROP FOREIGN KEY fk_violation_collection,
  DROP FOREIGN KEY fk_violation_policy;
ALTER TABLE household_violations
  DROP KEY idx_violation_area,
  DROP KEY idx_violation_collection,
  DROP COLUMN suspension_scope,
  DROP COLUMN fine_amount,
  DROP COLUMN action,
  DROP COLUMN purok_id,
  DROP COLUMN barangay_id,
  MODIFY policy_id BIGINT UNSIGNED NOT NULL,
  MODIFY collection_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_collection_policy (collection_id, policy_id);
ALTER TABLE household_violations
  ADD CONSTRAINT fk_violation_collection FOREIGN KEY (collection_id) REFERENCES household_collections(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_violation_policy FOREIGN KEY (policy_id) REFERENCES barangay_violation_policies(id) ON DELETE RESTRICT;

ALTER TABLE household_collections
  DROP FOREIGN KEY fk_pickup_run;
ALTER TABLE household_collections
  DROP KEY idx_bin_pickups,
  MODIFY run_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE household_collections
  ADD CONSTRAINT fk_pickup_run FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE RESTRICT;
