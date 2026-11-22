# Settings Master Data Impact Audit

**Stage:** 1 — Audit only (no implementation)  
**Date:** 2026-11-22  
**Status:** Awaiting review and approval before Stage 2  

This document is the complete field-by-field audit of Settings master data versus operational records. It is based on the current repository (`SettingsPage`, `manageAgencyConfig`, shared models/schemas, Cloud Functions, and UI modules). No application code, schemas, Rules, indexes, or Firestore data were modified for this stage.

---

## 0. Executive summary

### Reported defect (payment method rename)

1. A godown / customer delivery transaction was posted with payment method ID `X` and a snapshotted display name.
2. Admin renamed payment method `X` in Settings.
3. Reopening the historical transaction still showed the **old** name.

**Root cause:** Godown posting copies `paymentMethodName` (and similarly `receivingAccountName`, `productName`) onto `transactions/{id}` at write time. List and detail UIs render those snapshotted strings instead of resolving the current master name by ID.

**Note on “inventory transaction” wording:** Phase 4 inventory postings (`stock_opening`, `stock_receipt`, transfers, etc.) do **not** store or use payment methods today. The observed payment-method rename defect applies to **Godown Register sales** (`godown_sale`) and any UI that displays those snapshotted fields. Inventory **does** snapshot `productName` on transactions while most inventory screens resolve product/location names live — creating a second, related inconsistency.

### Recommended direction (for Stage 2 approval)

| Concern | Recommendation |
|--------|----------------|
| Display names of Settings masters (methods, destinations, products, locations, price labels) | **Live-reference (A)** or **hybrid display (C)**: keep stable IDs; resolve current name from master; fall back to snapshot when master is missing |
| Posted amounts, quantities, business dates, timezone, customerSnapshot used for audit | **Historical snapshot (B)** — never rewrite from Settings defaults |
| Delete / deactivate | **Reject if any reference exists** (current + historical + reversed), enforced in Cloud Functions |
| Migration | Prefer **no bulk rewrite** of historical docs; display-layer resolution is enough. Optional later migration only with explicit approval |

---

## 1. Complete Settings inventory

### 1.1 Settings UI sections (live today)

Source: `src/modules/settings/SettingsPage.tsx`, callable `functions/src/settings/manage-agency-config.ts`, schemas `shared/schemas/agency-settings.ts`.

| # | Section | Storage | Identity | Editable fields | Actions today |
|---|---------|---------|----------|-----------------|---------------|
| 1 | Language | `users/{uid}.language` | User doc | `en` \| `hi` | Direct client update (not agency master) |
| 2 | Agency profile | `settings/agency` | Single doc | `name`, `timezone`, `currency`, `inventoryCutoverDate` | `updateProfile` |
| 3 | Payment methods | `settings/agency.paymentMethods[]` | `id` | `name`, `kind`, `active` | Full array replace via `setPaymentMethods`; UI deactivates instead of deleting |
| 4 | Payment destinations | `settings/agency.receivingAccounts[]` | `id` | `name`, `kind`, `ownership`, `compatiblePaymentMethodIds`, `active` | Full array replace via `setReceivingAccounts`; UI deactivates; hard-remove blocked if used |
| 5 | Locations | `locations/{id}` | Doc id | `name`, `kind`, `active` (always written `true` from UI) | `upsertLocation`, **hard** `deleteLocation` |
| 6 | Cylinder types (products) | `products/{id}` | Doc id | `name`, `code`, `kind`, `unit`, `active` (always `true` from UI) | `upsertProduct`, **hard** `deleteProduct` (blocked only if price rules exist) |
| 7 | Configurable prices | `priceRules/{id}` | Doc id | `productId`, `label`, `amountPaise`, `active` | `upsertPriceRule`, **hard** `deletePriceRule` |

### 1.2 Agency fields present in model but not managed in Settings UI

Source: `shared/models/agency-config.ts`, bootstrap / finance opening.

| Field | Storage | UI today | Runtime use |
|-------|---------|----------|-------------|
| `expenseCategories[]` | `settings/agency` | None (empty bootstrap) | Parsed only; **no expense module yet** |
| `inventoryStates[]` | `settings/agency` | None | **Unused**; code uses hardcoded `INVENTORY_STATES` in `shared/models/inventory.ts` |
| `negativeStockAllowed` | `settings/agency` | None | Enforced in `post-godown.ts`, `post-inventory.ts` |
| `historicalCorrectionRequiresSecondAdmin` | `settings/agency` | None | Parsed; **not enforced** yet (Phase 7) |
| `financialOpeningDate` | `settings/agency` | Set by Financial Opening publish | Finance gates |
| `ownerLoanOutstandingPaise` | `settings/agency` | Financial Opening page | Opening rollup |

### 1.3 Related masters outside Settings (in scope for reference consistency)

| Master | Collection | Coupled to Settings? |
|--------|------------|----------------------|
| Customers | `customers/{id}` | Godown stores `customerId` + `customerSnapshot` |
| Users / staff | `users/{uid}` | Display names on inventory pending; language in Settings |
| Agents / vehicles | `agents`, `vehicles` | Schema reserved; Phase 6; locations of kind `agent`/`vehicle` used for stock |
| Expenses / salary / commission rules | Future phases | `expenseCategories`, `commissionRules` in schema docs only |

---

## 2. Field-by-field impact matrix

Legend for classification (section 4):

- **A** = Live-reference display (resolve name by ID)
- **B** = Historical snapshot (preserve posted value)
- **C** = Hybrid (ID + snapshot; display prefers live name with snapshot fallback)

---

### 2.1 Agency profile — `name`

| Item | Detail |
|------|--------|
| ID | N/A (singleton `settings/agency`) |
| Display | Agency branding name |
| Copied into transactions? | No |
| Collections | `settings/agency` only |
| UI | Settings; login/branding strings partly from i18n |
| Functions | `updateProfile` |
| Classification | **A** |

| Operation | Expected | Current |
|-----------|----------|---------|
| Add / rename | Immediate everywhere branding reads agency doc | OK |
| Delete | Not applicable | N/A |
| Deactivate | N/A | N/A |
| Duplicate | N/A | N/A |

**Defects:** None for rename propagation.

---

### 2.2 Agency profile — `timezone`

| Item | Detail |
|------|--------|
| Copied? | Yes — `transactions.timezone` at post |
| Classification | **B** (snapshot at post) + agency default **A** for new posts |

| Operation | Expected | Current |
|-----------|----------|---------|
| Change timezone | New txs use new value; old txs keep posted timezone | Only `Asia/Kolkata` allowed; OK |
| Historical amounts/dates | Must not reinterpret without explicit migration | Preserved |

---

### 2.3 Agency profile — `currency`

| Item | Detail |
|------|--------|
| Copied onto txs? | No (amounts always paise) |
| Classification | **A** |

| Operation | Expected | Current |
|-----------|----------|---------|
| Change | Blocked to INR in UI/schema | OK |

---

### 2.4 Agency profile — `inventoryCutoverDate`

| Item | Detail |
|------|--------|
| Copied? | No |
| Used by | Godown inventory apply, inventory opening |
| Classification | **A** (policy gate) |

| Operation | Expected | Current |
|-----------|----------|---------|
| Set / clear | Affects whether new godown posts write inventory | Works via Settings |
| Rewrite history | Must not rewrite past ledgers | Does not |

---

### 2.5 Payment method — `id`, `name`, `kind`, `active`

| Item | Detail |
|------|--------|
| Master ID | `paymentMethods[].id` on `settings/agency` |
| Display name | `paymentMethods[].name` |
| Stored on txs | `paymentMethodId` **and** `paymentMethodName` (snapshot) |
| Collections referencing ID | `transactions.paymentMethodId` |
| UI that shows name from snapshot | `GodownPage`, `GodownDetailPage` |
| UI that uses live list | `GodownSaleForm` (active methods only) |
| Backend | `post-godown.ts` `buildSaleDocument` copies name at post/edit |
| Inventory | Does **not** use payment methods |
| Finance ledger | Does **not** store method id/name (destination `accountId` only) |
| Classification | **C** recommended: keep ID + snapshot for offline/audit fallback; **display live name by ID** |

#### Operation matrix — payment method

| Operation | Questions / expected | Current behaviour | Gap |
|-----------|----------------------|-------------------|-----|
| **Add** | Existing txs unchanged; new txs can select it | OK | — |
| **Rename** | Historical txs should **display** new name; amounts/dates/IDs unchanged; no ledger rewrite | Snapshot remains stale on list/detail | **Defect D-PM-1** (reported scenario) |
| **Edit `kind`** | Affects destination compatibility / filters for **new** selections; historical ID unchanged | Kind stored only on master; txs do not snapshot kind | Low risk if ID preserved; forms may show destinations differently |
| **Delete (remove from array)** | Must reject if any `transactions.paymentMethodId` references it | UI does not delete; **API `setPaymentMethods` can omit IDs with no in-use check** | **Defect D-PM-2** |
| **Deactivate** | Per business rule: reject if in use anywhere (including history) | UI toggles `active` freely; no reference check | **Defect D-PM-3** vs mandatory policy |
| **Duplicate name** | Blocked within same `kind` | FE + Zod uniqueness | OK |
| **Reorder** | Array order only; no report dependency found | Order follows array | No defect |

**Why rename fails today:**  
`functions/src/godown/post-godown.ts` writes `paymentMethodName: paymentMethod?.name`.  
`GodownDetailPage` / `GodownPage` render `tx.paymentMethodName`, never join `settings/agency.paymentMethods`.

**Modules affected by same pattern:** Godown list, godown detail; any future payment/expense UI that copies the same snapshot pattern.

---

### 2.6 Payment destination (receiving account) — `id`, `name`, `kind`, `ownership`, `compatiblePaymentMethodIds`, `active`

| Item | Detail |
|------|--------|
| Master ID | `receivingAccounts[].id` |
| Stored on txs | `receivingAccountId` + `receivingAccountName` |
| Also referenced as | `financialLedger.accountId`, `financialBalances/{accountId}` doc id |
| Godown display | Snapshot name |
| Financial Opening display | **Live** `accountName` via `resolveDestinationOwnership` |
| Classification | **C** for godown display; finance screens already closer to **A** |

#### Operation matrix — payment destination

| Operation | Expected | Current | Gap |
|-----------|----------|---------|-----|
| **Add** | New txs / opening can use it | OK | — |
| **Rename** | All displays show new name; balances stay on same `accountId` | Godown stale; Financial Opening live | **Defect D-RA-1** (inconsistent UX) |
| **Edit ownership / compatible methods** | Future postings & opening validation; do not rewrite historical ledger lines | Live on agency doc | OK if IDs preserved |
| **Delete / remove from array** | Reject if ledger, balance, or any transaction references ID | **Implemented** for remove (`financialLedger`, `transactions`, `financialBalances`) | Message says “deactivate instead”; deactivate itself is unrestricted |
| **Deactivate** | Per mandatory rule: reject if in use | UI toggles freely | **Defect D-RA-2** |
| **Duplicate** | Name unique within `kind` | Enforced | OK |

---

### 2.7 Location — `id`, `name`, `kind`, `active`

| Item | Detail |
|------|--------|
| Master | `locations/{id}` |
| Stored on ops | `transactions.locationId`, `inventoryLedger.*`, `inventoryBalances` id fragment, `inventoryOpenings` id, `obligations.locationId` |
| Name snapshotted? | **No** on transactions / inventory ledger |
| Display | Inventory & empty-return history resolve **live** from `locations` |
| Classification | **A** (already) |

#### Operation matrix — location

| Operation | Expected | Current | Gap |
|-----------|----------|---------|-----|
| **Add** | Available for new openings/transfers | OK | — |
| **Rename** | All screens show new name immediately | OK (live) | — |
| **Edit kind** | Affects godown-first / zero-start rules for that location | Kind updated on master; historical stock remains | Review business impact; do not rewrite balances |
| **Delete** | Reject if referenced anywhere | **Hard delete with no reference check** | **Critical defect D-LOC-1** |
| **Deactivate** | Reject if in use (policy); else hide from new forms | UI always upserts `active: true`; only hard delete offered | **Defect D-LOC-2** (no safe deactivate path) |
| **Duplicate** | Name unique within kind | Enforced | OK |

---

### 2.8 Product (cylinder type) — `id`, `name`, `code`, `kind`, `unit`, `active`

| Item | Detail |
|------|--------|
| Master | `products/{id}` |
| Stored | `productId` everywhere + **`productName` snapshot** on godown & inventory transactions |
| Godown UI | Snapshot `productName` |
| Inventory dashboard / ledger / locations | Live name by `productId` |
| Inventory pending approval | **Snapshot** `row.productName` |
| Classification | **C** |

#### Operation matrix — product

| Operation | Expected | Current | Gap |
|-----------|----------|---------|-----|
| **Add** | New txs can select | OK | — |
| **Rename** | Displays should show new name; stock quantities unchanged | Mixed live vs snapshot | **Defect D-PR-1** |
| **Edit code** | Uniqueness only; display secondary | Live on Settings | OK |
| **Edit kind/unit** | Future forms; no stock rewrite | OK if careful | — |
| **Delete** | Reject if any tx / ledger / balance / opening / obligation / price rule | Only checks **priceRules** | **Critical defect D-PR-2** |
| **Deactivate** | Reject if in use (policy) | No deactivate UI; hard delete only | **Defect D-PR-3** |
| **Duplicate** | Name unique within kind; code globally unique | Enforced | OK |

---

### 2.9 Price rule — `id`, `productId`, `label`, `amountPaise`, `active`

| Item | Detail |
|------|--------|
| Master | `priceRules/{id}` |
| Referenced by operational txs? | **No** — godown sale amounts are operator-entered; `priceRuleId` not stored |
| Schema intent (`DATABASE_SCHEMA.md`) | Changing a rule must not rewrite posted txs; posting should copy applied amount |
| Classification | When wired: **B** for `amountPaise` / applied label on the sale; **A/C** for Settings list label |

#### Operation matrix — price rule

| Operation | Expected | Current | Gap |
|-----------|----------|---------|-----|
| **Add / rename label / change amount** | Affects Settings list and **future** defaults only | OK for Settings; **not used** by posting | Product gap: prices unused in godown form |
| **Delete** | Safe if unused (always true today for txs) | Unconditional delete | Low risk today; add in-use check when posting stores `priceRuleId` |
| **Deactivate** | Supported on doc; Settings upserts with `active` | Partial | — |

---

### 2.10 Expense categories (not UI-managed)

| Item | Detail |
|------|--------|
| Storage | `settings/agency.expenseCategories[]` |
| Usage | None in live modules |
| Classification when expenses ship | **C** (expense tx stores `categoryId` + snapshot name; display live) |

| Operation | Expected for Stage 2 | Current |
|-----------|----------------------|---------|
| All ops | Out of scope until expense module | Empty list |

---

### 2.11 Inventory states

| Item | Detail |
|------|--------|
| Agency field | `inventoryStates[]` unused |
| Code | Hardcoded `filled` \| `empty` \| `damaged` |
| Classification | Treat as system enum (**A**), not Settings-editable, until a deliberate product decision |

---

### 2.12 Policy flags — `negativeStockAllowed`, `historicalCorrectionRequiresSecondAdmin`

| Field | Classification | Notes |
|-------|----------------|-------|
| `negativeStockAllowed` | **A** | Live gate for posting |
| `historicalCorrectionRequiresSecondAdmin` | **A** | Not enforced yet |

Editing must not rewrite historical ledgers.

---

### 2.13 Customer master (coupled, not Settings)

| Item | Detail |
|------|--------|
| Stored | `customerId` + `customerSnapshot` on godown txs; `obligations.customerName` from snapshot |
| Classification | **B** for register receipt / historical sale display of customer details; customer module itself is **A** |
| Rename customer | Godown historical rows stay stale until today’s edit rebuilds snapshot | May be intentional for walk-in/`custom` customers |

**Stage 2 recommendation:** Do **not** convert customerSnapshot to live-only (walk-ins have no master). Optionally show live name for registered customers with snapshot fallback — call out as separate product decision; not required to fix payment-method rename.

---

## 3. Classification summary

| Field / entity | Class | Rationale |
|----------------|-------|-----------|
| Agency name, currency | A | Branding / config |
| Agency timezone on transaction | B | Preserves business-date interpretation |
| Payment method name (display) | C → display A | ID stable; show current name; keep snapshot as fallback |
| Payment destination name (display) | C → display A | Same; finance already live |
| Location name | A | Already ID-only + live resolve |
| Product name (display) | C → display A | Fix mixed inventory/godown UX |
| Sale amounts, quantities, dues | B | Accounting integrity |
| Price rule amount (when applied) | B | Per schema |
| Customer snapshot | B (hybrid optional later) | Walk-ins; audit |
| Expense category (future) | C | — |
| Inventory state enum | A (system) | Do not Settings-edit yet |
| Policy flags | A | Live gates |

**Do not** convert amounts or quantities to live Settings defaults.

---

## 4. Critical deletion / deactivation policy (mandatory)

### Business rule (from requirements)

> If a Settings record is used anywhere (current, historical, reversed, ledgers, customers/agents links, reports), it must **not** be deleted or deactivated.

### Current vs required

| Entity | Delete today | Deactivate today | Required |
|--------|--------------|------------------|----------|
| Payment method | Possible via API array omit (no check) | Unrestricted toggle | Block delete & deactivate when `transactions.paymentMethodId` exists |
| Payment destination | Blocked if ledger/tx/balance | Unrestricted toggle | Keep delete block; **also** block deactivate when referenced |
| Location | Hard delete, **no check** | Not offered | Block delete/deactivate when referenced by txs, inventory*, obligations |
| Product | Delete only checks priceRules | Not offered | Block when referenced by txs, inventory*, obligations, priceRules |
| Price rule | Unconditional delete | Via upsert `active` | When unused: allow; when `priceRuleId` stored later: protect |

\*Including `inventoryLedger`, `inventoryBalances`, `inventoryOpenings`.

### Implementation requirements for Stage 2

1. Backend-only enforcement inside `manageAgencyConfig` (cannot rely on UI).
2. Queries: `limit(1)` existence checks across relevant collections/fields.
3. Clear `failed-precondition` messages naming module (e.g. “Used by Godown sales / Inventory balances”).
4. No cascade delete; no silent remapping to another ID.
5. Prefer deactivate-only masters **when unused**; if unused delete is allowed for a given entity, document per field (locations/products currently hard-delete — decide deactivate-first UX).

---

## 5. Payment method scenario — detailed findings

| Step | Expected | Actual |
|------|----------|--------|
| Post sale with method `X` | Store `paymentMethodId=X`, amounts, date | Stores ID **and** `paymentMethodName` copy |
| Rename `X` in Settings | Master name updates | Master updates |
| Reopen 19 Oct sale | Display **new** name; same ID, date, amount, destination | Displays **old** `paymentMethodName` |
| Stock / payment / ledger | Unchanged | Unchanged (correct) |

**Affected modules (same snapshot display pattern):**

- `src/modules/godown/GodownPage.tsx`
- `src/modules/godown/GodownDetailPage.tsx`
- Analogous for product: godown detail + inventory pending
- Analogous for destination: godown list/detail vs Financial Opening live names

**Not affected for payment methods:** Inventory receive/transfer/opening pages (no payment fields).

---

## 6. Current defects register

| ID | Severity | Description |
|----|----------|-------------|
| D-PM-1 | High (reported) | Payment method rename does not update godown historical display |
| D-RA-1 | Medium | Destination rename: godown stale vs finance live |
| D-PR-1 | High | Product rename: godown/pending snapshot vs inventory live |
| D-PM-2 | High | `setPaymentMethods` can drop IDs still referenced |
| D-PM-3 | High vs policy | Deactivate in-use payment method allowed |
| D-RA-2 | High vs policy | Deactivate in-use destination allowed |
| D-LOC-1 | Critical | `deleteLocation` with no reference scan |
| D-LOC-2 | Medium | No deactivate; only dangerous hard delete |
| D-PR-2 | Critical | `deleteProduct` ignores txs/inventory/obligations |
| D-PR-3 | Medium | No product deactivate path |
| D-PARSE-1 | Low | `parseAgencySettings` can canonicalize payment method names on read without writing Firestore |
| D-PRICE-1 | Low (product) | Price rules configured but unused by godown posting |
| D-EXP-1 | Info | `expenseCategories` / agents / salary not live yet |

---

## 7. Required Stage 2 changes (proposed — pending approval)

### 7.1 Frontend

1. **Shared display helpers** (e.g. `resolvePaymentMethodLabel(id, masters, fallbackName)`):
   - Prefer current master name by ID.
   - Fall back to snapshotted name / raw ID if master missing.
2. Apply helpers in:
   - Godown list & detail (payment method, destination, product).
   - Inventory pending (product); keep location live resolve.
   - Any finance screens that still show txn-level destination names from snapshots.
3. Settings UX:
   - Replace unsafe hard-delete for in-use masters with blocked action + explanation.
   - Align deactivate buttons with backend rejection messages.
   - Consider deactivate instead of delete for locations/products.
4. Do **not** change sale amount entry behaviour; do not auto-apply price rules unless separately approved.

### 7.2 Backend

1. Extend `manageAgencyConfig`:
   - Before removing/deactivating payment methods: query `transactions` by `paymentMethodId`.
   - Before deactivating destinations: same checks as delete (ledger / tx / balance).
   - Before `deleteLocation` / deactivate: query transactions, inventoryLedger, inventoryBalances, inventoryOpenings, obligations.
   - Before `deleteProduct` / deactivate: query transactions, inventory*, obligations, priceRules.
2. Keep posting snapshots of names for audit/offline fallback (**optional but recommended**); stop treating them as the only display source.
3. Do **not** rewrite historical transaction documents on rename.
4. Do **not** change inventory/finance accounting math.

### 7.3 Data migration

| Approach | Recommendation |
|----------|----------------|
| Bulk rewrite snapshotted names on all txs | **Not required** if UI resolves live by ID |
| Backfill missing IDs from names | **Do not guess** when multiple methods share similar names; report orphans |
| Execute migration | **Only after explicit approval** |

Legacy compatibility:

- Records with ID + old name → live resolve works.
- Records with name but missing/invalid ID → show snapshot; flag for manual review.
- Ambiguous name-only legacy → leave unchanged; do not auto-map.

### 7.4 Backward compatibility risks

- UI that assumed snapshot immutability for **names** will start showing updated labels (intended).
- Printed historical receipts that must show “name as of sale day” would need an explicit product decision (default for this project: show **current** master name per Stage 2 requirements).
- Stricter deactivate rules may block operators who currently deactivate in-use methods — expected; communicate in UI.

### 7.5 Tests required (per field)

For each Settings entity (methods, destinations, locations, products, price rules):

1. Add setting → use in new transaction → OK.  
2. Rename → existing record display updates; amounts/dates/IDs unchanged.  
3. Edit non-name properties → approved impact only.  
4. Delete in-use → rejected (Function test).  
5. Deactivate in-use → rejected (Function test).  
6. Unused delete/deactivate → allowed only where approved.  
7. Legacy snapshot-only / missing master → fallback display.  
8. Duplicate uniqueness still holds.  
9. Backend enforcement without UI.  
10. Stock, payments, dues, refill dates unchanged after rename.

Also: typecheck, unit tests, frontend build.

### 7.6 Implementation order

1. Shared resolve helpers + godown payment/destination/product display (fixes reported bug).  
2. Inventory pending product display consistency.  
3. Backend in-use guards (methods, destinations deactivate, locations, products).  
4. Settings UI error messaging.  
5. Tests for guards + display resolution.  
6. Optional: document orphan ID report; **no migration** until approved.  
7. Future modules (expenses, salary): adopt C pattern from day one.

**Dependencies:** Agency settings query available wherever godown/inventory detail renders; avoid N+1 by loading `settings/agency` + products/locations maps once per page (patterns already exist in inventory).

---

## 8. Out of scope for Stage 2 (unless re-approved)

- Automatic price-rule application on godown sales.  
- Expense / salary / agent commission modules.  
- Making `inventoryStates` Settings-editable.  
- Rewriting customerSnapshot to always-live for registered customers.  
- Production deploy or production data changes.  
- Bulk Firestore name migrations.

---

## 9. Manual verification checklist (after Stage 2)

1. Create godown sale with payment method + destination + product.  
2. Rename all three in Settings.  
3. Reopen sale list + detail → **new** names; same date, amounts, IDs.  
4. Confirm inventory stock numbers unchanged.  
5. Attempt deactivate/delete of those in-use settings → blocked with clear message.  
6. Rename location/product → inventory dashboard & godown agree on names.  
7. Open pre-existing historical sale → displays current names when IDs resolve.  
8. Financial Opening destination labels still match Settings.

---

## 10. Stage 1 decision requests for the reviewer

Please confirm before implementation:

1. **Display policy:** Historical godown screens should show the **current** Settings name (not the name-as-of-sale), with snapshot fallback only when the master ID is missing.  
2. **Deactivate policy:** Confirm that **in-use deactivation is forbidden** (stricter than today’s UI).  
3. **Locations/products:** Prefer **deactivate** over hard delete once guards exist?  
4. **Customer names on godown:** Leave as snapshot-only for this phase?  
5. **Migration:** Confirm **no** automatic rewrite of historical documents in Stage 2.

---

## 11. File index (audit sources)

| Area | Path |
|------|------|
| Settings UI | `src/modules/settings/SettingsPage.tsx` |
| Settings API client | `src/services/api/agency-settings.ts` |
| Callable | `functions/src/settings/manage-agency-config.ts` |
| Models | `shared/models/agency-config.ts`, `transaction.ts`, `inventory.ts`, `finance.ts` |
| Schemas | `shared/schemas/agency-settings.ts` |
| Uniqueness | `shared/rules/settings-uniqueness.ts` |
| Godown post | `functions/src/godown/post-godown.ts` |
| Inventory post | `functions/src/inventory/post-inventory.ts` |
| Finance opening | `functions/src/finance/post-opening.ts`, `src/modules/finance/FinancialOpeningPage.tsx` |
| Godown UI | `src/modules/godown/GodownPage.tsx`, `GodownDetailPage.tsx`, `GodownSaleForm.tsx` |
| Inventory UI | `src/modules/inventory/*` |
| Schema docs | `docs/DATABASE_SCHEMA.md`, `docs/BUSINESS_RULES.md`, `docs/PHASE_5_MASTER_ARCHITECTURE.md` |

---

**End of Stage 1.** No code or data changes were made. Awaiting review and explicit approval to begin Stage 2.
