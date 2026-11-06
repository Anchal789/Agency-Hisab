# Development Phases

Status: Phase 1 complete, including phone+password authentication enhancement. Do not start Phase 2 until explicitly approved.

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

Not started. Requires: `APPROVE PHASE 1 — START NEXT PHASE` (or equivalent explicit approval).

## Phase 3 — Godown customer register and daily sales

Not started.

## Phase 4 — Inventory and empty-cylinder obligations

Not started.

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
