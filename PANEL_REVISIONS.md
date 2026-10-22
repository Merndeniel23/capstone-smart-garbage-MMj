# SGMS panel revision setup

## Four-role workflow (Barangay Bangbang, 2026-10-22)

The Municipal role is removed. The system has four users:

| Role | Workflow |
| --- | --- |
| Admin (Barangay Captain) | Creates Puroks, Purok Leaders and Collectors; sees every household and member, activity logs (with date/time), violations, payments and endorsements; resolves complaints. |
| Collector | Goes straight to assigned puroks, scans each bin's QR and taps **Segregated** or **Not Segregated**. No started run or leader guidance is needed. The Purok Leader is notified with the QR/bin and household. |
| Purok Leader | Decides **Warning / Fine / Suspension** for not-segregated scans (or suspends a resident directly); marks resident payments **Received & Verified** (final, visible in the resident's history); approves and releases endorsements, which are auto-filled and exportable as PDF. |
| Resident | Requests endorsements, pays online through Xendit, files complaints (including about their Purok Leader or a Collector, which go directly to the Admin). Google sign-up now requires setting a password before the account is created. |

Setup:

1. Apply `backend/migrations/20261022_sgms_four_role_workflow.up.sql` after
   `20261021_sgms_panel.sql`, **before** running with `SGMS_REVISIONS_ENABLED=true`.
   The new queries (including the login suspension check) need its columns.
2. Create the barangay's Admin once from the server:
   `BARANGAY_NAME=Bangbang CAPTAIN_NAME=... CAPTAIN_EMAIL=... CAPTAIN_PASSWORD=... npm run create-barangay-captain`
   (in `backend/`). Existing `super_admin` accounts can no longer sign in.
3. Without an Admin-recorded template, released endorsements use the standard
   template in `shared/endorsementTemplate.ts`.

Not tested, built or typechecked, as requested.

The code is prepared in the existing application. The latest panel-completion
batch was not tested, built, typechecked or deployed. Earlier dependency-only
validation does not validate the QR, document or TLS changes in this batch.
No production database queries or migrations were run for this batch.

## Database prerequisite

`backend/migrations/20261021_sgms_panel.sql` is a proposed migration based on the
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
  and hostname verification (`verifyIdentity: true`) are enabled. Use the exact
  Aiven service DNS hostname for `DB_HOST`, not a substituted IP address or
  alias. Configure the verified CA before deploying that connection change;
  never disable verification to make a failed handshake pass.
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
   bins in the same purok. Account holders finish activation first. Admin may
   resend the existing password setup email from the household view.
   Registration returns a one-time QR payload and its matching household/bin IDs.
   The UI renders a local SVG QR label with Download and Print actions. Encoding
   is limited to the existing fixed-format SGMS household payload (QR version 4,
   error correction L); it is not a general URL/QR service. No token is sent to
   an external image service. The local encoder still requires scanner validation
   before use for physical labels; no QR validation was run in this batch.
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
   Direct PDFs retain WinAnsi/Latin text and punctuation without replacing
   names with question marks. An authenticated approved-document view displays
   the saved snapshot, with isolated Print / Save as PDF for Unicode text using
   the browser's available fonts. Unicode has no automatic server-generated PDF
   without an appropriate font/PDF implementation; users must check the print
   preview for missing glyphs. No official letterhead, seal or signature is added.
   The UI offers an editable, deliberately incomplete DRAFT outline; the backend
   rejects its draft/missing-official-content markers for approved templates.
   Existing issued snapshots are not rewritten. Legacy approved records without
   snapshots retain their existing print workflow and are explicitly labeled.
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

## Inputs and approvals still required

- Review/apply the existing proposed migration through the authorized release
  process before enabling `SGMS_REVISIONS_ENABLED`. No new migration was added
  for the QR/document/TLS completion changes.
- Obtain official policy amounts, durations, scope, payment eligibility rules
  and approval references. `docs/SGMS_APPROVAL_WORKSHEET.md` is a blank review
  worksheet, not an ordinance or a pre-approved financial policy. Automatic
  fine billing remains blocked on those rules; existing fees are unchanged.
- Obtain an approved endorsement statement and authorized signatory details.
  A draft supplied by software is not legal/barangay approval. The UI does not
  auto-confirm approval, create policies, apply penalties or seed templates.
- Configure the existing Resend sender, `APP_PUBLIC_URL`, Xendit credentials and
  backend webhook in the service dashboards. Do not put those secrets in Vite
  variables. The implementation has not verified actual delivery or payments.
- Confirm a release validation plan: new account setup/expiry, household QR
  encoding and camera/scanner recognition, duplicate collection rejection,
  same-purok authorization, Leader-only violations/manual payment checks,
  approved-document snapshots/Unicode print fallback, archive dependencies and
  restoration logs, complaint privacy, and Xendit webhook verification/retries.
  Do this only with explicit validation approval and non-production data.

## Changed source areas

The source is now separated into `backend/` and `frontend/` npm workspaces.
Backend paths below are relative to `backend/`; UI paths are relative to
`frontend/src/`. Shared constants remain in root `shared/`. See the README for
separate run commands, Axios configuration and deployment settings. This
separation requires no additional database migration.

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
