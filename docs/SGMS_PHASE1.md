# SGMS Phase 1 - proposed release, not validated

Approved workflow: one Collector per barangay/day run; a Collector may cover
multiple Puroks. The existing `(barangay_id, collection_date)` unique key stays.
Every required bin needs a backend-validated QR result. Not Collected needs a
nonblank reason; it does not empty the bin or complete its collection requests.

## Prerequisites and rollout

- Review the actual schema-only export against the existing panel migration
  and `backend/migrations/20261021_sgms_phase1.up.sql`. Neither was executed here.
- The Phase 1 migration depends on the earlier panel tables/archive columns.
  It adds assignment grants, run Purok/bin coverage and a nullable result reason.
  It does not seed assignments, fabricate evidence, or backfill historical runs.
- Use an authorized, backed-up release process. MySQL DDL auto-commits; review
  types/foreign keys and partial-failure recovery before applying any migration.
- Phase 1 additionally requires `SGMS_PHASE1_ENABLED=true` (absent means disabled),
  the existing panel flag, and a passing read-only schema-readiness check.
  The panel flag alone does not enable it. No environment/configuration was
  changed here. With Phase 1 off/unready, Collector operational APIs return clear
  503 responses rather than granting barangay-wide access. Existing Admin user
  listings and panel/account-setup features do not require Phase 1 tables.
  There is no legacy bulk-empty fallback and no automatic assignment bootstrap.
- A Barangay Admin uses Users > Collector > Assign Puroks. Empty selection
  revokes collection access. SuperAdmin's existing account/truck permissions
  remain, but the new Purok-grant endpoints require Barangay Admin role.

## Coverage and data integrity

- Starting a run saves its assigned Puroks and the active, non-archived,
  registered bins belonging to active households in those same Puroks/barangay.
  No run starts without assignments, eligible bins, a truck or today's schedule.
- Grants are frozen during that Collector's active run. New bin registration,
  household reassignment and archive/restore that would change its coverage are
  blocked while the affected Purok is collecting. Existing QR rotation remains
  possible. Bins becoming eligible later are not silently added to old runs.
- The Collector user/run locks serialize submissions, completion and assignment
  edits. Backend scope checks also cover bin/task lists, task actions, QR lookup,
  result insertion and operational chat aggregates. Purok notices use grants.
- Completing a run requires valid results matching every saved bin, household,
  Purok, Collector and run, with timestamps inside the started run and reasons
  for Not Collected. Only the actual completion timestamp is then recorded.
  Only an individual Collected QR submission updates that bin to empty.
- Legacy runs without saved coverage cannot be completed by inferring coverage
  or scans. An assigned Barangay Admin can use Collection Records > Administrative
  run recovery to close an eligible active legacy/overnight run as `cancelled`.
  This is an existing schema/reporting state, not a new completion state.
  A nonblank recovery reason and previous status/dates/evidence counts are audited
  atomically. User/run locks serialize recovery against scans and completion.
  Coverage, results, bin states, requests, started_at and completed_at are retained.
  Today's covered run, future runs and final runs cannot use this recovery path.
  The unique barangay/day slot stays reserved even after cancellation; recovery
  never creates/reopens a replacement run. Old missing reasons are not guessed.
- Account suspension still immediately removes access. If a required household
  or Collector becomes ineligible mid-run, the run stays incomplete pending
  authorized review; there is no fabricated result or bypass.
- Collector complaint list/status/message access requires BOTH the current
  same-barangay Purok grant and the existing complaint assignment. Mutating
  authorization locks the Collector/grant against concurrent revocation.
  Related notices and chat aggregates obey the same current scope; private
  Resident-to-Admin complaints stay private. Other authorized roles are retained.
- QR lookup uses abort/version checks. Display and save share an immutable
  identified payload/bin/key; input changes invalidate identification. Existing
  backend QR validation, idempotency and per-run uniqueness remain authoritative.

## Read-only preflight and migration order (commands NOT executed)

Base schema (including the unique barangay/day index) -> reviewed earlier panel
migration -> Phase 1 up migration -> passing post-up readiness -> controlled
application rollout -> explicit Admin recovery/grants -> Collector traffic.
Never rerun an already-applied panel migration blindly.

Using the existing TSX dependency from the repository root, only after approval:

```text
npx --no-install tsx backend/scripts/phase1Preflight.ts --before-up
npx --no-install tsx backend/scripts/phase1Preflight.ts
```

The first command must exit zero before up execution: required dependencies must
pass and the three Phase 1 tables/reason column must ALL be absent. A partial or
already-applied state is refused. The second checks the fully applied shape.
These scripts only SELECT whitelisted information_schema metadata: InnoDB tables,
required columns, parent/FK ID types, enums, full unique/coverage indexes and
restrictive FK targets. They never migrate, repair, seed or inspect household data.
They cover Phase 1-used panel dependencies, not every unrelated application table.
Compare the full schema-only export and earlier panel migration separately.

Schema readiness is cached for up to ten seconds, not grants/authorization.
Missing tables/indexes, incompatibility or metadata-read failures disable Phase 1
with sanitized errors; they do not trigger startup DDL or expose connection data.
Partial DDL failure requires separately approved manual schema recovery, not an
automatic rerun. Existing production compatibility has not been established.

## Rollback safety

Enter maintenance mode and stop ALL database writers before up or rollback:
every backend instance, background job, in-flight request and operator session.
Drain open transactions, take/review backups, and keep Collector traffic stopped
through schema checks and recovery/grant setup. This is an operator procedure;
the application cannot assert that external writers have actually stopped.

The down file is intentionally a non-destructive application-rollback notice:
it executes no DROP, ALTER or DELETE, even for apparently empty tables. Roll back
to approved compatible code under maintenance and retain all schema/evidence.
Separately approved schema removal is outside the down script. No routine
permissions or DELIMITER parser are needed. Preflight still reports the retained
schema as applied after application rollback: do NOT rerun the up migration.

## Manual verification after separate approval (not performed)

Use non-production accounts/data after the authorized migration release:

1. Assign two same-barangay Puroks to a Collector. Reject other-barangay IDs,
   other-barangay Admins, SuperAdmin and non-Admin grant writes. Check empty revocation.
2. Check bin lists, map, tasks, Purok notices and QR lookup exclude unassigned
   Puroks. Direct API requests must not bypass these checks.
3. Start the scheduled run with the assigned active truck. Reject a second run
   that day; reject missing coverage or conflicting task ownership.
4. Submit one QR result twice; ensure no second result or repeated side effect.
   Reject another Collector's run, foreign/rotated tokens and out-of-coverage bins.
5. Reject Not Collected without a reason. With a reason, retain the original
   bin status and unfinished task; show the reason in collection history.
6. Attempt completion with an unscanned bin: reject and retain run/bin/task data.
   Record every remaining result, then complete. Never reset Not Collected bins
   or bins whose status changed after their earlier Collected scan.
7. Check assignment/coverage-changing operations are blocked mid-run. Inspect
   audit records and verify old history is unchanged. No legacy auto-backfill.
8. Delay QR lookup A, change to B and resolve responses out of order; never save
   B against A's display. Exercise camera/manual edits and timeout retry keys.
9. Revoke Puroks and test complaint list/status/messages/notices/chat, including
   old cross-barangay assignments. Test revocation racing a message/status write.
10. Recover legacy/overnight runs as own-barangay Admin with a reason. Reject
    other roles/barangays, final runs and today's covered run. Race recovery,
    QR submission and completion; inspect preserved evidence and recovery audit.
11. With only the old flag enabled, confirm Phase 1 stays off while unrelated
    user/account-setup features still work. Simulate absent/partial/mismatched
    schema in a disposable environment and require sanitized 503/preflight failure.
12. Verify rollback under drained-writer maintenance retains every evidence row.

No tests, builds, servers, DB connections, migrations, commits, pushes or
deployments were run for this implementation. It is not production-verified.

## Changed files

- Backend: `routes/admin.ts`, `routes/collectionRuns.ts`,
  `routes/collectionRequests.ts`, `routes/garbageBins.ts`, `routes/sgms.ts`,
  `routes/notifications.ts`, `routes/complaints.ts`,
  `services/collectorAssignments.ts`, `services/phase1Schema.ts`,
  `scripts/phase1Preflight.ts`, `server.ts`.
- Frontend components: `CollectorPurokAssignment.tsx`, `UserManagement.tsx`,
  `QrCollection.tsx`, `SgmsRecords.tsx`, `CollectorDashboard.tsx`, `MapView.tsx`,
  `CollectionRunRecovery.tsx`, `Sidebar.tsx`.
- Proposed migrations: `20261021_sgms_phase1.up.sql` and
  `20261021_sgms_phase1.down.sql`; this release/verification note.
