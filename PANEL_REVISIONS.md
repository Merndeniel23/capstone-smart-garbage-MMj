# SGMS panel revision setup

The code is prepared in the existing application. No tests, builds, lint,
typechecks, servers, database queries, migrations or deployments were run.

## Database prerequisite

`migrations/20261021_sgms_panel.sql` is a proposed migration based on the
repository's setup script and existing route queries, not a live schema dump.
An authorized operator must compare it with a schema-only export, review
column types/indexes/foreign keys, back up data and apply it once through the
normal database release process. MySQL DDL auto-commits: the file cannot be
assumed transactional or safely rerunnable after partial failure.
No startup task executes this migration.

Keep `SGMS_REVISIONS_ENABLED=false` until the complete migration is applied.
New tables are explicit additions, not assertions about the deployed schema.
They cover activation links, household members/bin links, per-run QR results,
approved policies/violations/reviews, activity logs, template versions and
online checkout tracking. Existing operational records are reused and retained.
Resident `users` rows identify household account holders; family relationships
and bin ownership are explicitly registered, never inferred.

Existing resident complaints become private to their reporter and Admin.
Earlier collector assignments remain historical references without granting
access to the complaint. Archive metadata is added to existing record tables;
the existing payment archive marker is reused.

Use a dedicated application DB principal with SELECT/INSERT but no UPDATE or
DELETE privileges on `activity_logs` and `household_violation_reviews`.
Application routes expose no mutation/deletion of these histories. Some legacy
route initializers still issue DDL; provision their tables through the existing
release process before restricting schema-change permissions.

## Configuration

- Set `APP_PUBLIC_URL` to the frontend HTTPS origin. Existing Resend credentials
  and a verified sender are reused. Password setup links expire in one hour;
  only hashes are stored, and resending invalidates the previous link.
  Existing SuperAdmin/captain creation workflows remain in place.
- For Aiven, enable `DB_SSL` and supply `DB_CA_CERT` when its CA is not trusted
  by the platform. Escaped PEM newlines are supported. Certificate validation
  is enabled; configure the CA before deploying that connection change.
- With revisions enabled, MySQL sessions/date conversion use UTC+08:00;
  history screens explicitly display Asia/Manila. Existing DATETIME values are
  not rewritten or assumed to have a known historical timezone.
- Xendit stays disabled until `XENDIT_ENABLED=true`, `XENDIT_SECRET_KEY` and
  `XENDIT_CALLBACK_TOKEN` are configured on the server. Set the Invoice webhook
  to the backend `/api/xendit/webhook` endpoint, not the frontend origin when
  frontend/backend hosting are separate. No secrets use a `VITE_` variable.
  The adapter targets the Invoice API (`/v2/invoices`). Public documentation
  retrieval was unavailable in this session; review compatibility with the
  merchant's enabled product/API before enabling it. No provider behavior was
  exercised and no payment was created during implementation.

## Operational setup and limits

1. Admin registers household account holders/members and associates existing
   bins in the same purok. Registration returns a one-time QR payload for the
   physical label. Provision/print QR labels from these payloads through the
   barangay's labeling process; an on-screen QR image generator is not included.
   Rotation invalidates the previous label. Existing communal bins must not be
   silently assigned to an arbitrary household.
2. Collector starts the existing scheduled run and scans each registered bin.
   The backend checks barangay/run/bin/task assignment, saves segregation and
   pickup results, and notifies the Purok Leader. Uniqueness is per bin/run;
   request keys make retries idempotent. Completing a run no longer fabricates
   pickups or empties every bin. Native BarcodeDetector supports camera scanning;
   other browsers can use a QR scanner that types into the payload field.
3. Admin enters approved policy references, exact amounts, durations and scopes.
   No policies or penalty amounts are seeded. Only the assigned Leader issues
   violations. Explicitly configured collection-service/account-access
   suspensions last until expiry or an authorized void review. Admin reviews
   preserve the original evidence and policy version.
4. Admin records officially approved endorsement text and its approval reference.
   Supported placeholders appear in Settings. Leader remains final approver;
   approval snapshots verified resident data and template text for PDF downloads.
   The dependency-free text PDF supports WinAnsi/Latin names, not arbitrary
   Unicode, custom letterhead or signature layouts. Unsupported text blocks
   issuance instead of silently changing names. Legacy approved records without
   document snapshots retain the earlier print workflow. No official document
   is retroactively fabricated.
5. Xendit charges reuse existing collection-fee categories/configuration.
   Violation fines are recorded under approved policies; automatic fine billing
   is not added to fee categories without an approved billing rule. A checkout
   redirect never confirms payment. Authenticated webhooks retrieve the invoice
   from Xendit, check IDs, PHP amount and paid status, and atomically record a
   completed ledger payment. Repeated webhooks cannot add another payment.
   Ambiguous/expired checkout retries require provider reconciliation to prevent
   double charging. Refunds/chargebacks require a separately approved financial
   reconciliation workflow.
6. Three-dot menus contain Archive. Active dependencies can block parent
   archiving; restore parents before dependent records. Approved endorsement
   status, payment proofs and credentials are retained. Resident payment history
   includes archived entries. Previously anonymized `@deleted.sgms.local` accounts
   and endorsements previously changed to `withdrawn` require authorized manual
   records review; original identity/status is not guessed.

## Changed source areas

- New backend: `routes/{sgms,accountActivation,xendit}.ts`,
  `services/{sgms,accountActivation,endorsementSnapshot,endorsementPdf}.ts`.
- Existing backend integration: `server.ts`, `middleware/auth.ts`,
  `config/{db,security}.ts`, `services/emailVerification.ts`, and the existing
  admin/auth/collection/payment/complaint/endorsement/bin/inspection routes.
- New UI: `SgmsRecords`, `QrCollection`, `OnlinePayments`, `PasswordSetup`,
  `RecordActions`, `PortalOverlays`, `services/endorsementDownload.ts`.
- Existing UI: `App`, `main`, `Sidebar`, `AppStateContext`, affected dashboard,
  management, payment, complaint, endorsement, schedule and inspection panels,
  notification/emergency overlays and shared CSS.
