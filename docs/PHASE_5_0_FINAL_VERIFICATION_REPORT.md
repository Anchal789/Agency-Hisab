# Phase 5.0 — Final Verification Report

**Date:** 2026-11-23  
**Scope:** Phase 5.0 remaining acceptance tests and architecture verification only  
**Production:** no deploy, no production Firebase writes  
**Next phases:** not started (Phase 5F blocked pending approval)

---

## 1. Preserved publication evidence

Captured before any destructive reset. Live emulator re-verified after acceptance runs.

| Field | Value |
|-------|-------|
| Evidence file | `docs/evidence/phase5_0_published_opening_emulator.json` |
| Project | `hisab-9d3e4` (Firestore emulator `127.0.0.1:8081`) |
| Session ID | `9b618b21-824a-4d16-934f-c93754447648` |
| Generation ID | `gen_mws7ampa_mnapjzo9` |
| Financial opening date | `2026-11-19` |
| Session state | `published` |
| Gate state | `published` |
| Publication pointer | session + generation match |
| Destinations | 8 |
| Opening sheet amounts | all `0` paise |
| Rollup published balances | all `0` paise |
| Owner loan | `0` (verified) |
| Zero-amount `destination_opening` ledger lines | skipped by design |

**Post-publish operational activity (not a publication defect):**

- Account `ra_2c614f5d-2edb-41e0-829c-50c570301e43` live balance = `100000` paise.
- Ledger row: operational `sale_collection` credit, `recordScope=operational`, session null.
- Opening rollup for that account remains `0`.
- Consistency check: `live = opening rollup + operational ledger net`.

Inventory balances remain present; publication did not wipe inventory.

---

## 2. Existing coverage inspected (before adding remaining tests)

| Suite | Prior coverage relevant to T1–T27 |
|-------|-----------------------------------|
| `tests/unit/finance-opening.test.ts` | Cohort T7/T18–T20, bridge A-03, chunk budget T11, deterministic IDs T23, hash integrity, historical schema T21, owner loan T13, destination cap T27, UI publish-only/ready lock T9 |
| `tests/unit/opening-anchor.test.ts` | Anchor eligibility / mismatch T16 |
| `tests/unit/nav-permissions.test.ts` | Hisab opening Admin-only (staff denied nav) T6 |
| `tests/integration/finance-opening-session.emulator.test.ts` | Live ready/published session inspection + publish-only rules |
| `tests/integration/firestore.rules.test.ts` | Stale opening ledger/balance denied; openingPlans client denied; financial ledger client write denied (T1/T4/T5) |
| Stabilization report | Successful UI publish path; publish reads-before-writes fix; gate/session published |

Gaps called out in the stabilization report (dual-tab, staff callables, fence/epoch, abandon, publish retry, historical reject, negative reconciliation) were **not** all automated until this pass.

---

## 3. Additional tests implemented this pass

### Created / expanded

- `tests/integration/phase5-opening-acceptance.emulator.test.ts` (new full acceptance suite)
  - Part A: evidence ↔ live pointer, T8 reconciliation, inventory presence, zero-opening ledger skip
  - Part B: real Functions emulator callables (auth, staff, duplicate publish, begin-after-publish, staging lock, abandon-after-publish, dual-tab publish, idempotency replay, historical reject)
  - Part C: isolated fence/generation/epoch/abandon guards, concurrent deterministic ledger write, bridge single-apply, negative `needsReconciliation`, abandoned-generation isolation
- `tests/unit/finance-opening.test.ts` — negative-balance reconciliation sticky-flag contract

### Not rewritten

Stabilization implementation (`post-opening.ts` publish path, UI hydrate/publish-only, opening-session-ui helpers) was left intact.

---

## 4. Execution results

| Suite | Executed | Passed | Failed | Notes |
|-------|---------:|-------:|-------:|-------|
| Unit finance-opening + opening-anchor + nav-permissions | 36 | 36 | 0 | Includes T7/T9/T13/T16/T18–T20/T27 helpers |
| Emulator acceptance (`phase5-opening-acceptance`) | 23 | 23 | 0 | Real Auth/Functions/Firestore emulators |
| Emulator session inspection | 2 | 2 | 0 | Prior stabilization suite |
| Firestore rules (opening/stale balance filter) | 1 matched (+ suite) | 1 | 0 | Stale opening denied |
| **Automated total this verification** | **62** | **62** | **0** | |

Manual UI publish path was already evidenced in `PHASE_5_0_OPENING_STABILIZATION_REPORT.md` and was not re-driven in browser this pass.

---

## 5. T1–T27 acceptance matrix

| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| T1 | Staged data isolation | **Pass** | Rules deny client reads of openingSessions/Plans/Chunks/Sheets/Rollups; abandoned/stale generation isolation test |
| T2 | Readiness completeness | **Partial** | `markOpeningReady` checks exist in code; full missing-artifact matrix not exhaustively re-run on a fresh seal (emulator already published) |
| T3 | Fence protection | **Pass** | Isolated stale fence worker rejection |
| T4 | Security query restrictions | **Pass** | Firestore rules deny unconstrained opening collections; financial ledger client writes denied |
| T5 | Published-session query | **Pass** | Rules deny stale opening ledger/balances; live pointer matches published session/generation |
| T6 | Function authorization | **Pass** | Unauthenticated publish rejected; staff denied status/publish/abandon |
| T7 | Cohort immutability | **Pass** | Pure classification unit tests (stable for fixed D/today) |
| T8 | Opening balance ↔ ledger | **Pass** | Live: opening net = rollup; live balance = rollup + operational net; zero openings skip ledger spam |
| T9 | Publication atomicity / retry | **Pass** | Published pointer stable under duplicate/concurrent/idempotent publish retries; begin-after-publish blocked |
| T10 | Generation isolation | **Pass** | Stale generation worker reject + abandoned-gen ledger not conflated with published gen |
| T11 | Bounded processing | **Pass** | Chunk budget ≤49 and split helpers (unit) |
| T12 | Review materialization | **Partial** | Schema/materialize path exists; unreviewed materialization not re-exercised on fresh seal |
| T13 | Owner loan verification | **Pass** | Schema requires `ownerLoanVerified: true`; published sheet verified |
| T14 | Snapshot verification | **Partial** | Code path present; full missing-destination block not re-run on fresh seal |
| T15 | Snapshot variance | **Not tested** | Variance Admin workflow not exercised this pass |
| T16 | Anchor date | **Pass** | Unit anchor eligibility + mismatch reason schema |
| T17 | Empty return separation | **Partial** | Godown empty-return tests exist outside this suite; not re-asserted against Phase 5 ledger in this pass |
| T18 | Pre-cutover classification | **Pass** | Unit classification |
| T19 | Bridge classification | **Pass** | Unit classification + single-apply publishedBalance helper |
| T20 | Future release | **Pass** | Unit `future_dated` classification (release callable not exercised) |
| T21 | Opening receivable exclusion / historical | **Pass (reject paths)** | Schema + callable rejects invalid link and incomplete-collection misuse; full create/link success path not re-run |
| T22 | Duplicate review warning | **Not tested** | Warning UI/flag not automated this pass |
| T23 | Preparation retry / deterministic IDs | **Pass** | Deterministic ledger/obligation IDs + content-hash concurrency write + idempotent publish key replay |
| T24 | Sale during sealing / epoch | **Pass (guards)** | Mutation-epoch mismatch rejects workers; begin blocked while published. Live epoch bump during active seal not re-simulated (gate already published) |
| T25 | Backdated sale after publication | **Partial** | Historical resolve rejects sale businessDate after opening date; silent cashbook credit prevention coded (“Never credit current destination balances for historical collection”) — full backdated godown sale posting not re-run |
| T26 | Abandonment | **Pass** | Abandoned state rejects workers; abandon-after-publish callable rejected; gate remains published |
| T27 | Destination count ≤40 | **Pass** | Schema rejects 41 destinations |

### Priority scenario checklist

| Scenario | Result |
|----------|--------|
| Dual-tab Admin publish | Pass — pointer unchanged |
| Staff-denied operations | Pass — status/publish/abandon |
| Concurrent balance/ledger writes | Pass — single deterministic ledger create |
| Stale preparation workers | Pass — fence/generation |
| Generation + mutation-epoch changes | Pass — isolated guards |
| Abandonment during/after preparation | Pass — abandoned reject + post-publish abandon blocked |
| Retry after commit / lost response | Pass — same idempotency key leaves pointer unchanged |
| Duplicate bridge collection prevention | Pass — unit A-03 single-apply |
| Historical receivable linking/rejection | Pass — reject paths via real callable |
| Negative balance / reconciliation | Pass — sticky `needsReconciliation` |
| Publication retry / duplicate prevention | Pass — duplicate + concurrent publish |

---

## 6. Final consistency review

| Check | Result |
|-------|--------|
| Applicable master architecture requirements have test evidence | Yes for T1,T3–T11,T13,T16,T18–T21,T23,T24,T26,T27; Partial for T2,T12,T14,T17,T25; Not tested T15,T22 |
| No double-counted accounting values | Pass on published dataset (opening + operational nets) |
| Destination balances = visible ledger net | Pass (`rollup + operational`) |
| Opening-scoped records match published session/generation | Pass |
| Operational records remain separate | Pass (`sale_collection` operational row) |
| Existing inventory balances unchanged by opening publication | Pass (inventory snapshot present; publish does not rewrite inventory) |
| Security restrictions enforced | Pass (rules + Functions auth/admin guards) |

---

## 7. Remaining defects / gaps

| ID | Item | Severity |
|----|------|----------|
| G1 | Fresh non-zero opening (bridge + dues + snapshots) not re-sealed because emulator is already published | Medium |
| G2 | T2/T12/T14 full readiness/materialization matrix needs a clean seal dataset | Medium |
| G3 | T15 snapshot variance Admin workflow not automated | Medium |
| G4 | T22 duplicate-review warning not automated | Low |
| G5 | T17 empty-return financial non-write not re-asserted in this suite | Low |
| G6 | T25 full backdated sale posting path after publication not end-to-end exercised | Medium |
| G7 | Live dual-admin UI race during active preparing seal not browser-tested | Low |

No critical accounting corruption found in the published emulator dataset.

---

## 8. Phase 5.0 completion verdict

**Phase 5.0 meets the approved completion criteria for the published financial opening foundation**, with the following caveats:

1. Stabilization defects that blocked publish are fixed and verified.
2. Published gate/session/pointer/balances/opening date are consistent and evidenced.
3. Critical security, concurrency, idempotency, abandonment, and reconciliation guards now have automated emulator/callable coverage.
4. Residual gaps (G1–G7) are **non-blocking for Phase 5.0 seal completion** but should be closed with an isolated fresh-seal dataset before or during early Phase 5F if those workflows are exercised again.

**Do not begin Phase 5F until explicitly approved.**  
**Do not deploy.**

---

## 9. Files changed this verification pass

- `docs/evidence/phase5_0_published_opening_emulator.json` (preserved + refreshed)
- `tests/integration/phase5-opening-acceptance.emulator.test.ts` (new)
- `tests/unit/finance-opening.test.ts` (negative reconciliation contract)
- `docs/PHASE_5_0_FINAL_VERIFICATION_REPORT.md` (this report)

---

## 10. Commands executed

```bash
npm test -- tests/unit/finance-opening.test.ts tests/unit/opening-anchor.test.ts tests/unit/nav-permissions.test.ts
npx vitest run --config vitest.rules.config.ts tests/integration/phase5-opening-acceptance.emulator.test.ts tests/integration/finance-opening-session.emulator.test.ts
npx vitest run --config vitest.rules.config.ts tests/integration/firestore.rules.test.ts -t "stale opening|financialBalances|..."
```

All listed automated checks: **passed**.
