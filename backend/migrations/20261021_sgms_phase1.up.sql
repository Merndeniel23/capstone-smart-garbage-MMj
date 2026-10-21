-- Proposed only; do not run automatically. Review against a schema-only export.
-- Requires 20261021_sgms_panel.sql. MySQL DDL auto-commits; back up first.
-- STOP unless the read-only scripts/phase1Preflight.ts --before-up exits 0.
-- A partial or already-applied state requires review, never blind rerunning.
-- Use maintenance mode with ALL database writers stopped. There is no automatic
-- migration runner or repair. Complete post-up preflight before activating
-- SGMS_PHASE1_ENABLED; SGMS_REVISIONS_ENABLED alone never enables Phase 1.
-- No existing run, assignment, scan, result or timestamp is inferred/backfilled.
-- uq_collection_runs_barangay_date is deliberately unchanged.
CREATE TABLE collector_purok_assignments (
  collector_id INT UNSIGNED NOT NULL,
  purok_id INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  assigned_by INT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collector_id, purok_id),
  KEY idx_collector_purok_active (purok_id, is_active),
  CONSTRAINT fk_cpa_collector FOREIGN KEY (collector_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpa_purok FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpa_admin FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE collection_run_puroks (
  run_id BIGINT UNSIGNED NOT NULL,
  purok_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (run_id, purok_id),
  KEY idx_run_purok (purok_id, run_id),
  CONSTRAINT fk_run_purok_run FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_run_purok_purok FOREIGN KEY (purok_id) REFERENCES puroks(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE collection_run_bins (
  run_id BIGINT UNSIGNED NOT NULL,
  bin_id INT UNSIGNED NOT NULL,
  resident_id INT UNSIGNED NOT NULL,
  purok_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (run_id, bin_id),
  KEY idx_run_bin_bin (bin_id, run_id),
  CONSTRAINT fk_run_bin_run FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_run_bin_bin FOREIGN KEY (bin_id) REFERENCES garbage_bins(id) ON DELETE RESTRICT,
  CONSTRAINT fk_run_bin_household FOREIGN KEY (resident_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_run_bin_purok FOREIGN KEY (run_id, purok_id) REFERENCES collection_run_puroks(run_id, purok_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Nullable for existing evidence; historical Not Collected reasons are not guessed.
ALTER TABLE household_collections ADD not_collected_reason VARCHAR(1000) NULL;
