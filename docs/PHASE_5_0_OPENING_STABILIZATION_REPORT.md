# Phase 5.0 Financial Opening — Stabilization Report

**Date:** 2026-11-23  
**Scope:** Phase 5.0 only (no Phase 5F)  
**Production:** no deploy, no production data changes  

---

## A. Root causes

### Reported Error 1 — `Opening session state must be one of: preparing [400]`

**Cause:** After `markOpeningReady`, the session is `ready_to_publish`. The UI finish button always re-ran `buildOpeningRollup` (expects `preparing`) before publish. A failed publish (or a retry) left the session ready while the client still attempted preparing-only workers.

### Reported Error 2 — `Session must be preparing [400]` (Enter Existing Balances)

**Cause:** The wizard used **local React step state**, not `openingSessions.state`. Completed-step **Review** could force the balances section after `markOpeningReady`. `saveOpeningBalanceSheet` correctly rejects non-`preparing` sessions (architecture: no ready → preparing transition).

### Additional defects found

| ID | Defect | Severity |
|----|--------|----------|
| D1 | Publish mutation bundled rollup → ready → publish with no ready-state branch | High |
| D2 | UI did not hydrate active sealing session from backend (refresh lost context / ignored `ready_to_publish`) | High |
| D3 | Review/edit of balances/prepare/dues still offered after ready | High |
| D4 | `getFinancialOpeningStatus` omitted active session, sheet, plan, rollup | Medium |
| D5 | Error messages did not explain “ready — publish or cancel” | Low |
| D6 | `publishFinancialOpening` interleaved `tx.get`/`tx.set` for balances and read session after writes → Firestore “all reads before writes” failure | **Critical** |

Guards were **not** removed. Staging still requires `preparing`; publish still requires `ready_to_publish`.

---

## B. Implementation changes

1. **`shared/rules/opening-session-ui.ts`** — `openingPublishActionPlan`, `openingAllowsStagingEdits`, blocked messages.
2. **`FinancialOpeningPage.tsx`** — hydrate from status; lock staging when ready; publish-only retry; clearer UX.
3. **`getFinancialOpeningStatus`** — returns `activeSession`, `balanceSheet`, `plan`, `hasRollup`, `reviewCount`.
4. **`saveOpeningBalanceSheet` / `planFinancialOpening` / worker guard** — clearer ready-locked messages.
5. **`markOpeningReady`** — idempotent when already ready for same generation/fence (publish retry safety).
6. **Tests** — unit guards + emulator session inspection.

### Files modified

- `shared/rules/opening-session-ui.ts` (new)
- `src/modules/finance/FinancialOpeningPage.tsx`
- `src/i18n/en.ts`, `src/i18n/hi.ts`
- `functions/src/finance/post-opening.ts`
- `functions/src/finance/opening-context.ts`
- `tests/unit/finance-opening.test.ts`
- `tests/integration/finance-opening-session.emulator.test.ts` (new)
- `docs/PHASE_5_0_OPENING_STABILIZATION_REPORT.md` (this file)

---

## C. Test environment

- Firebase emulators: project `hisab-9d3e4`, Firestore `127.0.0.1:8081`, Functions `5001`, Auth `9099`
- Frontend: `npm run dev` (Vite + `VITE_USE_EMULATORS=true`)
- Functions rebuilt with `npm run build` in `functions/` (emulator loads compiled output)
- Verified no production writes (emulator host only)

---

## D. Test results

| Test area | Tests run | Passed | Failed | Not tested |
|-----------|----------:|-------:|-------:|-----------:|
| Unit finance-opening (+ session UI guards) | 18 | 18 | 0 | — |
| Emulator opening session inspection | 2 | 2 | 0 | — |
| Frontend typecheck | 1 | 1 | 0 | — |
| Frontend build | 1 | 1 | 0 | — |
| Functions build | 1 | 1 | 0 | — |
| UI browser (Cursor IDE browser) | 1 publish path | 1 | 0 | Full multi-scenario matrix not exhausted |
| Full architecture T1–T27 automated | Partial | Partial | 0 | Many T-ids remain unit/schema-only (see matrix) |
| Concurrent two-admin publish | 0 | 0 | 0 | Not run |
| Network timeout injection | 0 | 0 | 0 | Not run |

---

## E. Accounting verification (emulator snapshot)

Session `9b618b21-824a-4d16-934f-c93754447648`:

**Before fix:** stuck `ready_to_publish` (caused both reported errors).

**After publish fix (UI confirmed):**

| Check | Expected | Actual |
|-------|----------|--------|
| Session state | `published` | `published` |
| Gate | `published` | `published` |
| Publication pointer | session + generation | matched |
| `financialBalances` | 8 destinations | 8 docs @ 0 paise (sheet was all zeros) |
| Agency `financialOpeningDate` | `2026-11-19` | `2026-11-19` |
| Owner loan | 0 | 0 |
| Zero opening amounts | No ledger spam | Zero-amount ledger lines skipped (by design) |
| Inventory | Unchanged by publish | Not rewritten |

UI after publish: “Starting balances are ready”.

---

## F. Architecture compliance (selected)

| Requirement / Test ID | Expected | Actual | Status | Evidence |
|-----------------------|----------|--------|--------|----------|
| Session machine §81 | preparing → ready → published; ready → abandoned only | Preserved; no ready→preparing | Pass | Code + unit guards |
| Staging only in preparing | Balance/plan/chunk/review/rollup require preparing | Still enforced | Pass | `post-opening.ts` |
| T9 publish atomicity / retry | Failed publish must not force preparing workers | Publish-only when ready | Pass | `openingPublishActionPlan` + UI |
| T13 owner loan verified | Flag required | Schema + save | Pass | unit schema test |
| T16 anchor + mismatch | Required when dates differ | UI + begin seal | Pass (prior) | Existing UI |
| T2 readiness completeness | Block ready without artifacts | markOpeningReady checks | Partial | Existing function; not expanded this pass |
| T3 stale fence/generation | Reject | `loadOpeningWorkerGuardsInTx` | Pass | Existing |
| T8 destination_opening ↔ sheet | Amounts match | Emulator inspection | Pass (this dataset) | Integration test |
| T23 preparation retry | Deterministic ids | Existing | Partial | Not re-exercised end-to-end |
| T24 mutation epoch rebuild | Invalidate on Godown during seal | Existing invalidation helper | Not retested | — |
| T26 abandonment invisibility | Gate not_opened | Existing abandon | Not retested after fix | — |
| T27 max 40 destinations | Cap | Existing | Pass | Prior unit |

---

## G. Remaining issues

| Issue | Severity |
|-------|----------|
| Fresh-from-scratch opening with non-zero balances / bridge / dues not re-run after publish (emulator already published) | Medium |
| Dual-tab / staff-denied publish matrix not exhaustively automated | Medium |
| `draft` session state unused (begin creates `preparing`) vs doc list | Low |
| markOpeningReady readiness checks still lighter than full T2/T14 snapshot matrix | Medium |
| Staff/unauthorized publish negative tests not re-run here | Medium |
| Concurrent dual-tab publish race not simulated | Medium |
| Functions emulator must be restarted/reloaded after `functions` build for Admin to pick up new status payload | Ops note |

---

## H. Manual testing checklist

1. Restart Functions emulator (or confirm reload) after this build.
2. Open **Hisab → Opening** while logged in as Admin.
3. If banner says ready to publish:
   - Confirm **Review** is hidden on Balances / Prepare / Dues.
   - Confirm Save Balances is disabled if you cannot open that step.
   - Click **Finish setup** → should publish without “must be preparing”.
   - Or **Cancel setup** → start clean.
4. Fresh path:
   - Accounts ownership OK → Start with date + stock receipt → Save balances (edit twice) → Prepare → Review dues → Finish.
   - Refresh browser mid-seal → session/balances should restore.
5. After mark-ready failure simulation: click Finish again → publish-only path.
6. Confirm financial balances appear only after publish; inventory quantities unchanged.

**Stop here for your review. Do not start Phase 5F.**
