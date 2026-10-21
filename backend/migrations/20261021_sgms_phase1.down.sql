-- DATA-PRESERVING APPLICATION ROLLBACK ONLY. Not a schema-removal script.
-- Enter maintenance mode, stop ALL database writers (all backend instances,
-- jobs, pending requests and operator sessions), and drain transactions first.
-- An authorized operator may then disable Phase 1 and roll application code
-- back to an approved compatible version. No configuration is changed here.
-- Retain every Phase 1 table, coverage row, reason and audit entry, even if an
-- earlier check appeared empty: emptiness checks are not atomic with MySQL DDL.
-- Separately reviewed schema removal, if ever needed, is outside this script.
-- No DROP, DELETE, ALTER, procedure creation, or evidence mutation is executed.
SELECT 'Rollback application code under maintenance; retain all Phase 1 schema and evidence' AS rollback_policy;
