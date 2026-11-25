# Stage 5F.3 — Fund Transfer Reversal Architecture

**Document:** `docs/PHASE_5F_3_ARCHITECTURE.md`  
**Project:** Hisab — Miragpur Indane Gas Agency  
**Status:** Architecture / planning only — **not approved for implementation**  
**Created:** 2026-11-25  
**Scope:** Reverse previously posted ordinary fund transfers only  
**Authority:** `docs/PHASE_5_MASTER_ARCHITECTURE.md` remains authoritative for Phase 5. This document proposes Stage 5F.3 design and lists required owner decisions / master amendments. It does **not** silently override the master architecture.

**Do not implement until the product owner explicitly approves this plan (and any required master amendments).**

---

## 0. Scope confirmation

### In scope

- Reverse an eligible posted ordinary fund transfer (`type: fund_transfer`).
- Atomic compensating debit + credit ledger lines.
- Preserve original transfer + original ledger entries.
- Permissions, audit, idempotency, duplicate-reversal protection.
- Balance and cashbook / Main Hisab consistency.
- Desktop and mobile reversal UI.
- Tests and verification plan.

### Strictly out of scope

- Owner contribution / loan / withdrawal / repayment.
- Portal funding or portal settlement.
- Financial approvals / rejection workflows.
- Customer payments, expenses, salary, accessories, New Connection, or other Phase 5 modules.
- Transfer charges / fees (not supported by Stage 5F.2).
- Changes to Phase 5.0 opening publish behavior or Stage 5F.1/5F.2 forward-transfer posting rules.
- Historical Correction product (Phase 7) — referenced only as the deferred path for ineligible dates.
- Production deploy, production data, emulator wipe of published opening evidence.

---

## 1. Existing implementation findings

### 1.1 Forward fund transfer (Stage 5F.2) — verified facts

| Concern | Existing fact |
|---------|---------------|
| Callable | `createFundTransfer`, `getFundTransfer` in `functions/src/finance/create-fund-transfer.ts` |
| Export | Both exported from `functions/src/index.ts`. **No** `reverseFundTransfer`. |
| Permission create | `finance.transfer` via `requirePermission` (Admin always passes) |
| Permission read | `finance.viewBalances` for `getFundTransfer` |
| Shared rules | `shared/rules/fund-transfer.ts` — non-portal, active, ownership present, source ≠ destination |
| Schema | `createFundTransferSchema` / `getFundTransferSchema` in `shared/schemas/finance-hisab.ts` |
| Ledger IDs | `fundTransferOutLedgerId(txId)` → `{txId}_fund_transfer_out`; `fundTransferInLedgerId(txId)` → `{txId}_fund_transfer_in` |
| Entry classes used | `fund_transfer_out` (source **debit**), `fund_transfer_in` (destination **credit**) |
| Transaction doc | `transactions/{transactionId}` with fields below |
| Atomic boundary | Single `runTransaction`: idempotency, balances, both ledger lines, tx doc, audit, idempotency write |
| Overspend | Source balance must be ≥ amount; **no** negative allowed for ordinary transfer |
| Reconciliation | Blocks if either destination `needsReconciliation === true` |
| Publication | Both balances must match published session/generation |
| UI | `/hisab/transfer`, `/hisab/transfers/:transactionId` — detail page is **read-only** today |
| Main Hisab | Day activity links `fund_transfer_out` / `fund_transfer_in` to transfer detail |

### 1.2 Exact posted transfer document structure (as written today)

`transactions/{transactionId}` after successful `createFundTransfer`:

```text
type: 'fund_transfer'
status: 'posted'
approval: 'not_required'
businessDate: YYYY-MM-DD
timezone: 'Asia/Kolkata'
amountsPaise: { amountPaise: number }
financePayload: {
  sourceAccountId,
  destinationAccountId,
  sourceName,
  destinationName,
  note: string | null,
  outEntryId,   // {transactionId}_fund_transfer_out
  inEntryId,    // {transactionId}_fund_transfer_in
}
idempotencyKey: string
createdBy: uid
createdAt / updatedAt: server timestamps
reversedByTransactionId: null
reversalOf: null
```

### 1.3 Exact ledger lines (as written today)

| Entry ID | Account | Direction | Entry class | Amount |
|----------|---------|-----------|-------------|--------|
| `{txId}_fund_transfer_out` | source A | debit | `fund_transfer_out` | X |
| `{txId}_fund_transfer_in` | destination B | credit | `fund_transfer_in` | X |

Ledger docs already support `reversalOfEntryId`, `relatedTransactionId`, `idempotencyKey`, immutable `contentHash` (via `ledger-write.ts`).

Balance helper `commitBalanceDeltasInTx` currently auto-sets `needsReconciliation` when next balance &lt; 0 (reason default `godown_reversal_overdraw`). Stage 5F.3 must **not** rely on that path for ordinary transfer reverse — see eligibility.

### 1.4 Godown reverse pattern (reference only — not automatic copy)

`reverseGodownSale` (`functions/src/godown/post-godown.ts`):

- **Admin-only** (`requireAdmin`).
- Same-day business date only (`assertTodayBusinessDate`).
- Mandatory reason + confirm phrase `DELETE` (schema).
- Original `status` → `reversed`; reason stored; audit `godown_sale.reversed`.
- Compensating financial/inventory effects; deterministic reverse IDs for godown finance paths.
- Negative destination balance allowed **only** for authorized godown unwind (master §38 / T34).

**Important:** Godown reverse is a different product. Transfer reverse must reuse **patterns** (compensating entries, Admin gate, reason, dual confirm, idempotent deterministic IDs) only where justified — not godown-specific cutover/obligation rules.

### 1.5 Permissions inventory

Existing staff keys: `finance.viewBalances`, `finance.transfer`.  
Helpers: `canViewHisabBalances`, `canCreateFundTransfer`.  
**No** `finance.reverseTransfer` (or similar) exists.

### 1.6 Cashbook / Main Hisab reads

`getMainHisabDashboard`, `listHisabDayLedger`, `listHisabCashbook` serialize ledger `entryClass` as opaque strings and translate via `mainHisab.entryClass.*`. New compensating classes need i18n labels. No code assumes only `fund_transfer_out` / `_in` for balances; transfer **detail links** currently trigger only on those two classes.

### 1.7 Master architecture silence (critical)

- **§46 Fund transfers** and **T48** define forward transfer only.
- Entry-class list includes `fund_transfer_out` / `fund_transfer_in` and allows “other explicitly documented compensating entries” (must be documented — not invented silently).
- General principles (§11.12): reversal = compensating entries, never delete history.
- Negative balances: only valid authorized **Godown** reversal unwind (§38 / §86 / T34).

Therefore Stage 5F.3 **requires owner decisions** and a **precise master amendment** before coding. Stage 5F.2 correctly marked J01–J08 N/A.

---

## 2. Exact reversal data model

### 2.1 Proposed new entry classes (requires master amendment)

Document explicitly under master “other compensating entries”:

| Entry class | Account | Direction | Meaning |
|-------------|---------|-----------|---------|
| `fund_transfer_reversal_debit` | Original destination **B** | **debit** | Unwind original `fund_transfer_in` |
| `fund_transfer_reversal_credit` | Original source **A** | **credit** | Unwind original `fund_transfer_out` |

Rationale: Do not reuse `fund_transfer_out` / `fund_transfer_in` for reverse lines — Main Hisab currently deep-links those classes to the **original** transfer detail and reporting must distinguish reverse from forward.

### 2.2 Deterministic IDs

Given original transfer id `T`:

| Artifact | ID |
|----------|----|
| Reversal transaction | `fundTransferReversalTransactionId(T)` = `{T}_reversal` |
| Compensating debit on B | `{T}_reversal_fund_transfer_reversal_debit` |
| Compensating credit on A | `{T}_reversal_fund_transfer_reversal_credit` |

Helpers to add in `shared/models/finance.ts` (implementation phase):

- `fundTransferReversalTransactionId(originalTransactionId)`
- `fundTransferReversalDebitLedgerId(originalTransactionId)`
- `fundTransferReversalCreditLedgerId(originalTransactionId)`

### 2.3 Reversal transaction document

`transactions/{T}_reversal`:

```text
type: 'fund_transfer_reversal'
status: 'posted'
approval: 'not_required'
businessDate: <policy — see §5; default proposal = original.businessDate>
timezone: 'Asia/Kolkata'
amountsPaise: { amountPaise: X }   // same X as original
financePayload: {
  originalTransactionId: T,
  sourceAccountId: A,              // original source (receives credit)
  destinationAccountId: B,         // original destination (receives debit)
  sourceName, destinationName,     // snapshot names at reverse time from agency settings
  reason: string,
  debitEntryId,
  creditEntryId,
  originalOutEntryId,
  originalInEntryId,
}
idempotencyKey: string
createdBy: actorUid
createdAt / updatedAt: server timestamps
reversalOf: T
reversedByTransactionId: null
```

### 2.4 Original transfer metadata update (allowed; ledger lines untouched)

Update `transactions/{T}` **only** with non-financial metadata:

```text
status: 'reversed'                    // was 'posted'
reversedByTransactionId: '{T}_reversal'
reverseReason: string                 // mirror godown field name style
reversedAt: serverTimestamp           // optional but recommended
reversedBy: actorUid                  // optional but recommended
updatedAt: serverTimestamp
```

**Never mutate** original `financialLedger` docs for `{T}_fund_transfer_out` / `{T}_fund_transfer_in`.  
Set compensating lines’ `reversalOfEntryId` to those original entry IDs.

### 2.5 Balance effects

| Account | Delta |
|---------|-------|
| B (original destination) | −X |
| A (original source) | +X |

Total configured destination money **unchanged**. No revenue/expense/sale_collection/inventory/dues effects.

### 2.6 Field-name note (schema docs vs code)

`docs/DATABASE_SCHEMA.md` mentions optional `reversedBy`. Live fund-transfer create already writes `reversedByTransactionId`. **Stage 5F.3 follows the live field** `reversedByTransactionId` for consistency with 5F.2 writes. Documentation tidy-up of DATABASE_SCHEMA can be a separate approved docs task.

---

## 3. Exact callable Function contract

### 3.1 `reverseFundTransfer` (new)

**Region:** `asia-south1`  
**File (proposed):** `functions/src/finance/reverse-fund-transfer.ts` (or adjacent to create)  
**Export:** `functions/src/index.ts`

**Request (Zod schema proposed in `shared/schemas/finance-hisab.ts`):**

```text
{
  idempotencyKey: uuidLike,          // client-generated
  originalTransactionId: uuidLike,   // T
  reason: string trim min 3 max 500,
  confirmPhrase: literal 'REVERSE',  // second confirmation token (UI also requires explicit checkbox/step)
}
```

Client does **not** supply amount, accounts, or business date — server loads them from the original posted transfer.

**Success response:**

```text
{
  ok: true,
  reused: boolean,
  originalTransactionId: T,
  reversalTransactionId: '{T}_reversal',
  amountPaise: X,
  businessDate: string,
  sourceAccountId: A,
  destinationAccountId: B,
}
```

**Error codes (HttpsError mapping):**

| Condition | Code | Message intent |
|-----------|------|----------------|
| Unauthenticated / no permission | `unauthenticated` / `permission-denied` | Deny |
| Schema invalid / missing reason / wrong confirm | `invalid-argument` | Confirm with reason |
| Opening not published | `failed-precondition` | Opening not published |
| Original not found | `not-found` | Transfer not found |
| Wrong type | `failed-precondition` | Not a fund transfer |
| Already reversed / reversal exists | `failed-precondition` | Already reversed |
| Not eligible date | `failed-precondition` | Only today’s transfers… |
| Insufficient balance on B | `failed-precondition` | Insufficient balance… |
| needsReconciliation (if policy blocks) | `failed-precondition` | Needs reconciliation… |
| Publication mismatch | `failed-precondition` | Balances do not match publication |
| Idempotency key reused with different payload | `already-exists` / abort per existing helper | Conflict |
| Ledger content-hash conflict | `failed-precondition` | Ledger integrity conflict |

### 3.2 `getFundTransfer` (additive response only)

Extend return to include (without changing create behavior):

- `reversedByTransactionId`
- `reversalOf` (always null for originals; present on reverse docs if a get-by-id path is added)
- `reverseReason`
- Optionally detect `type === 'fund_transfer_reversal'` **or** add `getFundTransferReversal` — **proposal:** keep `getFundTransfer` for originals only; add lightweight fields so UI can show reversed state. Reversal detail can reuse the same page by loading original id from route and showing linked reversal id.

### 3.3 No other new financial callables in 5F.3

Reads remain 5F.1 callables. No owner/portal/approval Functions.

---

## 4. Permission policy

### Proposed policy (OWNER DECISION REQUIRED — D1)

| Actor | Create transfer | Reverse transfer |
|-------|-----------------|------------------|
| Admin | Yes | **Yes** |
| Staff with `finance.transfer` | Yes | **No** |
| Staff without `finance.transfer` | No | No |
| Unauthenticated | No | No |

**Justification:** Aligns with AGENTS.md §6 and godown reverse (Admin-only). Creating a transfer redistributes cash; reversing it is a privileged correction. Staff `finance.transfer` remains create-only.

**Implementation shape:**

- Server: `requireAdmin(context)` for `reverseFundTransfer` (same as `reverseGodownSale`), **not** `finance.transfer`.
- Client: `canReverseFundTransfer(role)` → `role === 'admin'` only.
- **Do not** add a staff permission key in 5F.3 unless the owner explicitly chooses staff reverse (alternate D1b below).

### Alternate (if owner rejects Admin-only)

**D1b:** Allow Admin **or** staff with a new key `finance.reverseTransfer` (not auto-granted with `finance.transfer`). Still never allow reverse without an explicit reverse permission. Dual confirm + reason still mandatory.

### Not proposed

- “Only the original creator may reverse” — rejected as default: Admin must reverse staff mistakes; creator-only would block Admin ops and complicate audit.

---

## 5. Reversal eligibility rules

All checks are server-side inside the Firestore transaction (after schema + auth).

### 5.1 Must pass

1. Financial opening gate `published` and publication pointer present.
2. Original exists, `type === 'fund_transfer'`, `status === 'posted'`.
3. `reversedByTransactionId` is null/absent; no existing `transactions/{T}_reversal` with conflicting content.
4. Amount X = `amountsPaise.amountPaise` is positive integer; accounts A/B present on original payload.
5. Original ledger lines exist and match expected ids/classes/directions/amount (integrity check).
6. Both financial balance docs exist and match publication session/generation.
7. **Date policy (OWNER DECISION D2 — proposed default):** original `businessDate` must equal **today** in `Asia/Kolkata`. Past dates → reject with message directing Historical Correction (Phase 7). Future dates should not exist for posted transfers.
8. **Balance policy (OWNER DECISION D3 — proposed default):** B’s current `balancePaise` must be ≥ X. **Do not** allow negative destination balance for transfer reverse (master reserves negatives for godown unwind only).
9. **Reconciliation policy (OWNER DECISION D4 — proposed default):** reject if A or B has `needsReconciliation === true` (same safety bar as create).
10. Reason mandatory (min 3 chars); `confirmPhrase === 'REVERSE'`.

### 5.2 Inactive destinations (OWNER DECISION D5 — proposed default)

**Allow** reverse even if A and/or B are now `active === false` in agency settings, provided balance docs still exist.

**Justification:** Inactivation must not trap posted money that needs same-day unwind. Forward create continues to reject inactive accounts.

**Alternate D5b:** Require both active — Admin must reactivate before reverse.

### 5.3 Later transfers / changed balances

If after original A→B transfer, later activity drained B below X, reverse is **blocked** under D3 until B has sufficient funds (e.g. another transfer restores B). Stage 5F.3 does **not** invent automatic multi-hop unwind or forced overdraw.

### 5.4 Double reverse / concurrent reverse

- Deterministic reversal id + original `status`/`reversedByTransactionId` + idempotency record.
- Second call: if already reversed with same idempotency hash → replay success (`reused: true`); if already reversed with different request → failed-precondition; concurrent writers serialize in Firestore transaction.

### 5.5 Business date on compensating entries (OWNER DECISION D6 — proposed default)

Use **original transfer `businessDate`** for both compensating ledger lines and the reversal transaction doc.

**Justification:** Same-day policy means this equals today when eligible; cashbook for that business day shows transfer + reverse as a closed pair; matches godown reverse using the sale’s businessDate.

**Alternate D6b:** Always stamp reverse with “today” even if original were historical (only relevant if D2 is relaxed).

---

## 6. Accounting examples

### Example 1 — Successful reverse

Opening / prior balances: A = 100_000, B = 50_000.  
Transfer T: A→B of 10_000.

After transfer: A = 90_000, B = 60_000.  
Ledger: A debit `fund_transfer_out` 10_000; B credit `fund_transfer_in` 10_000.

Reverse T:

- B debit `fund_transfer_reversal_debit` 10_000  
- A credit `fund_transfer_reversal_credit` 10_000  
- Balances: A = 100_000, B = 50_000  
- Configured total unchanged  
- Original lines unchanged; T.status = `reversed`

### Example 2 — Insufficient funds on B

After T, another transfer moves 55_000 out of B → B = 5_000.  
Reverse T of 10_000 → **reject** (D3). No ledger writes.

### Example 3 — Already reversed

Second reverse → **reject** or idempotent replay if same key/hash. Never second compensating pair.

### Example 4 — Non-effects

`sale_collection` count, inventory balances, customer dues, portal balance, owner loan — **unchanged**.

---

## 7. Atomic transaction sequence

Single `db.runTransaction` after pre-tx auth, schema parse, gate/publication/agency reads (agency settings may be read outside or inside; accounts inactivity check uses agency settings — if D5 allows inactive, settings read is for names only).

**Inside transaction (order):**

1. Idempotency: `assertIdempotentOrReplay` for `idempotencyKey` + request hash (hash includes originalTransactionId + reason + confirmPhrase).
2. Read original `transactions/{T}`; validate type/status/not already reversed.
3. Read `transactions/{T}_reversal` if present → replay or conflict.
4. Read original ledger lines by deterministic ids; verify class/direction/amount/account.
5. `prepareBalanceDocsInTx` for A and B; publication match; D3/D4 checks.
6. `prepareLedgerLinesInTx` for debit B + credit A with `reversalOfEntryId` set; handle same-hash replay.
7. **Writes:**  
   - `commitLedgerLinesInTx`  
   - `commitBalanceDeltasInTx` with deltas `B: -X`, `A: +X`, `allowNegative` omitted/false  
   - `tx.set` reversal transaction doc  
   - `tx.update` original: status/reversedBy/reason/actor/timestamps  
   - `tx.set` audit log  
   - `writeIdempotencyInTx`

Failed transaction ⇒ no partial commit (Firestore transactional guarantee).

---

## 8. Idempotency strategy

| Mechanism | Role |
|-----------|------|
| Client `idempotencyKey` | Retry-safe network replay |
| Request content hash | Detect same key with altered reason/id |
| Deterministic `{T}_reversal` | One reversal document per original |
| Deterministic ledger ids | One compensating pair per original |
| Original `status` + `reversedByTransactionId` | Fast duplicate guard |
| Ledger `contentHash` | Integrity / same-hash no-op |

Retry with **same** key after success → `{ ok: true, reused: true, ... }`.  
Retry that would create a second reverse → hard fail.

---

## 9. UI workflow

### 9.1 Entry points

- Primary: `FundTransferDetailPage` for a **posted, eligible** transfer — show **Reverse transfer** only if `canReverseFundTransfer` (Admin) and client-side date eligibility hint (server remains authoritative).
- Main Hisab / cashbook: continue linking forward classes to detail; add labels for new reversal classes; optionally link reversal lines to original detail (`reversalOf` / transactionId).

### 9.2 Confirmation UX (design)

Mirror godown dual-confirm spirit:

1. Show impact preview: A/B names, amount, business date, resulting balances (client estimate; server authoritative).
2. Mandatory reason field.
3. Explicit second confirmation: typed phrase `REVERSE` (matches schema) **and** a checkbox “I understand this cannot be undone except by Historical Correction later.”
4. Pending disable on submit; toast success/failure; navigate to detail showing `status: reversed` + link to reversal id.
5. Desktop and mobile: same flow; stacked form; no hover-only actions; large tap targets for confirm.

### 9.3 Detail after reverse

Show badge `reversed`, reason, reversal transaction id, disable Reverse button. Original out/in ledger hint remains. Cashbook for that date shows four lines for the pair (out, in, reversal debit, reversal credit).

### 9.4 i18n

Add EN/HI strings for reverse UI and `mainHisab.entryClass.fund_transfer_reversal_debit` / `_credit`.

### 9.5 Routes

No new route required if detail page handles reversed state. Optional: `/hisab/transfers/:transactionId/reverse` as wizard — **proposal:** modal/section on detail page to minimize surface area.

---

## 10. Audit requirements

New audit action:

```text
action: 'finance.fund_transfer_reversed'
actorUid
originalTransactionId
reversalTransactionId
sourceAccountId          // A
destinationAccountId     // B
amountPaise
businessDate
reason
createdAt
```

Preserve existing `finance.fund_transfer_created` audits unchanged.

---

## 11. Failure and concurrency handling

| Scenario | Handling |
|----------|----------|
| Two Admins reverse same T | First commits; second sees reversed / existing reversal → fail or idempotent replay |
| Network retry | Same idempotency key → reused true |
| Insufficient B mid-flight | Transaction aborts; balances unchanged |
| Emulator crash mid-tx | No partial ledger (transactional); safe retry |
| Altered originalTransactionId | not-found / wrong type |
| Staff / unauthorized | permission-denied before tx |
| Opening unpublished | failed-precondition |
| needsReconciliation (D4) | failed-precondition |
| Inactive (if D5b chosen) | failed-precondition |

**Explicit non-goal for 5F.3:** fault-injection of mid-write kill (5F.2 G08 still deferred / unsafe against published opening).

---

## 12. Detailed test matrix

### 12.1 Unit (shared rules / id helpers / schema)

| ID | Case |
|----|------|
| U01 | Deterministic reversal ids stable |
| U02 | Schema rejects short reason / wrong confirmPhrase |
| U03 | `canReverseFundTransfer` Admin yes / staff no (D1) |
| U04 | Entry class constants include new compensating classes |

### 12.2 Emulator integration (Functions + Auth + Firestore)

| ID | Case | Expect |
|----|------|--------|
| E01 | Happy path full reverse | Debit B, credit A, balances restored, total conserved |
| E02 | Directions/classes correct | As §2.1 |
| E03 | Original ledger bytes unchanged | contentHash/fields identical |
| E04 | Original status reversed + reversedBy set | |
| E05 | Reversal appears in both cashbooks | listHisabCashbook A and B |
| E06 | Reversal appears in Main Hisab day activity | For businessDate |
| E07 | Second reverse rejected | |
| E08 | Concurrent duplicate reversals | One success; other fail/replay |
| E09 | Insufficient destination (B) balance | Reject; no writes |
| E10 | Inactive destination | Per D5 decision |
| E11 | needsReconciliation on A or B | Per D4 |
| E12 | Unauthorized / staff with finance.transfer | Deny reverse |
| E13 | Staff without finance.transfer | Deny |
| E14 | Missing/short reason | invalid-argument |
| E15 | Invalid / non-transfer id | not-found / failed-precondition |
| E16 | Idempotent retry same key | reused true; one pair of lines |
| E17 | Different key after success | Reject already reversed |
| E18 | sale_collection count unchanged | Snapshot compare |
| E19 | Inventory balances unchanged | Spot-check fixtures |
| E20 | Past businessDate reverse | Reject under D2 |
| E21 | Publication pointer preserved | session/gen match Phase 5.0 evidence ids |
| E22 | Configured destination total conserved | Sum active receiving accounts |

### 12.3 UI (desktop + mobile ~390×844)

| ID | Case |
|----|------|
| UI01 | Admin sees Reverse on eligible posted transfer |
| UI02 | Staff does not see Reverse (D1) |
| UI03 | Dual confirm + reason required before enable submit |
| UI04 | Pending/disabled while in flight |
| UI05 | Success shows reversed state + toast |
| UI06 | Insufficient balance server error surfaced |
| UI07 | Mobile layout usable (no clipped confirm) |
| UI08 | Reversed transfer cannot reverse again |
| UI09 | Cashbook labels for new entry classes |

### 12.4 Environment rules for tests

- Emulator only; isolated fixtures; do not wipe published opening session `9b618b21-824a-4d16-934f-c93754447648` / gen `gen_mws7ampa_mnapjzo9`.
- Do not delete immutable ledger history to “fix” balances.
- Preserve 5F.2 evidence files untouched.

---

## 13. Files expected to change during implementation

*(Planning list only — do not modify until approved.)*

### Create

- `docs/PHASE_5F_3_ARCHITECTURE.md` — **this document** (planning deliverable)
- `functions/src/finance/reverse-fund-transfer.ts` — callable
- `tests/unit/fund-transfer-reversal.test.ts`
- `tests/integration/phase5f3-fund-transfer-reversal.emulator.test.ts`
- Optional: `docs/PHASE_5F_3_*` verification report after implementation acceptance

### Modify

- `docs/PHASE_5_MASTER_ARCHITECTURE.md` — **only after owner-approved amendment** (§46 extension + entry classes + tests T48b)
- `shared/models/finance.ts` — entry classes + id helpers
- `shared/schemas/finance-hisab.ts` — reverse schema; get response fields
- `shared/rules/permissions.ts` — `canReverseFundTransfer` (Admin-only unless D1b)
- `functions/src/index.ts` — export
- `functions/src/finance/create-fund-transfer.ts` — extend `getFundTransfer` response only
- `src/services/api/finance-hisab.ts` — API client
- `src/modules/finance/FundTransferDetailPage.tsx` — reverse UX
- Possibly `MainHisabPage.tsx` / `HisabCashbookPage.tsx` — link/label handling for new classes
- `src/i18n/en.ts`, `src/i18n/hi.ts`
- Optionally `docs/DATABASE_SCHEMA.md`, `docs/BUSINESS_RULES.md` — docs sync after approval

### Explicitly not modified for 5F.3

- Opening publish (`post-opening.ts`) behavior
- Owner/portal modules
- Godown reverse rules
- Production Firebase project config / Rules unless a new collection path needs deny-client-write (reuse existing `transactions` / `financialLedger` / `financialBalances` / `auditLogs` / `idempotencyRecords` — already Functions-privileged)

---

## 14. Risks and unresolved decisions

### 14.1 Owner decisions required before coding

| ID | Decision | Proposed default | Risk if wrong |
|----|----------|------------------|---------------|
| **D1** | Who may reverse? | Admin only | Staff mistakes / over-privilege |
| **D2** | Same-day only vs historical | Same-day only; else Phase 7 | Accidental past rewrite without Historical Correction controls |
| **D3** | Insufficient B balance | Block (no negative) | Either trapped errors (if too strict) or silent overdraw (if too loose) |
| **D4** | needsReconciliation | Block reverse | Operational lock vs unsafe posting |
| **D5** | Inactive destinations | Allow reverse | Trapped funds vs policy purity |
| **D6** | Reversal businessDate | Original’s date | Cashbook day pairing clarity |
| **D7** | Entry class names | `fund_transfer_reversal_debit` / `_credit` | Reporting/UI link ambiguity if reused forward classes |
| **D8** | Confirm phrase | `REVERSE` | UX consistency with godown `DELETE` |

### 14.2 Conflicts with master architecture

| Topic | Master today | This plan | Resolution |
|-------|--------------|-----------|------------|
| Fund transfer reverse workflow | **Absent** (§46 / T48 forward only) | New §46.1 + T48b | **Requires explicit amendment** — do not code as if already approved |
| Compensating entry classes | Allow “other explicitly documented” classes | Add two named classes | Document in master list before/with implementation |
| Negative balances | Godown unwind only | Transfer reverse never negatives | **Consistent** — no amendment needed if D3 held |
| Immutable ledger | Required | Preserved | Consistent |
| Admin same-day reverse | Specified for **godown** §38; not for transfers | Propose parallel for transfers | Amendment + BUSINESS_RULES note |

### 14.3 Proposed master architecture amendment (text for owner approval)

Add after §46:

> **46.1 Fund transfer reversal**  
> Only Admin may reverse a posted ordinary fund transfer whose business date is today in `Asia/Kolkata`.  
> Reversal creates compensating entries: debit the original destination and credit the original source for the original amount.  
> It does not create revenue or expense.  
> Original ledger entries remain immutable.  
> Use entry classes `fund_transfer_reversal_debit` and `fund_transfer_reversal_credit`.  
> Reject if the original destination balance is insufficient.  
> Do not permit negative destination balance for transfer reversal.  
> Require a reason and dual confirmation.  
> Use deterministic reversal transaction and ledger IDs. Repeated requests must not double-post.  
> Past-dated transfers use Historical Correction, not this path.

Add test:

> **T48b — Fund transfer reversal**  
> Compensating debit and credit occur once. Original lines unchanged. Profit unchanged. Destination total conserved. Duplicate reverse rejected.

### 14.4 Other risks

- Main Hisab deep-link currently treats only forward classes as transfers — reversal lines need explicit UX so users are not confused.
- `commitBalanceDeltasInTx` negative→reconciliation path must not be triggered; D3 prevents it.
- Stale `docs/DEVELOPMENT_PHASES.md` still claims Phase 5 not started — ignore for status; optional later docs fix.

---

## 15. Explicit out-of-scope confirmation

This architecture **does not** include:

- Owner contribution, loan, withdrawal, or repayment  
- Portal funding or portal settlement  
- Approvals / rejection queues for transfers  
- Customer payments, dues, expenses, salary, accessories, New Connection  
- Transfer fees  
- Phase 5A–5G / 5F.4+ implementation  
- Any change to Phase 5.0 publication semantics or 5F.2 create-transfer validation beyond additive get-response fields  
- Production deployment or production data access  

---

## 16. Implementation readiness gate

Implementation of Stage 5F.3 may start **only when** the product owner confirms:

1. Acceptance of this document (or a revised version).  
2. Decisions **D1–D8** (or explicit overrides).  
3. Approval to amend `docs/PHASE_5_MASTER_ARCHITECTURE.md` with §46.1 / T48b / entry classes.  
4. Explicit instruction to begin coding (separate from planning).

Until then: **architecture and planning only.**

---

*End of Stage 5F.3 architecture plan.*
