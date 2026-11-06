# Project Architecture

Miragpur Indane Gas Agency Management System (Agency Hisab).

Status: Phase 1 complete and awaiting approval. Architecture from this document is the approved baseline.

## Inspection (5 November 2026)

| Item | Finding |
| --- | --- |
| GitHub repository | https://github.com/Anchal789/Agency-Hisab — public, default branch `main`, created 4 November 2026 |
| Remote contents | Empty. No commits, no files, no language, no license |
| Local workspace | `d:\Project\Agency HIsab` — empty, not a git repository |
| Framework, routing, UI, Firebase code, auth, tests, env files, deployment | None |
| Local toolchain | Node.js 24.14.1, npm 9.7.1, Git, Firebase CLI 13.1.0 |
| Java | Not installed. Firebase Emulator Suite requires a JDK before emulator tests can run |
| Sample customer Excel | Not present in the repository or workspace |

The Firebase web configuration was supplied in the product brief. It identifies project `hisab-9d3e4`. That client configuration belongs in environment variables, not in source control. No Firebase Admin credential was provided, and none will be placed in the frontend.

## Proposed architecture

One codebase, one domain model, two deployable processes:

1. A responsive React application (browser, tablet, and Capacitor Android shell).
2. Firebase Cloud Functions (TypeScript) that own every privileged write.

The browser never writes financial ledgers, inventory ledgers, obligations, closings, or audit records directly. It calls validated Cloud Functions. Firestore Security Rules deny those client writes even if the UI is bypassed.

```
Browser / Capacitor shell
        │  Firebase Auth (ID token + custom claims)
        ▼
React application
  routes, layouts, modules, TanStack Query
        │  callable functions + idempotency key
        ▼
Cloud Functions (Admin SDK)
  validate → authorize → atomic Firestore transaction
        │
        ▼
Firestore (transactions, ledgers, balances, customers, settings)
Storage (optional attachments, later phases)
```

Shared pure TypeScript in `shared/` is imported by both the web app and Cloud Functions:

- Branded money and quantity types.
- Zod schemas.
- Ledger, allocation, aging, and inventory calculations.
- Permission and approval-policy constants.

UI code does not recalculate posted totals independently of this module. Screens may preview a total for the operator, using the same functions the backend uses, and the backend result is authoritative.

## Technology stack

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript strict, Vite |
| Routing | React Router |
| Styling | Tailwind CSS, shadcn/ui, Lucide |
| Forms | React Hook Form + Zod |
| Server state | TanStack Query |
| Client state | Zustand only for session UI, language, and sidebar |
| Tables | TanStack Table |
| Charts | Recharts (dashboards and reports; later phases) |
| i18n | i18next, English and Hindi |
| Auth and data | Firebase Auth, Firestore, Storage |
| Privileged logic | Cloud Functions, Node 20, TypeScript |
| Offline queue | Dexie / IndexedDB in Phase 8. Idempotency keys exist from Phase 1 |
| Android | Capacitor in Phase 8 |
| Unit tests | Vitest |
| UI tests | React Testing Library |
| Emulator tests | Firebase Emulator Suite (`@firebase/rules-unit-testing`) |
| End-to-end | Playwright, added when the first user workflow exists (Phase 2 onward) |

## Folder structure

```
/
  src/                          Vite React application
    app/
      routes/
      providers/
      layouts/
    components/
      ui/                       shadcn primitives
      common/                   PageHeader, states, badges, dialogs
      forms/
      tables/
      navigation/               Sidebar, header, mobile nav
    modules/                    one folder per business area
    services/
      firebase/
      api/                      typed callable-function client
      sync/                     Phase 8
    hooks/
    stores/
    i18n/
      en/
      hi/
  shared/                       imported by src/ and functions/
    models/
    schemas/
    calculations/
    rules/
    errors/
  functions/
    src/
      auth/
      transactions/
      inventory/
      finance/
      approvals/
      corrections/
      closing/
      shared/
  tests/
    unit/
    integration/
    e2e/
  docs/
  firebase.json
  firestore.rules
  firestore.indexes.json
  storage.rules
  .env.example
```

`shared/` is an intentional addition to the requested `src/` layout so accounting rules are not copied into the functions package.

## Application shell

- Desktop: collapsible navy sidebar, top bar, dense operational pages.
- Mobile: drawer plus a short bottom bar for the daily destinations (Dashboard, Godown, Customers, Hisab, More).
- Visual tokens: charcoal/navy navigation, neutral surfaces, restrained orange accent, green for posted success, red for errors and overdue, amber for pending. No Indane logo or official brand assets.
- All user-facing strings go through i18n keys. Language is stored on the user profile and can be switched in Settings.
- Placeholder dashboard metrics are labeled unavailable until their module exists. Zero is shown only when a ledger actually sums to zero.

## Authentication and roles

- User-facing sign-in is **Indian mobile number + password**.
- Firebase Authentication still uses the Email/Password provider internally via a synthetic email mapped from E.164 (`shared/auth/phone.ts`). Details: `docs/AUTHENTICATION.md`.
- Role lives in a custom claim (`admin` or `staff`) set only by the Admin SDK.
- Staff capability flags live on `users/{uid}` and are read by rules and functions. The client cannot grant them.
- There is no public “become admin” route and no public self-registration.
- Initial administrator: `npm run bootstrap:admin` with `INITIAL_ADMIN_PHONE` / `INITIAL_ADMIN_PASSWORD`. Existing email-based admins migrate with `npm run migrate:admin-phone` while preserving UID.
- Admin creates staff accounts (phone + password). Staff cannot create users.
- Password recovery is administrator temporary-password reset; email reset links are not used.

Default approval policy, enforced on the server:

- Staff financial and inventory transactions require admin approval.
- Godown customer-register entries post immediately after server validation and do not require approval.

Hidden buttons are not the authorization mechanism.

## Backend write model

Every business operation follows the same shape:

1. Client generates a UUID transaction id and an idempotency key.
2. Callable function authenticates the caller, checks role and permission, and validates the payload with the shared Zod schema.
3. Inside one Firestore transaction it writes the transaction document, ledger lines, obligation changes, and the balance documents those lines affect.
4. `idempotencyRecords/{key}` stores the resulting transaction id. A retry returns the original result and does not post twice.
5. An `auditLogs` entry records actor, action, and before/after references.

Posted accounting documents are never deleted. Reversal and historical correction are separate transaction types.

Business date is a `YYYY-MM-DD` string in the agency timezone (default `Asia/Kolkata`). It is distinct from created, updated, approved, reversed, and corrected timestamps, which use server timestamps.

## Environment

Frontend (public client config only):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_USE_EMULATORS`

Functions runtime (never shipped to the browser):

- `INITIAL_ADMIN_EMAIL`
- Agency timezone override if not stored in `settings/agency`

`.env.example` lists names only. `.env` and service-account JSON stay gitignored.

## Deployment target

- Firebase Hosting for the web build.
- Cloud Functions and Firestore in `hisab-9d3e4`.
- Emulators for local development: Auth, Firestore, Functions, Storage.
- Capacitor Android project added in Phase 8 without a second business-logic tree.

## Repository recommendation

The GitHub repository is public and currently empty. Before any customer file or production data is imported, the repository should be made private. Sample spreadsheets with consumer data must not be committed.
