# Smart Garbage Monitoring System

A full-stack barangay waste-management application built with React, Express,
TypeScript, and MySQL. Operational records are shared through the API rather
than stored as browser-only mock data.

## Main workflows

- Residents register with a verified email address, maintain their address, view
  collection schedules, file complaints, submit payment proof, request a
  barangay-service endorsement for a document, permit, assistance, or other
  barangay service, and track progress.
- Purok Leaders inspect registered bins, review requests from their purok, and
  endorse valid resident barangay-service requests.
- Collectors receive collection work, update collection runs and complaint
  progress, and share an on-duty map location.
- Barangay Captains manage their barangay's users, bins, schedules,
  notifications, complaints, payments, endorsements, and reports; they verify
  payment compliance before releasing an endorsement.
- Super Administrators view municipality-wide data and provision barangay
  captains and truck crews, but do not access endorsement workflows.
- Approved barangay-service endorsements receive a server-generated reference
  number and public high-entropy verification code.

Every authenticated API request reloads the current account status, role, and
location assignment from MySQL. Tenant-sensitive operations are restricted by
barangay, purok, ownership, or collector assignment as appropriate.

Account deletion is available from User Management and the Household Directory.
Super Administrators may delete resident, collector, and Purok Leader accounts;
Barangay Captains are limited to those accounts in their own barangay. Purok
Leaders may delete only residents assigned to their own barangay and purok.
Deleting your own account or an administrator account is prohibited.

Deletion requires confirmation and permanently removes an account only when it
has no linked operational history. Accounts with payments, complaints,
inspections, collections, or other operational records must be retained; use
account suspension instead, or ask the Barangay Captain to suspend access.
Pending, unverified accounts without those records can be deleted. Password
reset requests and unfinished signups for the deleted email are also removed.

## In-app AI assistant

The authenticated assistant is available from the chat button. Its Gemini
client runs only on the server and receives a small, role-scoped context of
operational aggregates (for example, schedules, bin conditions, and permitted
status counts). Residents see their own records, Purok Leaders see their
assigned purok, collectors see assigned work, Barangay Captains see their
barangay, and Super Administrators see municipality-wide aggregates. It does
not receive passwords, tokens, OTPs, API keys, or raw private records, and it
refuses unrelated questions. Questions can be asked in English or Cebuano.

## Requirements

- Node.js 20 or newer
- MySQL 8 or a compatible MySQL server
- npm

Google sign-in and the AI assistant are optional. Email delivery is required
for new registrations and password recovery; configure Resend before exposing
registration in a deployed environment.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. For a new checkout, copy the environment templates below. Do not overwrite
   existing `.env` files. Configure MySQL, `JWT_SECRET`, `RESEND_API_KEY` and
   `RESEND_FROM_EMAIL` only in `backend/.env`. The separation preserves the
   previous server `.env` there; public frontend settings live in `frontend/.env`.

   ```powershell
   Copy-Item backend/.env.template backend/.env
   Copy-Item frontend/.env.template frontend/.env
   ```

3. Reuse the existing database. This folder separation needs no SQL migration.
   Initial database provisioning and the separate panel migration require an
   authorized operator; see `PANEL_REVISIONS.md`. Do not run `db:setup` against
   an existing deployment solely for this change.

4. Start the API and frontend in separate terminals, both from the repository root:

   ```bash
   npm run dev:backend
   ```

   ```bash
   npm run dev:frontend
   ```

5. Open `http://localhost:5173`. Express listens on port `3001` by default;
   Vite proxies `/api` to it. Set `VITE_API_PROXY_TARGET` when the local API port
   changes. `npm run dev` is an alias for the frontend command only.

Frontend requests use `frontend/src/services/http.ts`, the shared Axios client.
The existing typed API helper uses Axios directly; older screens use its
Response-compatible bridge to preserve JSON, error and PDF-download handling.
The public map-routing service uses Axios without the backend authentication token.

## Registration and email verification

Public registration, including a new registration through Google sign-in,
stores a temporary request in `pending_registrations` and sends an email OTP.
The application creates the resident account only after the correct,
unexpired OTP is submitted. Until then, the request cannot sign in and does
not appear in user management or account counts. Successful verification
removes the temporary request.

Continue verification in the browser where registration was started. A
registration token binds the code to those submitted account details. If the
browser loses that token, start registration again after the resend cooldown;
the new request replaces the previous details, code, and token together.
Requesting another code from the verification screen keeps the same account
details and registration token.

Email validation checks the address format and whether the domain has DNS
records for receiving mail. These checks can reject invalid domains, but
cannot establish whether a particular mailbox exists. Receiving and entering
the OTP proves access to the mailbox; an invented address cannot become an
account without completing that step.

Configure `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` before accepting
registrations. The server also needs working DNS resolution. A successful
email send means the email provider accepted the message; it does not itself
verify the mailbox.

Existing unverified accounts from earlier installations remain available for
their original email-verification flow and may still appear as pending in
user management. This update does not delete them. Staff provisioning and
Super Administrator creation keep their existing workflows.

## Optional private receipt storage

The payment workflow can store receipt and remittance images in a private
Supabase Storage bucket while keeping payment records in MySQL. Without these
settings, the existing local development behavior stores the image data in the
database.

1. Create a Supabase project and a Storage bucket named `payment-proofs`.
2. Keep the bucket private; payment proof must not be publicly accessible.
3. Add the project URL and server-only service role key to `backend/.env`:

   ```text
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-server-only-secret-key
   SUPABASE_STORAGE_BUCKET=payment-proofs
   SUPABASE_STORAGE_SIGNED_URL_TTL=3600
   ```

4. Restart the server. New resident receipts and Purok Leader remittance
   proofs will upload to Storage, while the API returns short-lived signed URLs
   to authorized users. Never use this secret key in frontend code or a
   `VITE_` variable. Older projects may use the legacy
   `SUPABASE_SERVICE_ROLE_KEY` variable instead.

## Application configuration

Payment rates come from the server settings PAYMENT_WEEKLY_FEE,
PAYMENT_HEAVY_TRASH_FEE, and PAYMENT_HAZARDOUS_FEE. Defaults remain PHP 5,
80, and 120. Both payment forms load these rates from the payments API.
Restart the server after changing rates; existing payment records retain their amounts.

VITE_MAP_CENTER_LAT and VITE_MAP_CENTER_LNG configure the initial map view.
Rebuild the frontend after changing them. Actual collector positions use GPS data.

Database setup requires DEFAULT_BARANGAY_NAME and DEFAULT_PUROK_COUNT (1-99).
It does not seed demo accounts or bins. Existing accounts and bins remain in the database.
SEED_DEMO_DATA is no longer used. Create records through the app's authorized workflows.

The chatbot retains help replies for when its AI provider is unavailable.
Reports use the browser print dialog for printing and Save as PDF.

## Initial Super Administrator

Configure these environment variables with real, private values:

- `SUPER_ADMIN_NAME`
- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_RECOVERY_EMAIL`
- `SUPER_ADMIN_TEMP_PASSWORD`

The temporary password must contain at least 12 characters, uppercase and
lowercase letters, a number, and a symbol. Then run:

```bash
npm run create-super-admin
```

The command refuses to overwrite an existing account and prints a one-time
offline recovery code. Store that code securely. The Super Administrator must
replace the temporary password after the first login.

## Independent production deployments

```bash
npm ci
npm run build:backend
npm run start:backend
```

These are operator commands, not actions performed by this refactor. The
backend now serves only the API, not React files. `npm start` aliases the
backend start command. Use the repository root for workspace installation and
builds so `shared/` remains available. For an API web service such as Render,
use `npm ci && npm run build:backend` as the build command and
`npm run start:backend` as the start command.

Deploy the frontend separately as a static site: build with
`npm ci && npm run build:frontend` and publish `frontend/dist`. Configure SPA
fallback to `index.html` at the static host. Set the public build-time variable
`VITE_API_BASE_URL=https://YOUR_API_HOST/api`; the development Vite proxy is
not available on a static production host. A same-origin reverse proxy may
instead route `/api` to Express and keep `VITE_API_BASE_URL=/api`.

Set `NODE_ENV=production`, `CORS_ORIGINS` to the exact HTTPS **frontend**
origin(s), and `APP_PUBLIC_URL` to the canonical frontend origin on the backend.
Keep MySQL, JWT, Resend, Supabase and Xendit secrets exclusively in backend
configuration, never in `VITE_` variables. Set `TRUST_PROXY=true` behind a
trusted reverse proxy. Configure Google sign-in's authorized JavaScript origins
for the frontend URL when using Google login.

Production startup validates database, JWT, email and optional Supabase settings.
Before listening for requests,
the server creates `pending_registrations` if it does not exist, using the
configured database connection and SSL settings. The database user needs
permission to create that table. Startup fails if database initialization
fails, allowing deployment health checks to reject an unready instance.
This narrow startup migration leaves existing users and operational records
unchanged; do not run the broad `db:setup` script solely for this update.
This refactor does not run the server, database initialization, builds, tests
or deployments. Existing panel prerequisites and feature flags remain unchanged.

## Project layout

```text
frontend/
  src/          React application and shared Axios API client
  public/       Existing frontend assets
  .env.template Public Vite configuration only
backend/
  server.ts     Express API entry point
  config/       MySQL and server configuration
  middleware/   Authentication and request security
  routes/       Existing Express API modules
  services/     Server business logic and integrations
  scripts/      Database setup and administrator bootstrap
  migrations/   Proposed SQL; never executed by this refactor
  .env.template Server-only configuration
shared/         Existing browser-safe shared constants and helpers
package.json    npm workspace commands
package-lock.json Shared dependency lockfile
```

Configuration defaults are in `frontend/.env.template` and `backend/.env.template`.
Never commit real `.env` files, database credentials, JWT secrets, API keys, recovery
codes, or production passwords.
