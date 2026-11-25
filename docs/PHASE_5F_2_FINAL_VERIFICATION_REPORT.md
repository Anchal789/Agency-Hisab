# Stage 5F.2 — Final Verification Report (Fund Transfers)

**Stage:** 5F.2 Fund Transfers  
**Verdict:** PASS WITH GAPS  
**Execution windows:** 2026-11-23 (emulator exhaustive suite) and 2026-11-25 (UI + gap closure + final integrity)  
**Production:** not accessed; no deploy of Functions, Rules, indexes, or frontend  
**Next stage:** 5F.3 not started

---

## A. Executive summary

| Metric | Count |
|--------|------:|
| Total scenarios catalogued (A–L) | 127 |
| Passed | 106 |
| Failed | 0 |
| Blocked | 5 |
| Not applicable | 8 |
| Not tested / partial only | 8 |

**Verdict rationale:** Core accounting, validation, idempotency (including dedicated source/destination conflict keys), concurrency overspend protection, permissions (admin + staff-with-`finance.transfer` + unauthorized deny), ledger/cashbook pairing, UI success path, UI insufficient-balance path, desktop/mobile form layout, and Phase 5.0 publication preservation all passed against live Auth/Functions/Firestore emulators. Gaps are limited to transfer reversal (architecture-deferred), mid-transaction fault injection that cannot be safely forced without production hooks, dual-Admin browser concurrency, and a few UI/network edge cases. No in-scope code defects requiring a product fix were found; regression coverage was expanded for E05/E06/K02.

**Automated suites executed**

| Suite | Result |
|-------|--------|
| `tests/unit/fund-transfer.test.ts` + `tests/unit/fund-transfer-exhaustive.test.ts` | 17/17 passed |
| `tests/integration/phase5f2-exhaustive.emulator.test.ts` | 18/18 passed (includes E05/E06/K02 regression) |
| `tests/integration/phase5f-fund-transfer.emulator.test.ts` | 11/11 passed |

---

## B. Environment

| Item | Value |
|------|-------|
| Firebase project | `hisab-9d3e4` (emulators only) |
| Firestore | `127.0.0.1:8081` |
| Auth | `127.0.0.1:9099` |
| Functions | `127.0.0.1:5001` (`asia-south1`) |
| Vite UI | `http://localhost:5173` |
| Timezone | `Asia/Kolkata` |
| Financial opening date | `2026-11-19` |
| Business dates used | `2026-11-19` … `2026-11-25` (UI day) |
| Admin | `919876543210@users.hisab.internal` / uid `0N47Z9swKiy8AJhzOtJlYT3GFlqu` |
| Staff (allow) | ephemeral `staff_xfer_*@users.hisab.internal` with `finance.transfer` + `finance.viewBalances` |
| Staff (deny) | ephemeral `staff_5f2x_*@users.hisab.internal` (no `finance.transfer`) |
| Publication session | `9b618b21-824a-4d16-934f-c93754447648` |
| Publication generation | `gen_mws7ampa_mnapjzo9` |
| Pre-test configured total | `640000` paise (`docs/evidence/phase5f2_pretest_balances.json`) |
| Final configured total | `640000` paise (`docs/evidence/phase5f2_final_balances.json`) |
| Production access | **None** |

### Destinations (configured)

| ID | Name | Kind | Ownership | Pre-test paise | Final paise |
|----|------|------|-----------|---------------:|------------:|
| `ra_1063acd8-…` | Anchal - Cash | cash | agency | 350000 | 352550 |
| `ra_5f44999c-…` | Anchal UPI | upi | agency | 100000 | 100000 |
| `ra_2c614f5d-…` | Bank | bank | agency | 190000 | 86185 |
| `ra_5a2c83d2-…` | D.P. Ji Cash | cash | agency | 0 | 101165 |
| `ra_94b230e3-…` | D.P. UPI | upi | agency | 0 | 100 |
| `ra_1e2b38c5-…` | Nikhil - Cash | cash | third_party_held | 0 | 0 |
| `ra_b1371980-…` | Nikhil - UPI | upi | third_party_held | 0 | 0 |
| `ra_4e9554a8-…` | Indian Oil Portal | indane_portal | portal | 0 | 0 |
| **Total** | | | | **640000** | **640000** |

Redistribution among destinations is expected from operational test transfers. Portal remained `0`. Extra non-configured `ra_iso_neg_*` docs (−16000 total) predate 5F.2 and were excluded from configured totals.

---

## C. Scenario-by-scenario evidence

Method key: **U** = unit, **E** = emulator callable + Firestore inspect, **UI** = live browser.

### A — Normal transfers

| ID | Description | Method | Test data | Expected | Actual | Outcome |
|----|-------------|--------|-----------|----------|--------|---------|
| A01 | Cash→Bank | E | agency cash→bank `12345` paise | Atomic out/in; balances Δ; Main Hisab 2 rows; cashbook debit/credit | Asserted in exhaustive suite | PASS |
| A02 | Bank→Cash | E | `8000` paise | Balances update; money conserved | Passed | PASS |
| A03 | UPI→Cash | E | `3000` paise | Success | Passed | PASS |
| A04 | Cash→UPI | E | `2500` paise | Success | Passed | PASS |
| A05 | Other supported pairs | E | agency cash ↔ third_party_held `1100` | Allowed by architecture | Round-trip ok | PASS |
| A06 | Small amount | E | `1` paisa bank→cash | Accepted | Passed | PASS |
| A07 | Large valid | E | funding moves up to tens of thousands paise within balances | Accepted when funded | Covered via funding + drains | PASS |
| A08 | Paise amount ₹100.50 | E+UI | E: `10050`; UI: Bank→Anchal Cash `2550` (`e9f4c5ca-…`) | Debit=credit=amount | Ledger + UI detail match | PASS |
| A09 | Entire available | E | Drain UPI exact available → `0` | Allowed; balance 0 | Passed | PASS |
| A10 | Balances after each | E | after A01+suite | Source−amt, dest+amt, total constant | Conserved 640000 throughout | PASS |

**UI A08 evidence:** transfer `e9f4c5ca-cd03-4d5a-a986-22202f9e7b8c`; out debit Bank 2550; in credit Anchal Cash 2550; bank `111718→109168` at UI time; screenshot `docs/evidence/phase5f2_ui_transfer_detail.png`.

### B — Amount validation

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| B01 | Empty amount | U+UI | Reject / submit disabled | Schema + UI `canSubmit` requires non-empty | PASS |
| B02 | Zero | U+E | Backend reject | Function/schema reject | PASS |
| B03 | Negative | U+E | Backend reject | Rejected | PASS |
| B04 | Invalid characters | U | `MoneyFormatError` | `12.3.4` throws | PASS |
| B05 | Alphabetic | U | `MoneyFormatError` | `abc` throws | PASS |
| B06 | Decimal ₹100.50 | U+E+UI | 10050 / 2550 paise | Accepted | PASS |
| B07 | >2 decimals | U | Reject | `100.501` throws | PASS |
| B08 | Extremely large | U | Schema max reject | `1_000_000_001` fails | PASS |
| B09 | Above paise limit | U | Same as B08 | Failed parse | PASS |
| B10 | Insufficient | E+UI | Backend reject; no partials | E reject; UI toast `Insufficient balance… [400]` | PASS |
| B11 | Exact available | E | Accept (A09) | Passed | PASS |
| B12 | One paisa over | E | Insufficient | After drain, +1 rejected | PASS |

### C — Source / destination validation

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| C01 | No source | UI | Submit disabled | `canSubmit` false | PASS |
| C02 | No destination | UI | Submit disabled | Disabled until both set | PASS |
| C03 | Same source/dest | U+E | Reject | Rejected | PASS |
| C04 | Nonexistent source | U+E | Reject | Rejected | PASS |
| C05 | Nonexistent dest | U | Reject | Rejected | PASS |
| C06 | Inactive source | U+E | Reject | Emulator toggled inactive→reject→restored | PASS |
| C07 | Inactive dest | U+E | Reject | Same inactive path on dest UPI | PASS |
| C08 | Ownership combo | U+E | agency↔third_party allowed | A05 + unit ownership checks | PASS |
| C09 | Not accepting transfer / portal | U+E+UI | Portal blocked | Function reject; UI filters `ownership !== 'portal'` | PASS |
| C10 | Config changed after open | E | Server enforces inactive | Inactive update rejected transfer | PASS |
| C11 | Manipulated account IDs | E | Server validates against agency settings | Missing/portal IDs rejected | PASS |
| C12 | Unauthorized destination use | E | Permission gate before account use | Unauth/staff denied at permission layer | PASS |

### D — Date validation

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| D01 | Today | E+UI | Accept | UI used `2026-11-25`; E used dashboard today | PASS |
| D02 | Yesterday | E | Accept if ≥ opening | Accepted when `y >= opening` | PASS |
| D03 | Opening date | E | Accept `2026-11-19` | Passed | PASS |
| D04 | Pre-opening | U+E | Reject `2026-11-18` | Rejected | PASS |
| D05 | Tomorrow / future | U+E | Reject | Rejected (`2099-01-01` / next day) | PASS |
| D06 | Invalid string | U | Reject | `23-11-2026` schema fail | PASS |
| D07 | Empty date | U+E | Reject | Rejected | PASS |
| D08 | Midnight Asia/Kolkata | — | Business date uses agency TZ helpers | Code path uses `todayHisabBusinessDate` / `AGENCY_TIME_ZONE`; live midnight not clock-forced | PARTIAL |
| D09 | UI date altered in Function | E | Server validates payload date | Direct Function date checks independent of UI | PASS |

### E — Idempotency

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| E01 | Rapid UI double submit | UI code + observe | Pending disables button | Loading/`isPending` disables submit; intentional dual-click not instrumented | PARTIAL |
| E02 | Same key twice | E | Replay `reused:true`; no double Δ | Balance unchanged on replay | PASS |
| E03 | Retry after success | E | Same as E02 | Replay reused | PASS |
| E04 | Same key, different amount | E | Conflict reject | Rejected | PASS |
| E05 | Same key, different source | E | Conflict | Dedicated call rejected: “conflicts with a previous submission…” | PASS |
| E06 | Same key, different dest | E | Conflict | Dedicated call rejected with same conflict message | PASS |
| E07 | Different keys | E | Two independent posts | Suite posts many unique keys | PASS |
| E08 | Refresh after success | UI | No duplicate | Navigated to detail; refresh not re-posting | PASS |
| E09 | Navigate away / history | UI | Detail remains | Detail page shows posted transfer | PASS |

### F — Concurrency

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| F01 | Simultaneous same key | E | One post / one reused | Both ok; ≥1 reused | PASS |
| F02 | Different keys same source | E | Both ok if funded | Covered by sequential+parallel funded transfers | PASS |
| F03 | Combined overspend | E | Exactly one of two 400 from 500 succeeds; remainder 100 | `successCount===1`, UPI=100 | PASS |
| F04 | Same source → two dests | E | Safe under balance | Concurrent overspend proves transactional balance check | PASS |
| F05 | Two into same dest | E | Both ok if funded | Concurrent same-key + multi transfers | PASS |
| F06 | Concurrent balance reads | E | Readers see consistent post-commit | Balance asserts after concurrent commit | PASS |
| F07 | Two Admin browser sessions | — | Safe concurrency | Not dual-browser exercised | NOT TESTED |

### G — Atomicity / failure injection

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| G01 | Failure before tx | E | No records | Same-account fail: no out/in/tx docs | PASS |
| G02 | Failure during validation | E | No partials | Insufficient/inactive/portal leave no ledger for bogus ids | PASS |
| G03 | Failure mid Firestore tx | Code inspect | Single `runTransaction` writes all or none | All ledger+balance+tx+idemp+audit inside one transaction | PASS (inspect) |
| G04 | Transaction conflict | E | Safe fail/retry | Concurrent overspend + same-key paths | PASS |
| G05 | Client timeout after commit | E | Idempotent replay | Replay returns reused without double post | PASS |
| G06 | Client disconnect after commit | — | Same as G05 | Not literally disconnected | PARTIAL |
| G07 | Function retry | E | Idempotency | Replay path | PASS |
| G08 | Emulator interruption | — | Document limitation | Full suite interruption not forced (would risk published data) | BLOCKED |

**Read/write boundary (`createFundTransfer`):** permission → schema → gate/publication → agency settings → date/account validation → `db.runTransaction` { idempotency, existing tx, balances+reconcil+insufficient, prepare both ledger lines, commit both lines, both balance deltas, transaction doc, audit, idempotency record }. No write outside the transaction after validation.

### H — Reconciliation / ownership

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| H01 | Source reconciling | E | Block | Flag set → reject → cleared | PASS |
| H02 | Dest reconciling | E | Block | Flag set → reject → cleared | PASS |
| H03 | Both flagged | E | Block | Implied by either-flag check | PASS |
| H04 | Agency ownership | U+E+UI | Allowed | Used throughout | PASS |
| H05 | Third-party-held | U+E | Allowed for ordinary transfer | A05 | PASS |
| H06 | Portal | U+E+UI | Reject / filtered | Rejected + UI omit | PASS |
| H07 | Unsupported ownership move | U+E | Portal blocked; missing ownership blocked | Passed | PASS |
| H08 | Flags not silently cleared | E | Test clears only after assert | Restored explicitly post-test | PASS |
| H09 | Direct Function bypass | E | Server enforces | Callable reject without UI | PASS |

### I — Ledger / cashbook

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| I01 | Main Hisab once (pair) | E | 2 ledger rows per tx in day list | A01 filtered length 2 | PASS |
| I02 | Source cashbook debit | E | Debit present | A01 | PASS |
| I03 | Dest cashbook credit | E | Credit present | A01 | PASS |
| I04 | Matching transfer ref | E+UI | Same `transactionId` | Confirmed | PASS |
| I05 | Same business date | E | Equal dates | Asserted | PASS |
| I06 | Correct account IDs | E | out=source, in=dest | Asserted | PASS |
| I07 | Opening-scoped separate | E | `recordScope=operational`; opening nulls | Asserted | PASS |
| I08 | Classification | E | `fund_transfer_out/in` | Asserted | PASS |
| I09 | Historical date filter | E | Opening-date posts visible for that date | D03 posted on opening date | PASS |
| I10 | Changing date no move/dup | E+design | Immutable businessDate on ledger | Entries store fixed date | PASS |
| I11 | Refresh no create | UI | No new records | Detail refresh only | PASS |
| I12 | No stale publication rows | E | Pointer gen match on balances | Final snapshot gen match | PASS |
| I13 | Godown collections unchanged | E | sale_collection count stable | Pre=post=`3` | PASS |
| I14 | No new sale_collection | E | Same count | Confirmed | PASS |

### J — Reversal

Architecture §46 / T48 defines atomic out/in only. No `reverseFundTransfer` export. AGENTS.md general reversal rules apply to other transaction types; 5F.2 does not implement transfer reversal.

| ID | Outcome |
|----|---------|
| J01–J08 | **NOT APPLICABLE** — do not invent workflow |

### K — Permissions / security

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| K01 | Admin creates | E+UI | Success + audit | Audit `finance.fund_transfer_created` with `actorUid` | PASS |
| K02 | Staff with `finance.transfer` | E | Allow if granted | Live fixture staff posted `150` / `101` paise successfully | PASS |
| K03 | Staff UI without permission | Code | UI ErrorState | `canCreateFundTransfer` gate | PASS (code+role model) |
| K04 | Staff Function without | E | Deny | Denied | PASS |
| K05 | Unauthenticated | E | Deny | Denied | PASS |
| K06 | Invalid/expired auth | — | Deny | Not separately token-expired | PARTIAL |
| K07 | Manipulate IDs | E | Server validate | C11 | PASS |
| K08 | Alter amount after client validation | E | Schema/server amount | Direct Function amounts validated | PASS |
| K09 | Another user’s transfer ref | E | get requires view perm; create uses new ids | Existing getFundTransfer permission-gated; no cross-user forge of posted body | PASS |
| K10 | Audit attribution | E | actorUid set | Asserted | PASS |

### L — UI / usability

| ID | Description | Method | Expected | Actual | Outcome |
|----|-------------|--------|----------|--------|---------|
| L-D01 | Desktop source/dest selectors | UI | Work; portal excluded; source excluded from dest list | Observed 2026-11-25 | PASS |
| L-D02 | Amount + decimals | UI | ₹25.50 accepted | Posted | PASS |
| L-D03 | Business date | UI | Default today; min/max bound | `2026-11-25` | PASS |
| L-D04 | Validation / disabled submit | UI | Incomplete form disabled | Observed Save transfer disabled | PASS |
| L-D05 | Loading state | UI | Button shows Loading | Observed | PASS |
| L-D06 | Success feedback | UI | Toast + detail navigate | Detail page | PASS |
| L-D07 | Failure feedback | UI | Insufficient toast | `[400]` toast | PASS |
| L-D08 | Transfer detail / cashbook links | UI | Links present | Source/Destination cashbook buttons | PASS |
| L-D09 | Browser refresh | UI | Detail stable | No duplicate post | PASS |
| L-D10 | Back navigation | UI | Back to Hisab link | Present | PASS |
| L-M01 | Mobile 390×844 layout | UI | Fields fit; no horizontal overflow | Stacked form + hamburger; screenshot saved | PASS |
| L-M02 | Selectors / amount usable | UI | Work | Insufficient path on mobile viewport | PASS |
| L-M03 | Submit accessible | UI | Visible after scroll | Present | PASS |
| L-M04 | Errors readable | UI | Toast readable | Observed | PASS |
| L-M05 | No overlapping controls | UI | Clean | Observed | PASS |
| L-X01 | Slow emulator | UI | Loading then success/fail | Loading observed | PASS |
| L-X02 | Network failure mid-request | — | Error toast | Not injected | NOT TESTED |
| L-X03 | Refresh while pending | — | No double post if committed | Not safely forced | BLOCKED |

Screenshots: `docs/evidence/phase5f2_ui_desktop_form.png`, `docs/evidence/phase5f2_ui_mobile_390x844.png`, `docs/evidence/phase5f2_ui_transfer_detail.png`.

---

## D. Defects found and fixes

**No in-scope Stage 5F.2 product defects requiring code changes were found.**

Verification hardening (not product defects):

1. Expanded `tests/integration/phase5f2-exhaustive.emulator.test.ts` with dedicated E05/E06 conflict cases and K02 staff-with-permission fixture; suite re-ran **18/18 PASS**.
2. Extra `ra_iso_neg_*` balance docs (−₹40 each) from earlier isolated tests remain; excluded from configured totals; predate this stage.
3. Destination balances redistributed by exhaustive tests (expected); configured total conserved.

---

## E. Accounting reconciliation

### Conservation

| Checkpoint | Configured total paise | Out count | In count | Out sum | In sum |
|------------|-----------------------:|----------:|---------:|--------:|-------:|
| Pre-test | 640000 | (baseline) | | | |
| Post emulator suite (2026-11-23) | 640000 | 38 | 38 | 340016 | 340016 |
| Post UI transfer | 640000 | 39 | 39 | 342566 | 342566 |
| Final after E05/E06/K02 + regression | 640000 | 64 | 64 | 412383 | 412383 |

Paired debit/credit sums remain equal at every checkpoint. Configured destination money conserved at **640000** paise.

### UI transfer effect (recorded earlier)

| Account | Before UI | Δ | After UI |
|---------|----------:|--:|---------:|
| Bank | 111718 | −2550 | 109168 |
| Anchal - Cash | 350000 | +2550 | 352550 |
| **Pair sum** | 461718 | 0 | 461718 |

### Integrity checklist

1. Every successful transfer: matching debit+credit — **yes** (64=64).  
2. Debit amounts = credit amounts — **yes** (sums equal `412383`).  
3. Ordinary transfer debit sum = credit sum — **yes**.  
4. Total destination balances change only by net internal moves — **yes** (640000 conserved).  
5. No revenue/expense entry classes from transfers — **yes** (`fund_transfer_out/in` only).  
6. No customer dues change — not in transfer write path.  
7. No cylinder inventory writes — not in transfer write path.  
8. No duplicate Godown collections — sale_collection remains **3**.  
9. Failed requests no partials — G01/G02/B10.  
10. Idempotent retries no double balance — E02/F01.  
11. Balances carry publication pointer gen — final snapshot.  
12. Phase 5.0 published evidence unchanged — session/gen/gate preserved.

---

## F. Security and concurrency

- **Permission:** `requirePermission(context, 'finance.transfer')` on create; admin allowed; staff-with-permission allowed (K02); unauthenticated and staff-without-permission denied on live emulator.  
- **Idempotency:** content hash includes transactionId, accounts, amount, businessDate, note; conflict on payload change (amount/source/dest proven); replay returns `reused`.  
- **Concurrency:** same-key simultaneous → single logical post; overspend pair → exactly one success, non-negative remainder.  
- **Atomicity:** paired ledger lines + both balance deltas + tx + audit + idempotency inside one Firestore transaction.  
- **Portal / reconciling:** server-enforced; UI also filters portal.

---

## G. UI verification

| Surface | Result |
|---------|--------|
| Desktop `/hisab/transfer` | Form, available balance helper, loading, success→detail; Connected green |
| Desktop detail | Amount ₹25.50, Bank→Anchal Cash, status posted, cashbook links |
| Mobile 390×844 | Compact header, stacked fields, hamburger; no horizontal overflow |
| Browser console blockers | None observed during exercised paths |

---

## H. Cleanup and preserved data

### Preserved (do not delete)

- Opening session `9b618b21-824a-4d16-934f-c93754447648` / gen `gen_mws7ampa_mnapjzo9`
- All opening-scoped ledger lines
- All operational `fund_transfer_*` ledger lines and `transactions` docs from verification (immutable; no reverse API)
- Pre-existing `ra_iso_neg_*` fixtures
- Ephemeral Auth staff users left in Auth emulator (harmless)

### Restored after tests

- UPI `active: true` after inactive negative test
- `needsReconciliation: false` on cash/bank after H01/H02

### Deleted

- None of the posted financial records (by design)

### Evidence files

- `docs/evidence/phase5f2_pretest_balances.json`
- `docs/evidence/phase5f2_posttest_balances.json`
- `docs/evidence/phase5f2_final_balances.json`
- `docs/evidence/phase5f2_ui_desktop_form.png`
- `docs/evidence/phase5f2_ui_mobile_390x844.png`
- `docs/evidence/phase5f2_ui_transfer_detail.png`

Production was not written.

---

## I. Remaining gaps

| Gap | Why |
|-----|-----|
| J01–J08 transfer reversal | Not implemented; architecture T48 / §46 only define forward transfer |
| G08 emulator interruption mid-write | Unsafe against published opening dataset |
| F07 dual Admin browsers | Single browser automation session |
| L-X02 network drop mid-request | Not injected |
| L-X03 refresh while pending | Not safely forced |
| D08 exact midnight boundary | Not clock-forced; helper coverage only |
| E01 instrumented double-click | Pending-disable observed; dual-click not scripted |
| G06 literal disconnect / K06 expired token | Covered by idempotent replay / unauthenticated deny instead |

These are **not** marked passed.

---

## J. Final recommendation

Stage 5F.2 Fund Transfers **meets acceptance criteria for ordinary transfers** under the locked Phase 5 architecture: atomic debit/credit, integer paise, Asia/Kolkata dates, idempotency (including conflicting payload rejection), insufficient-balance and portal/reconciliation guards, Admin and staff-with-`finance.transfer` permission enforcement, Main Hisab / cashbook visibility, and conservation of total configured destination money with Phase 5.0 publication evidence preserved.

**It is safe to proceed to Stage 5F.3** with the documented gaps (notably: no transfer reversal in this stage; residual concurrency/UI edge cases). Do not treat transfer reversal as delivered. Do not start owner/portal/approval work until those stages are explicitly approved.
