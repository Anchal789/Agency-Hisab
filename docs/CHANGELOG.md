# Changelog

## Unreleased

### 2026-11-11 — Phase 3 clickable empty-return history

- Godown register “returned later” summary opens a return-history dialog for that exact sale (`originTransactionId`).
- Dialog lists each partial return separately with date, quantity, customer, note, recorded time/staff, and sale summary totals.

### 2026-11-11 — Phase 3 empty-return modal and register relationship

- Replaced overlapping confirmation + floating form with a single Record Empty Return dialog that includes sale context and partial-return validation.
- Godown register cylinder column shows original due, later returns, and remaining for sales; return rows show “against sale” date/link and remaining after return.
- Empty returns now denormalize `originBusinessDate` and `remainingOutstandingAfter` without rewriting the original sale.

### 2026-11-10 — Phase 3 createGodownSale null optional fields

- Shared godown schema now accepts `null` for optional strings (`customCustomerName`, `note`) because Firebase httpsCallable serializes omitted/undefined values as null.
- Frontend sale payload sends `null` for unused optional strings instead of `undefined`.
- Regression tests cover registered/custom customer combinations and the reported failing payload shape.

### 2026-11-10 — Phase 3 payment method/destination category mapping

- Canonical payment categories: `cash`, `upi`, `bank`, `indane_portal`, `other` for both Settings payment methods and destinations.
- Legacy `portal` / `Online` / `Portal` names normalized on read; Godown filters destinations by matching `kind`.
- Settings payment methods now require a category; Cloud Functions persist normalized kinds.

### 2026-11-10 — Phase 3 remove Booking name

- Removed Booking name from godown create/edit forms, detail display, payloads, schemas, and Cloud Function writes.
- Booking / No Booking status remains. Legacy `bookingName` on older transactions is still readable; new writes omit it.

### 2026-11-10 — Phase 3 payment form and godown submit fixes

- Godown payment inputs are Amount Received + Amount Due; Total Sale Amount is calculated (received + due) and stored as `salePaise`.
- Payment destinations are filtered by Settings receiving-account kind matched to the selected payment method; incompatible destinations clear on method change and are rejected by Cloud Functions.
- Create/edit validation now surfaces a toast when the form is invalid (previously failed silently), and Functions return the first schema error message.
- Unit tests updated for amount identity, destination filtering, booking, and payment cases.

### 2026-11-07 — Phase 3 Godown Register and Daily Sales

- Godown register UI: daily list, filters, search, summary totals, create/edit/detail, empty-return recording.
- Registered and custom customers; booking / no-booking; configurable cylinder types, payment methods, and destinations from Settings.
- Cloud Functions: `createGodownSale`, `updateGodownSale`, `reverseGodownSale`, `recordEmptyReturn` with idempotency, Asia/Kolkata business dates, and `approval: not_required`.
- Empty-cylinder obligations for later returns; no inventory/financial ledger posting yet.
- Permissions: `godown.view`, `godown.create`, `godown.edit`; admin-only reverse for today’s business date.
- Firestore rules/indexes updated for godown reads; client writes still denied.
- Unit/rules tests, typecheck, and production build validation. Not pushed or deployed.

### 2026-11-07 — Phase 2 Customer Master and Excel import

- Customer list, detail, add, and edit with validation, duplicate consumer-number checks, and Asia/Kolkata date display.
- Search by first/last/full/partial name and consumer number via `searchTokens` (full collection, not page-only).
- Excel import wizard: upload (.xlsx/.xls), column mapping, preview with invalid/duplicate reporting, chunked Firestore commits, progress, summary, and CSV error export.
- Permissions: `customers.view`, `customers.create`, `customers.edit`; routes and nav gated; Firestore client writes denied.
- Cloud Functions: `createCustomer`, `updateCustomer`, `checkCustomerConsumerNumbers`, `commitCustomerImport` (idempotent batch ids).
- Unit, rules, typecheck, and production build validation. Not pushed or deployed.

### 2026-11-07 — Phase 1 Settings, Account and Users search

- Expanded admin Settings: language persistence, editable agency profile, payment methods/destinations, locations/godowns, cylinder types, and price rules via `manageAgencyConfig` (Admin SDK).
- Firestore rules: client writes still denied for config collections; locations/products readable by agency users; price rules admin-read.
- Fixed Users search with shared `filterUsers` / digit-tolerant phone matching; SearchInput no longer lets props override controlled value.
- Account page shows labeled name, phone, role, and status for admin and staff.

### 2026-11-07 — Phase 1 permission nav root-cause fix and quality gate

- Root cause: sidebar hid every unimplemented module from staff (`enabled === false`), so permitted modules never appeared even when Firestore permissions were correct.
- Shared `canViewNavModule` / `visibleNavModules` now drive sidebar visibility; unimplemented modules show as non-link “Later” when permitted.
- Auth profile updates use Firestore snapshot data directly; staff create/update normalize permissions on write.
- Shared `FormField` + safer Input hover/focus spacing across Phase 1 forms.
- Added `docs/PHASE_QUALITY_GATE.md` for future phases.

### 2026-11-07 — Phase 1 user management and auth corrections

- Added Edit Permissions on the Users page (loads current permissions, saves via `updateStaffAccess`).
- Hardened Phase 1 form validation (field errors, phone normalization, submit disabled while invalid/pending).
- Mapped Firebase `USER_DISABLED` / `auth/user-disabled` to a dedicated login message.
- Permission-aware sidebar/mobile nav and route gates; Settings remains admin-only; dashboard requires admin or ≥1 staff permission.
- Auth profile listens for Firestore updates so permission changes apply without re-creating accounts.

### 2026-11-07 — Secure Firestore rules (audit and local test only)

- Replaced open/temporary client access with least-privilege `firestore.rules` based on Auth custom claims (`role`), not editable profile fields.
- Client writes denied for users (except language-only self update), settings, transactions, ledgers, balances, obligations, and audit logs; Admin SDK / Cloud Functions remain the write path.
- Expanded emulator rules tests for unauthenticated access, role elevation, approval mutations, financial/inventory/audit writes, admin reads, and unmatched paths.
- Not deployed to Firebase Console / production; awaiting explicit publish approval.

### 2026-11-06 — Phone number + password authentication

- Replaced user-facing email login with Indian mobile + password (Approach B synthetic email mapping).
- Updated staff creation, bootstrap, and admin migration to use `phoneE164` while preserving Firebase Auth UIDs.
- Replaced email password-reset UI with administrator temporary-password reset and forced password change.
- Updated Firestore rules, shared schemas, Cloud Functions, and documentation.
- Migrated emulator administrator `ibE4xXLDD5LI6T8EuXSy6IOCo3QP` in place to `+919876543210` (UID preserved).

### 2026-11-06 — Phase 1 foundation

- Scaffolded Vite + React + TypeScript + Tailwind application shell.
- Added Firebase Auth/Firestore/Functions/Storage client configuration and emulator wiring.
- Implemented login, logout, forgot password, protected routes, admin/staff navigation, and access-denied handling.
- Added admin Users management UI and Cloud Functions (`createStaffUser`, `updateStaffAccess`).
- Added one-time emulator admin bootstrap script (`npm run bootstrap:admin`).
- Added Firestore and Storage security rules denying privileged client writes.
- Added shared money/journal/business-date/permission helpers and unit tests.
- Added Firestore rules integration tests (6 passing against the emulator).
- Production web build succeeds.
- Cloud Functions load in the emulator after pinning `firebase-functions@4.9.0` for Firebase CLI 13.1.0.

### 2026-11-05 — Inspection

- Inspected https://github.com/Anchal789/Agency-Hisab. The repository is public and had no commits and no files.
- Recorded the architecture proposal, Firestore model, business rules, phase plan, and testing strategy.
