# Cursor Chat Handoff — Continue at Stage 5F.3 (Architecture Planning Only)

**Created:** 2026-11-25  
**Project:** Hisab — Miragpur Indane Gas Agency  
**Workspace:** `d:\Project\Agency HIsab`  
**Firebase project ID:** `hisab-9d3e4`  
**Purpose:** Bring a new Cursor chat to full context so it can continue from Stage 5F.3 **architecture planning for fund transfer reversal only**.

**Do not implement Stage 5F.3 (or any later work) in the next chat unless the product owner explicitly approves implementation after the architecture plan.**

---

## 1. Project architecture, stack, and repository instructions

### What this product is

Agency Hisab is the Miragpur Indane Gas Agency management system: godown sales, inventory, financial opening, destination cashbooks / Main Hisab, and (in later Phase 5 stages) owner/portal/dues/expenses workflows.

### Authoritative agent / workflow docs

| Document | Role |
|----------|------|
| `AGENTS.md` | Primary AI/agent operating rules: cost control, workflow, financial integrity, security, phase stops |
| `.cursor/rules/development-workflow.mdc` | Always-on: read `AGENTS.md`, stay in approved phase, minimal changes, honest validation, stop and report |
| `docs/PROJECT_ARCHITECTURE.md` | Baseline app architecture (React + Cloud Functions + Firestore) |
| `docs/PHASE_5_MASTER_ARCHITECTURE.md` | **Authoritative Phase 5 specification** (overrides conflicting Phase 5 proposals) |
| `docs/PHASE_QUALITY_GATE.md` | Mandatory completion checklist per phase |
| `docs/BUSINESS_RULES.md` | Cross-cutting business rules (roles, money, inventory, godown reverse vs historical correction, Hisab) |
| `docs/DATABASE_SCHEMA.md` | Schema reference |
| `docs/TESTING_STRATEGY.md` | Testing approach |
| `docs/AUTHENTICATION.md` | Auth / emulator reset notes |

### Technology stack (actual)

| Layer | Choice |
|-------|--------|
| UI | React 19, TypeScript, Vite |
| Routing | React Router |
| Styling | Tailwind CSS v4, shadcn-style primitives, Lucide |
| Forms | React Hook Form + Zod |
| Server state | TanStack Query |
| Client UI state | Zustand (session UI / language / sidebar) |
| i18n | i18next — English / Hindi (`src/i18n/`) |
| Auth / data | Firebase Auth, Firestore, Storage |
| Privileged writes | Cloud Functions (TypeScript), region **`asia-south1`** |
| Shared domain | `shared/` imported by app and Functions |
| Tests | Vitest; emulator suites via `vitest.rules.config.ts` / `@firebase/rules-unit-testing` |
| Money | Integer **paise** only |
| Business timezone | **`Asia/Kolkata`** |
| Currency | INR |

Architecture pattern (from `docs/PROJECT_ARCHITECTURE.md`): browser never writes financial/inventory ledgers directly; it calls validated callable Functions; Firestore Security Rules deny privileged client writes.

### Important repository instructions (from `AGENTS.md` + workflow rule)

- Read relevant files before changing anything; prefer minimal targeted edits; reuse existing code.
- Do not invent business/accounting rules.
- Work only on the currently approved phase/task; stop and wait for explicit approval before the next phase.
- Never claim tests passed unless they were run.
- Never deploy to production or modify production data without explicit approval.
- Use the least expensive suitable model for each task (per `.cursor/rules/development-workflow.mdc`).
- Prefer local deterministic commands over expensive re-investigation.
- If instructions conflict, explain the conflict and ask before consequential architecture changes.

### Stale documentation note (uncertain relative to live work)

`docs/DEVELOPMENT_PHASES.md` still states Phase 5 “Not started” and “Stop for approval before Phase 5F”. **That file is out of date.** Live work has completed Phase 5.0 and Stages 5F.1–5F.2 locally (not deployed). Prefer verification reports and this handoff for Phase 5 status until `DEVELOPMENT_PHASES.md` / `CHANGELOG.md` are updated under an approved docs task.

---

## 2. Completed phases and verified status

| Phase / stage | Status | Notes / evidence |
|---------------|--------|------------------|
| Phase 0 | Completed | Architecture proposal |
| Phase 1 | Complete (local) | Auth, shell, permissions, bootstrap |
| Phase 2 | Complete | Customers + Excel import |
| Phase 3 | Implemented locally | Godown register / sales / reverse-today |
| Phase 4 | Implemented locally | Inventory opening, transfers, reconciliation, cutover |
| **Phase 5.0** | **Completed & verified (local emulators)** | Financial foundation + opening publish. Report: `docs/PHASE_5_0_FINAL_VERIFICATION_REPORT.md`. Evidence: `docs/evidence/phase5_0_published_opening_emulator.json` |
| **Stage 5F.1** | **Implemented and accepted** | Main Hisab shell, destination balances, cashbook reads. **No dedicated `PHASE_5F_1_*` report file found in `docs/`** — acceptance recorded in subsequent Stage 5F.2 context. Treat as accepted product stage, not as “no evidence exists for every 5F.1 scenario.” |
| **Stage 5F.2** | **PASS WITH GAPS** | Ordinary fund transfers. Report: `docs/PHASE_5F_2_FINAL_VERIFICATION_REPORT.md` |
| Stage 5F.3 | **Not started** | Next task = architecture planning only (this handoff) |
| Stage 5F.4+ / owner / portal / dues / expenses | Not started | Do not begin |
| Classic `DEVELOPMENT_PHASES.md` “Phase 5/6/7/8” labels | Stale naming | Phase 5 financial work is staged as 5.0 / 5F.* under the master architecture |

**Deployment status:** Application and Functions have been developed and tested against **local emulators**. Do not push or deploy without explicit approval.

---

## 3. Important business and accounting rules

### Money and ledgers

- Store and calculate money as **integer paise** (₹1 = 100 paise). No binary floating-point accounting.
- Posted financial transactions are **immutable**. Reversals use **compensating** entries; never physical delete of posted ledger history.
- Unique transaction IDs; idempotency for retryable operations; auditable ledger.
- Materialized `financialBalances` change only inside the posting transaction that writes ledger lines.
- Frontend previews are not authoritative; Cloud Functions validate and post.

### Destinations / ownership

- Receiving destinations come from agency settings (`receivingAccounts`).
- Ownership kinds used in 5F.2: `agency`, `third_party_held`, `portal`.
- Ordinary fund transfers **must not** use portal destinations; portal funding/settlement are reserved for a later stage (commented as Phase 5F.4 in `shared/rules/fund-transfer.ts`).
- Transfers between agency and third_party_held are allowed by current transfer account validation.
- Inactive destinations rejected. Same source/destination rejected.
- Balances flagged `needsReconciliation` block transfers (server-enforced in `createFundTransfer`).

### Fund transfers (implemented 5F.2)

- Move money between non-portal destinations: source debit + destination credit, atomic.
- Entry classes: `fund_transfer_out`, `fund_transfer_in`.
- Does **not** create revenue, expense, customer dues, inventory movements, or `sale_collection`.
- Requires: source, destination, amountPaise, businessDate, actor, idempotency key (+ client-supplied transactionId in current schema).
- Business dates: Asia/Kolkata; cannot be future; cannot be before financial opening date.
- Permissions: Admin **or** staff with `finance.transfer` (create); view balances use `finance.viewBalances` where gated.

### Godown / general reversal (existing rules — not yet a transfer-reversal product)

From `AGENTS.md` §6 and `docs/BUSINESS_RULES.md`:

- Only Admin may reverse **today’s** godown entries (agency timezone business date).
- Staff cannot reverse.
- Reason + two confirmations.
- Preserve original; create compensating reversal; audit actor/reason/ids.
- Past dates → Historical Correction (Phase 7), not same-day reverse.
- **UNCERTAIN for 5F.3:** Whether fund-transfer reversal must mirror godown same-day Admin-only rules exactly, or differ, is **not locked in `PHASE_5_MASTER_ARCHITECTURE.md` §46 / T48**. That is a primary planning question for Stage 5F.3.

### Opening / publication gate

- Financial opening must be **published** before operational Hisab posting that depends on the gate/pointer.
- Preserved emulator publication (do not destroy):
  - Session: `9b618b21-824a-4d16-934f-c93754447648`
  - Generation: `gen_mws7ampa_mnapjzo9`
  - Opening date: `2026-11-19`
  - Evidence: `docs/evidence/phase5_0_published_opening_emulator.json`

### Negative destination balances

- Master architecture: negative destination balance permitted only for a valid authorized Godown reversal unwind (not for ordinary transfers). Transfer overspend is rejected.

---

## 4. Phase 5 master architecture and its authority

**File:** `docs/PHASE_5_MASTER_ARCHITECTURE.md`

- Status line in the document: **Authoritative architecture specification** for Phase 5.
- If other docs conflict on Phase 5, follow this document.
- Do not invent alternative accounting rules or silently change Phase 1–4 behavior.
- Functions region, timezone, paise, and Phase 4 inventory cutover date (`2026-11-01`) are stated in the header.

### Fund transfers in the master architecture today

- **§46 Fund transfers:** defines forward transfer (source debit, destination credit, atomic, no revenue/expense, required fields, reject same destination).
- **T48 — Fund transfer:** “Source debit and destination credit occur once. Profit is unchanged.”
- **No dedicated fund-transfer reversal workflow** is specified in §46 / T48.
- Stage 5F.2 verification treated J01–J08 as **NOT APPLICABLE** for that reason.

### Owner / portal (later stages — out of scope now)

- §§47–49: owner contribution/loan/withdrawal/repayment; portal funding/settlement.
- Do **not** implement these under a 5F.3 reversal-planning task.

---

## 5. Phase 5.0, 5F.1, and 5F.2 — implementation and acceptance

### Phase 5.0 — Financial foundation and opening

- **Verdict:** Meets approved completion criteria for published opening foundation, with non-blocking gaps G1–G7 listed in `docs/PHASE_5_0_FINAL_VERIFICATION_REPORT.md`.
- Key artifacts: opening sessions, gate, publication pointer, destination opening balances, Admin opening UI (`src/modules/finance/FinancialOpeningPage.tsx`), Functions under `functions/src/finance/post-opening.ts` and related opening helpers.
- Stabilization also documented in `docs/PHASE_5_0_OPENING_STABILIZATION_REPORT.md`.

### Stage 5F.1 — Main Hisab shell / balances / cashbook

- Routes (from `src/app/App.tsx`):
  - `/hisab` → `MainHisabPage`
  - `/hisab/cashbook/:accountId` → `HisabCashbookPage`
- Callables: `getMainHisabDashboard`, `listHisabDayLedger`, `listHisabCashbook` (`functions/src/finance/main-hisab-reads.ts`)
- Client API: `src/services/api/finance-hisab.ts`
- Schemas: `shared/schemas/finance-hisab.ts`
- Emulator tests: `tests/integration/phase5f-main-hisab.emulator.test.ts`
- **Accepted** before 5F.2 implementation; dedicated final report file for 5F.1 was **not** found under `docs/`.

### Stage 5F.2 — Ordinary fund transfers

- Callables: `createFundTransfer`, `getFundTransfer` (`functions/src/finance/create-fund-transfer.ts`)
- Shared rules: `shared/rules/fund-transfer.ts`
- UI:
  - `/hisab/transfer` → `FundTransferPage` (gated by `canCreateFundTransfer`)
  - `/hisab/transfers/:transactionId` → `FundTransferDetailPage`
- Date helpers: `shared/rules/hisab-date.ts`
- Permissions keys in `shared/rules/permissions.ts`: `finance.viewBalances`, `finance.transfer`
- **No `reverseFundTransfer` export** exists in `functions/src/index.ts`.

Atomic write boundary (implemented): after validation, a single Firestore `runTransaction` posts both ledger lines, both balance deltas, transaction doc, audit, and idempotency record (content-hash conflict detection).

---

## 6. Stage 5F.2 final verification — results, gaps, evidence

**Report:** `docs/PHASE_5F_2_FINAL_VERIFICATION_REPORT.md`  
**Verdict:** **PASS WITH GAPS**  
**Recommendation:** Safe to proceed to Stage 5F.3 (with gaps documented). Transfer reversal is **not** delivered.

### Suite results (as recorded)

| Suite | Result |
|-------|--------|
| `tests/unit/fund-transfer.test.ts` + `tests/unit/fund-transfer-exhaustive.test.ts` | 17/17 |
| `tests/integration/phase5f2-exhaustive.emulator.test.ts` | 18/18 |
| `tests/integration/phase5f-fund-transfer.emulator.test.ts` | 11/11 |

Scenario catalog: 127 → Passed 106 / Failed 0 / Blocked 5 / N/A 8 / Not tested or partial 8.

### Accounting evidence (final snapshot)

File: `docs/evidence/phase5f2_final_balances.json`

| Check | Value |
|-------|-------|
| Configured destination total | `640000` paise (conserved vs pre-test) |
| `fund_transfer_out` / `_in` counts | 64 / 64 |
| Out sum / in sum | `412383` / `412383` |
| `sale_collection` count | `3` (unchanged by transfers) |
| Publication preserved | session + gen match Phase 5.0 |
| Pre-test baseline | `docs/evidence/phase5f2_pretest_balances.json` |
| Post-emulator intermediate | `docs/evidence/phase5f2_posttest_balances.json` |

Operational test transfers redistributed balances among destinations; **total configured money conserved**. Portal remained `0`. Extra non-configured `ra_iso_neg_*` balance docs predate 5F.2 and are excluded from configured totals.

### Remaining gaps (do not mark as passed)

| Gap | Why |
|-----|-----|
| J01–J08 transfer reversal | Not implemented; §46/T48 define forward transfer only |
| G08 emulator interruption mid-write | Unsafe against published opening dataset |
| F07 dual Admin browsers | Not dual-browser exercised |
| L-X02 / L-X03 network drop / refresh-while-pending | Not injected / not safely forced |
| D08 exact midnight Asia/Kolkata | Helper coverage; not clock-forced |
| E01 instrumented double-click | Pending-disable observed; not scripted |
| G06 / K06 literal disconnect / expired token | Covered indirectly |

### UI evidence paths

- `docs/evidence/phase5f2_ui_desktop_form.png`
- `docs/evidence/phase5f2_ui_mobile_390x844.png`
- `docs/evidence/phase5f2_ui_transfer_detail.png`

---

## 7. Firebase emulator configuration and safety restrictions

### Emulator ports (`firebase.json`)

| Service | Host / port |
|---------|-------------|
| Auth | `127.0.0.1:9099` |
| Functions | `127.0.0.1:5001` |
| Firestore | `127.0.0.1:8081` |
| Storage | `9199` |
| Hosting emulator | `5000` |
| Emulator UI | `4000` |
| Vite app (dev) | typically `http://localhost:5173` |

Scripts: `npm run emulators` (builds functions then `firebase emulators:start`), `npm run bootstrap:admin`, `npm run migrate:admin-phone`.

### Safety restrictions (mandatory)

1. **Never connect to production for testing** of financial workflows unless the owner explicitly orders it.
2. **Never deploy** Functions, Rules, indexes, or frontend to production without approval.
3. **Never modify production data.**
4. Preserve Phase 5.0 published opening evidence (session/gen/pointer/opening ledger).
5. Do **not** reset the entire emulator database if that would destroy published opening evidence.
6. Prefer isolated test records with clear test notes/ids; do not delete immutable ledger history to “clean” balances.
7. If a clean financial environment is required, use a separate isolated emulator dataset/export — do not destroy the original published dataset.
8. Confirm emulator hosts (`FIRESTORE_EMULATOR_HOST`, Auth emulator) before any Admin SDK script.

### Preserved publication identifiers

- Session: `9b618b21-824a-4d16-934f-c93754447648`
- Generation: `gen_mws7ampa_mnapjzo9`
- Opening date: `2026-11-19`
- Admin used in emulator tests: `919876543210@users.hisab.internal` (uid recorded in 5F.2 report as `0N47Z9swKiy8AJhzOtJlYT3GFlqu`)

---

## 8. Exact next task — Stage 5F.3 architecture planning (fund transfer reversal only)

### In scope for the next chat

Produce an **architecture / design plan** for **fund transfer reversal only**, suitable for product-owner review before any coding.

The plan should inspect and reconcile at least:

1. `docs/PHASE_5_MASTER_ARCHITECTURE.md` (§46, T48, general reversal/compensating-entry rules elsewhere).
2. `AGENTS.md` §6 Transaction Reversal and Historical Correction.
3. Existing godown reverse patterns (`reverseGodownSale` and related) as a **reference for patterns**, not automatic copy-paste of rules.
4. Current `createFundTransfer` / ledger ID helpers / idempotency / balance writers.
5. Main Hisab and cashbook display implications of compensating entries.
6. Permission model (likely Admin-only — **propose explicitly; do not invent without labeling uncertainty**).
7. Same-day vs historical-date eligibility (agency timezone).
8. Whether insufficient destination balance after later activity blocks reverse, and how reconciliation flags interact.
9. Deterministic reversal transaction / ledger IDs and idempotent reverse retries.
10. UI confirmation UX expectations (reason + dual confirm) — design only.
11. Test matrix outline for a future implementation phase.
12. Explicit list of **architecture decisions that must be approved** before coding (especially anything not already locked in the master architecture).

### Deliverable expected from planning chat

A planning document (path to be chosen when approved to write docs — e.g. a Stage 5F.3 plan under `docs/`) that:

- Does **not** change locked Phase 5 decisions silently.
- Calls out where the master architecture is silent and needs an owner decision.
- Does **not** implement Functions, UI, schemas, Rules, or tests unless separately approved.

### Suggested first prompt for the new chat

> Read `docs/CURSOR_CHAT_HANDOFF_STAGE_5F_3.md` and `docs/PHASE_5_MASTER_ARCHITECTURE.md`. Produce Stage 5F.3 architecture plan for **fund transfer reversal only**. Do not implement code. Do not start owner/portal/approvals/5F.4. Stop after the plan and list decisions needing owner approval.

---

## 9. Scope restrictions — do not implement without approval

**Hard stops for the next chat unless the owner says otherwise:**

- Do **not** implement Stage 5F.3 code (Functions, UI, schemas, Rules, indexes).
- Do **not** implement Stage 5F.4, owner transactions, portal funding/settlement, approvals, dues, expenses, Phase 5A, or later phases.
- Do **not** change `docs/PHASE_5_MASTER_ARCHITECTURE.md` unless the owner explicitly requests an architecture amendment after reviewing the plan.
- Do **not** deploy anything to production.
- Do **not** reset/wipe the published Phase 5.0 emulator opening evidence.
- Do **not** weaken validation or delete ledger evidence to make tests pass.
- Do **not** invent a reversal workflow and mark it as already approved by the master architecture — §46/T48 currently define forward transfers only.

---

## 10. Important files, functions, schemas, tests, and docs

### Documentation

- `docs/CURSOR_CHAT_HANDOFF_STAGE_5F_3.md` — this handoff
- `docs/PHASE_5_MASTER_ARCHITECTURE.md` — Phase 5 authority
- `docs/PHASE_5_0_FINAL_VERIFICATION_REPORT.md`
- `docs/PHASE_5_0_OPENING_STABILIZATION_REPORT.md`
- `docs/PHASE_5F_2_FINAL_VERIFICATION_REPORT.md`
- `docs/PROJECT_ARCHITECTURE.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/PHASE_QUALITY_GATE.md`
- `docs/TESTING_STRATEGY.md`
- `docs/AUTHENTICATION.md`
- `AGENTS.md`

### Evidence

- `docs/evidence/phase5_0_published_opening_emulator.json`
- `docs/evidence/phase5f2_pretest_balances.json`
- `docs/evidence/phase5f2_posttest_balances.json`
- `docs/evidence/phase5f2_final_balances.json`
- `docs/evidence/phase5f2_ui_desktop_form.png`
- `docs/evidence/phase5f2_ui_mobile_390x844.png`
- `docs/evidence/phase5f2_ui_transfer_detail.png`

### Functions (finance / Hisab)

- `functions/src/finance/create-fund-transfer.ts` — `createFundTransfer`, `getFundTransfer`
- `functions/src/finance/main-hisab-reads.ts` — dashboard / day ledger / cashbook
- `functions/src/finance/post-opening.ts` — opening publish (preserve)
- `functions/src/finance/opening-context.ts` — gate/publication helpers, hashing
- `functions/src/finance/ledger-write.ts` / `financial-ledger.ts` — ledger + balance + idempotency helpers
- `functions/src/index.ts` — exports (no reverse fund transfer today)
- `functions/src/auth/permission-guards.ts` — `requirePermission`

### Shared

- `shared/schemas/finance-hisab.ts`
- `shared/rules/fund-transfer.ts`
- `shared/rules/hisab-date.ts`
- `shared/rules/permissions.ts`
- `shared/models/finance.ts` — includes `fundTransferOutLedgerId` / `fundTransferInLedgerId` helpers
- `shared/models/agency-config.ts`

### Frontend

- `src/modules/finance/MainHisabPage.tsx`
- `src/modules/finance/HisabCashbookPage.tsx`
- `src/modules/finance/FundTransferPage.tsx`
- `src/modules/finance/FundTransferDetailPage.tsx`
- `src/modules/finance/FinancialOpeningPage.tsx`
- `src/services/api/finance-hisab.ts`
- `src/app/App.tsx` — routes and `FundTransferGate`

### Tests

- `tests/unit/fund-transfer.test.ts`
- `tests/unit/fund-transfer-exhaustive.test.ts`
- `tests/unit/hisab-date.test.ts`
- `tests/integration/phase5f-fund-transfer.emulator.test.ts`
- `tests/integration/phase5f2-exhaustive.emulator.test.ts`
- `tests/integration/phase5f-main-hisab.emulator.test.ts`
- Phase 5.0: `tests/integration/phase5-opening-acceptance.emulator.test.ts`, `tests/unit/finance-opening.test.ts`, etc.

### Config

- `firebase.json` — emulator ports, rules/indexes paths
- `firestore.rules` / `firestore.indexes.json`
- `package.json` scripts: `dev`, `emulators`, `test`, `test:rules`, `bootstrap:admin`

---

## 11. User preferences — models, phases, testing, reporting

Drawn from `AGENTS.md`, `.cursor/rules/development-workflow.mdc`, and established Phase 5 practice:

| Preference | Instruction |
|------------|-------------|
| Model selection | Use the **least expensive suitable model** for the task |
| Phase discipline | Work only on the approved phase/task; **stop** after it; wait for explicit approval before the next |
| Planning before coding | For non-trivial work: understand → concise plan (objective, files, reuse, risks, tests) → implement → validate → report |
| Implementation style | Smallest complete change; reuse existing patterns; no drive-by refactors; no unnecessary dependencies |
| Testing | Business-critical money/ledger/idempotency/permissions/concurrency tests are mandatory; run relevant suites; never claim green without running |
| Emulator-first verification | Prefer live Auth/Functions/Firestore emulators for financial callables; do not mock away critical backend paths |
| Reporting | Concise: Completed / Files Changed / Validation / Issues / Next Step; verification reports under `docs/` when doing exhaustive acceptance |
| Architecture conflicts | Explain and ask; do not silently amend `PHASE_5_MASTER_ARCHITECTURE.md` |
| Production | No deploy / no production data mutation without approval |
| Commits / PRs | Only when the user explicitly asks |
| Next stage framing | Stage 5F.3 starts as **architecture planning for fund transfer reversal only** |

---

## Quick continuity checklist for the new chat

1. Read this handoff + `AGENTS.md` + `docs/PHASE_5_MASTER_ARCHITECTURE.md` §46 / T48 + general compensating-entry rules.  
2. Read `docs/PHASE_5F_2_FINAL_VERIFICATION_REPORT.md` §J (reversal N/A) and remaining gaps.  
3. Inspect `functions/src/finance/create-fund-transfer.ts` and godown reverse patterns for reuse analysis.  
4. Produce Stage 5F.3 **plan only**; list owner decisions required.  
5. Stop. Do not code. Do not start 5F.4 / owner / portal / approvals.

---

*End of handoff. Source of truth for Phase 5 rules remains `docs/PHASE_5_MASTER_ARCHITECTURE.md`. Source of truth for 5F.2 acceptance remains `docs/PHASE_5F_2_FINAL_VERIFICATION_REPORT.md`.*
