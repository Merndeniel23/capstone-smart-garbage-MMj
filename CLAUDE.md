# CLAUDE.md — Token-Saving Guide & Panelist Revisions (Brgy. Bangbang SGMS)

## Strict Token-Saving Rules
1. **DO NOT run tests, builds, or linters** (`npm test`, `npm run build`, `npm run lint`, `tsc`). Only write/edit code.
2. **DO NOT scan or grep the entire repository.** Use the exact file paths Listed below.
3. **Keep responses short.** Do not write long summaries after editing files.

---

## Core Architecture & Exact File Map

### Backend (`backend/`)
- `backend/migrations/20261022_sgms_four_role_workflow.up.sql` — DB migration for optional `run_id` on `household_collections`, direct leader decisions on `household_violations`, and `subject_user_id` / `subject_role` on `complaints`.
- `backend/middleware/auth.ts` — Blocks `super_admin` (`MUNICIPAL_ACCOUNT_REMOVED`), enforces active/suspended/archived checks.
- `backend/routes/auth.ts` — Login, Register, Google OAuth (`/api/auth/google` requires `password` + `confirmPassword` before creating pending registration).
- `backend/routes/sgms.ts` — Core 4-role endpoints (`/api/sgms/*`):
  - `GET/POST /households`, `POST /households/:id/members`, `PATCH /households/:id`, `POST /households/:id/bin`
  - `POST /collections/identify`, `POST /collections`, `GET /collections` (Collector direct QR scan -> `segregated` | `not_segregated` -> notifies `purok_leader` + logs to `activity_logs`)
  - `GET/POST /violations`, `POST /violations/:id/review` (Leader decides `warning` | `fine` | `suspension`)
  - `GET /activity` (Activity logs with updated dates)
  - `GET /endorsements/:id/document`, `GET /endorsements/:id/pdf` (Auto-filled endorsement snapshot & PDF export)
  - `archiveRouter` & `POST /archives/:entity/:id(/restore)` (Soft delete / archive & restore)
- `backend/routes/admin.ts` — User management (`/api/admin/users`, `/api/admin/staff`, `/api/admin/puroks`, `/api/admin/collectors/:id/puroks`).
- `backend/routes/complaints.ts` — `GET /api/complaints/subjects` (Resident selects Purok Leader or Collector), routes complaint directly to Admin.
- `backend/routes/endorsements.ts` & `backend/services/endorsementSnapshot.ts` — Leader endorsement release with auto-fill from `shared/endorsementTemplate.ts` (`STANDARD_ENDORSEMENT_TEMPLATE`).
- `backend/routes/payments.ts` & `backend/routes/xendit.ts` — Leader payment verification (`status = 'completed'`, logs to `activity_logs`, shows in Resident `payment-history`) & Resident Xendit online payment.

### Frontend (`frontend/src/`)
- `frontend/src/App.tsx` — 4 roles (`household`, `collector`, `leader`, `admin`).
- `frontend/src/components/navigation.ts`, `Sidebar.tsx`, `BottomNav.tsx` — Role-aligned navigation hierarchy.
- `frontend/src/components/Registration.tsx` — Login, Registration, and Google OAuth password setup before account creation.
- `frontend/src/components/UserManagement.tsx` — Admin creates Puroks, Collectors, Purok Leaders, assigns Collectors to Puroks, and soft-deletes (archives) users.
- `frontend/src/components/QrCollection.tsx` — Collector scans QR and immediately selects `Segregated` or `Not Segregated`.
- `frontend/src/components/SgmsRecords.tsx` — Views for `households`, `puroks`, `collection-records`, `violations`, `activity-logs`, `archives`, `payment-history`, `endorsement-records`.
- `frontend/src/components/ComplaintsPanel.tsx` — Resident complaint form (including against Leader/Collector -> Admin).
- `frontend/src/components/EndorsementManager.tsx` & `ApprovedEndorsementDocument.tsx` — Endorsement request, Leader release, auto-fill preview, and PDF download.
- `frontend/src/components/PaymentPortal.tsx` & `OnlinePayments.tsx` — Leader payment verification & Resident Xendit payment.

---

## Panelist Rating Sheet Checklist (Ma'am Raeshelle)
1. **4 Users Only (Brgy. Bangbang)**: Remove Municipality (`super_admin`). Barangay Admin manages Puroks and Collectors (assigns collectors to puroks).
2. **Fix Side Menu Hierarchy**: Put `Notifications` higher in the sidebar menu (under `Overview` right after Dashboard/Tasks, not buried at the bottom).
3. **Avoid HTML `required`**: Remove native HTML `required` attributes from `<input>`, `<select>`, and `<textarea>` elements; add `noValidate` to `<form>` tags and rely on React/JS validation state with clear error messages.
4. **Soft Delete Only (No Hard Delete in User Management)**: Never hard-delete users; use archive/soft-delete (`archived_at` / `RecordActions` archive flow) so all historical records are preserved and restorable.
5. **Garbage Collection Flow**: Collector scans bin QR directly (no leader guide needed) -> chooses `Segregated` or `Not Segregated` -> notifies Purok Leader & records in Leader's Activity Log -> Leader issues Warning, Fine, or Suspension.

