# Smart Garbage Monitoring System

A full-stack barangay waste-management application built with React, Express,
TypeScript, and MySQL. Operational records are shared through the API rather
than stored as browser-only mock data.

## Main workflows

- Residents register with a verified email address, maintain their address, view
  collection schedules, file complaints, submit payment proof, request
  endorsements, and track progress.
- Purok Leaders inspect registered bins, review requests from their purok, and
  endorse eligible resident certificates.
- Collectors receive collection work, update collection runs and complaint
  progress, and share an on-duty map location.
- Barangay Captains manage their barangay's users, bins, schedules,
  notifications, complaints, payments, endorsements, and reports.
- Super Administrators view municipality-wide data and provision barangay
  captains and truck crews.
- Approved endorsement certificates receive a server-generated certificate
  number and public high-entropy verification code.

Every authenticated API request reloads the current account status, role, and
location assignment from MySQL. Tenant-sensitive operations are restricted by
barangay, purok, ownership, or collector assignment as appropriate.

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

2. Copy `.env.example` to `.env`, then set the MySQL connection and a long,
   random `JWT_SECRET` (at least 32 characters), plus `RESEND_API_KEY` and a
   verified `RESEND_FROM_EMAIL` for registration verification:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Create or migrate the database. This command is idempotent and does not
   reset passwords belonging to existing accounts:

   ```bash
   npm run db:setup
   ```

4. Start the application:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3001`.

## Optional private receipt storage

The payment workflow can store receipt and remittance images in a private
Supabase Storage bucket while keeping payment records in MySQL. Without these
settings, the existing local development behavior stores the image data in the
database.

1. Create a Supabase project and a Storage bucket named `payment-proofs`.
2. Keep the bucket private; payment proof must not be publicly accessible.
3. Add the project URL and server-only service role key to `.env`:

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

## Optional demo accounts

Set `SEED_DEMO_DATA=true` only in a development environment, then rerun
`npm run db:setup`. Missing demo accounts are created with password
`password123`; existing account passwords are never overwritten.

| Role | Email |
| --- | --- |
| Barangay Captain | `admin@barangay.gov` |
| Purok Leader | `leader@barangay.gov` |
| Collector | `collector@barangay.gov` |
| Resident | `resident@example.com` |

Do not enable demo seeding in production.

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

## Validation and production

```bash
npm run lint
npm run build
npm start
```

`npm start` serves the built frontend and API from the configured `PORT`.
Set `NODE_ENV=production` and explicitly configure `CORS_ORIGINS` for the
deployed origin.

## Project layout

```text
config/       MySQL connection
middleware/   Authentication and request security
routes/       Express API modules
scripts/      Database setup and Super Administrator bootstrap
src/          React application
server.ts     Express and Vite/static server entry point
```

Important configuration defaults are documented in `.env.example`. Never
commit the real `.env`, database credentials, JWT secret, API keys, recovery
codes, or production passwords.
