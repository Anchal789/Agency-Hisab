# Development Phases

Status: Phase 4 Inventory Management implemented locally. Awaiting manual testing and approval before Phase 5. Do not push or deploy without approval.

Work proceeds in order. A phase starts only after the product owner sends:

`APPROVE PHASE [NUMBER] — START NEXT PHASE`

Bug reports stay inside the current phase.

A phase is finished only when the workflow runs, the UI exists, validation and permissions hold, tests that were planned for that phase have been executed, the build succeeds, and this file plus `docs/CHANGELOG.md` are updated. Code existing on disk is not completion. Follow `docs/PHASE_QUALITY_GATE.md` for the mandatory checklist.

## Phase 0 — architecture proposal

Completed. Inspection documented empty GitHub/local repos. Architecture, schema, business rules, testing strategy, and phase plan were approved.

## Phase 1 — Foundation, architecture, and authentication

Status: **complete, awaiting approval**

Implemented:

- Vite React TypeScript app, Tailwind CSS v4, shadcn-style UI primitives, React Router, i18n (English/Hindi).
- Shared domain helpers for money (paise), journal balance checks, business dates, permissions.
- Firebase client init from environment variables with emulator switch.
- Auth, Firestore, Functions, Storage config and security rules that deny privileged client writes.
- Login, logout, forgot password, session persistence, protected routes, access-denied for unprovisioned/disabled users.
- Admin and staff custom claims; role-based navigation; one-time admin bootstrap script (no public admin signup).
- Admin Users page (create staff, enable/disable) via Cloud Functions.
- Desktop sidebar and header, mobile drawer and bottom navigation.
- Dashboard with unavailable metric states (not invented zeros).
- Vitest unit tests and Firestore rules tests against the emulator.

Out of scope (deferred): customers, sales, inventory, real metrics, Capacitor, offline queue.

### Phase 1 verification (executed)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` (11 unit tests) | Passed |
| `npm run build` | Passed |
| `npm run test:rules` (6 rules tests, emulator) | Passed |
| `npm run bootstrap:admin` (emulator) | Passed (`admin@miragpur.local`) |
| Cloud Functions load in emulator | Passed after pinning `firebase-functions@4.9.0` for Firebase CLI 13.1.0 (`createStaffUser`, `updateStaffAccess` initialized) |

## Phase 2 — Customer master and Excel import

Status: **complete** (manual smoke passed before Phase 3 start)

- Customer list / detail / add / edit with field validation and duplicate consumer-number checks
- Search by name and consumer number (token/prefix) across the full collection, not only the visible page
- Excel import wizard: upload → column mapping → preview/validation → batched commit → summary + error CSV
- Permissions: `customers.view`, `customers.create`, `customers.edit` (admin retains full access)
- Firestore rules: customers readable with view permission; client writes denied
- Cloud Functions: `createCustomer`, `updateCustomer`, `checkCustomerConsumerNumbers`, `commitCustomerImport`

Out of scope for Phase 2: godown register, inventory, dues, financial posting.

## Phase 3 — Godown customer register and daily sales

Implemented locally (awaiting manual smoke approval before Phase 4):

- Godown register list with date filter, search, booking/customer-kind filters, and daily totals from posted transactions
- Create/edit godown sales for registered and custom customers; booking / no-booking; cylinder quantities; payment method and destination from Settings
- Empty-cylinder returns against open obligations without rewriting the original sale
- Immediate post with `approval: not_required` (no approval queue)
- Admin-only reverse/delete for today’s Asia/Kolkata business date (two confirmations + reason)
- Permissions: `godown.view`, `godown.create`, `godown.edit`; delete/reverse admin-only
- Cloud Functions: `createGodownSale`, `updateGodownSale`, `reverseGodownSale`, `recordEmptyReturn`
- Minimum schema for Phase 5: money fields on transactions; financial ledgers not posted yet. Phase 4 now posts inventory when cutover + opening exist.

Out of scope for Phase 3: inventory UI/reconciliation, customer dues UI, financial ledger posting, expenses, agents/vehicles.

### Phase 3 verification (executed)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm --prefix functions run typecheck` | Passed |
| `npm test` (64 unit tests) | Passed |
| `npm run build` | Passed |
| `npm run build:functions` | Passed |
| `npm run test:rules` (15 rules tests, emulator) | Passed |

## Phase 4 — Inventory Management

Implemented locally (awaiting manual smoke approval before Phase 5):

- Shared inventory models/schemas; location kinds `godown | vehicle | agent | csc | other`; `settings/agency.inventoryCutoverDate`
- Collections: `inventoryLedger`, `inventoryBalances`, `inventoryOpenings` (Functions-only writes)
- Cloud Functions: opening, receipt, return-to-distributor, transfer, reconciliation, approve, reject
- Forward-only godown sale/return/reverse inventory when cutover set, date ≥ cutover, and opening exists
- Empty-return optional receive `locationId` (defaults to sale location)
- Staff inventory creates → `pending_approval`; admin posts immediately; minimal `/inventory/pending` queue
- Inventory UI routes under `/inventory/*`; Settings cutover + location kinds; dashboard filled stock when openings exist
- Permissions: `inventory.view`, `inventory.openingStock`, `inventory.transfer`, `inventory.receive`, `inventory.reconcile`
- Firestore rules/indexes for inventory reads and pending queue; client writes denied
- Unit/rules tests, typecheck, and production build validation. Not pushed or deployed.

### Phase 4 validation (local)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm --prefix functions run typecheck` | Passed |
| `npm test` (120 unit tests) | Passed |
| `npm run build` | Passed |
| `npm run build:functions` | Passed |
| `npm run test:rules` (16 rules tests, emulator) | Passed |

### Emulator re-init after Firestore clear

1. `npm run bootstrap:admin` (restores admin profile + default agency settings).
2. Settings: active location(s) and cylinder product(s).
3. Then Inventory → Opening. See `docs/AUTHENTICATION.md` § Emulator reset.

### Phase 4 manual smoke checklist

1. Settings: create vehicle/agent/CSC locations; set inventory cutover date (or leave blank and let first opening set it).
2. Inventory → Opening: record opening for godown + cylinder product; confirm balances appear (not “Unavailable”).
3. Staff with `inventory.receive` creates a receipt → appears in Pending; admin approve → balances update; reject with reason → no stock change.
4. Transfer between two locations; confirm ledger has out+in lines and balances net correctly.
5. Reconciliation with variance → adjustment ledger lines + reason.
6. After cutover + opening: create godown sale → filled decreases / empty received increases; empty return with alternate receive location → empty increases there.
7. Sale before cutover or without opening → no inventory lines (`inventoryApplied` false).
8. Dashboard filled-stock card shows real total when openings exist.
9. Hindi/English inventory nav and permission labels render.

## Phase 5 — Payments, customer dues, and expenses

Not started.

## Phase 6 — Agents, vehicles, and Hisab

Not started.

## Phase 7 — Approvals, daily closing, and historical corrections

Not started.

## Phase 8 — Offline, reports, backups, and Android

Not started.

## Dependency rule

If a later concept is required to post a current feature, add only the minimum schema and function. Do not build the later screen. Example: Phase 3 may write inventory ledger lines and obligation documents so a sale is complete, while the inventory UI waits for Phase 4.
