# Phase 5 — Financial Management
## Master Architecture and Implementation Specification

**Document:** `docs/PHASE_5_MASTER_ARCHITECTURE.md`  
**Project:** Hisab — Miragpur Indane Gas Agency  
**Status:** Authoritative architecture specification  
**Scope:** Phase 5 only  
**Database:** Firebase Firestore  
**Functions region:** `asia-south1`  
**Business timezone:** `Asia/Kolkata`  
**Currency:** INR  
**Money representation:** Integer paise  
**Phase 4 inventory cutover:** `2026-11-01`

---

# PART A — MANDATORY INSTRUCTIONS TO CURSOR

## 1. Authority of this document

This document is the single authoritative specification for Phase 5.

Cursor must follow it when designing, implementing, testing, and reviewing Phase 5.

If existing documentation, comments, or earlier architecture proposals conflict with this document, follow this document for Phase 5. Do not silently change the existing Phase 1–4 behavior.

This document preserves the business decisions already approved by the agency owner. Cursor must not invent alternative accounting rules or simplify away required workflows.

## 2. First task: inspect the repository

Before writing or modifying code:

1. Inspect the complete repository structure.
2. Read the existing application architecture and relevant documentation.
3. Inspect `docs/DATABASE_SCHEMA.md`.
4. Inspect existing Firestore collections, TypeScript models, Firebase Functions, Security Rules, indexes, and frontend services.
5. Inspect existing Phase 1–4 implementations.
6. Identify existing collection names, document IDs, receiving-account IDs, permission keys, transaction structures, and inventory posting mechanisms.
7. Compare the existing implementation against this document.
8. Produce a concise implementation assessment identifying:
   - Existing reusable components.
   - Missing components.
   - Existing components requiring compatible extensions.
   - Potential conflicts with Phase 1–4.
   - Required Firestore indexes and Security Rule changes.
   - Any genuine ambiguity that prevents safe implementation.

Do not recreate existing functionality merely because it is described here.

Do not change the database architecture from Firestore to Realtime Database. Realtime Database is not the application database.

## 3. Implementation must be phased

Implement only one approved sub-phase at a time, in this order:

1. Phase 5.0 — Financial foundation and opening.
2. Phase 5F — Transfers, owner movements, portal accounting, balances and approvals.
3. Phase 5A — Customer payments, dues and customer credit.
4. Phase 5B — Expenses.
5. Phase 5C-a — Accessory inventory foundation.
6. Phase 5C-b — New Connection.
7. Phase 5D — Accessories Sale.
8. Phase 5E — Staff salary and advances.
9. Phase 5G — Financial reports and cash closing.

**Do not implement the entire Phase 5 in one operation.**

For each sub-phase:

1. Inspect the relevant existing implementation.
2. State the exact scope.
3. Implement only that scope.
4. Add or update automated tests.
5. Run the relevant tests, type checks, linting and build.
6. Report the files changed and database changes proposed.
7. Explain which tests passed and failed.
8. Provide a separate manual testing checklist.
9. Stop and wait for explicit user approval.

Do not begin the next sub-phase until the user approves the previous one.

## 4. Production safety

Unless the user explicitly approves:

- Do not deploy production Cloud Functions.
- Do not deploy production Firestore Security Rules.
- Do not deploy production indexes.
- Do not run production migrations.
- Do not modify or delete production data.
- Do not change existing admin accounts or authentication.
- Do not reset existing Firebase collections.
- Do not modify Phase 1–4 historical transactions.
- Do not use production data to test destructive operations.

Use Firebase Emulator Suite wherever possible.

A successful local test is not permission to deploy.

## 5. Recommended Cursor configuration

- Architecture review and accounting/security reasoning: **GPT-5.5 — Agent mode — Auto OFF**.
- Multi-file implementation: **Grok 4.7 — Agent mode — Auto OFF**.
- Small UI corrections and isolated bug fixes: **Composer 2.5 — Agent mode — Auto OFF**.

Use the strongest appropriate model for financial calculations, concurrency, Firestore transactions, and security-sensitive changes.

---

# PART B — EXISTING APPLICATION AND NON-NEGOTIABLE CONSTRAINTS

## 6. Existing technology

The existing application uses:

- Vite.
- React.
- TypeScript.
- Firebase Authentication.
- Cloud Functions.
- Cloud Firestore.
- Firestore Security Rules.
- Firebase Emulator Suite.

Firebase project ID:

`hisab-9d3e4`

Cloud Functions region:

`asia-south1`

Business timezone:

`Asia/Kolkata`

All money must be stored as integer paise.

For example:

- ₹1 = 100 paise.
- ₹190 = 19000 paise.
- ₹450 = 45000 paise.

Never use floating-point arithmetic for financial calculations.

## 7. Existing completed phases

Phase 1–4 are completed and manually tested.

### Phase 1
- Authentication.
- User management.
- Staff permissions.
- Agency settings.
- Account management.

### Phase 2
- Customer Master.
- Customer Excel import.

### Phase 3
- Godown Register.
- Daily cylinder sales.
- Empty-cylinder obligations.
- Subsequent empty-cylinder returns.
- Customer booking information.

### Phase 4
- Filled and empty cylinder inventory.
- Damaged cylinder inventory.
- Godown inventory.
- Vehicle inventory.
- Agent/CSC inventory.
- Stock transfers.
- Distributor receipts and returns.
- Inventory ledger.
- Inventory balances.
- Stock opening and reconciliation.

Do not replace or duplicate these modules.

## 8. Important existing business behavior

The following behavior must remain unchanged:

1. Godown sales created by staff are posted immediately.
2. Empty-cylinder returns are posted immediately.
3. Godown sales and empty-cylinder returns do not require admin approval.
4. Other staff-created financial transactions require admin approval before their financial effects are posted.
5. Inventory approval behavior from Phase 4 remains unchanged.
6. Admin deletion of existing daily records is restricted to the current business date, subject to existing reversal rules.
7. Financial reversal must not bypass the new Phase 5 restrictions.
8. Photos are optional, not mandatory.
9. Existing customer records and cylinder obligations must remain intact.
10. Phase 5 must not overwrite or reinterpret existing `empty_cylinder` obligations.

## 9. Existing receiving destinations

Reuse the existing receiving-account records and IDs.

Existing destinations include:

- Anchal Cash.
- Anchal UPI.
- D.P. ji Cash.
- D.P. ji UPI.
- Nikhil Cash.
- Nikhil UPI.
- Maharashtra Bank.
- Indian Oil Portal.

Inspect the actual repository and Firebase data to identify the exact IDs.

Do not create duplicate destination accounts.

Add ownership classification to the existing accounts:

| Destination | Ownership |
|---|---|
| Anchal Cash / UPI | agency |
| Maharashtra Bank | agency |
| D.P. ji Cash / UPI | third_party_held |
| Nikhil Cash / UPI | third_party_held |
| Indian Oil Portal | portal |

D.P. ji and Nikhil destinations contain agency money held by those individuals. The application does not track their personal money.

IndianOil Portal is a prepaid balance, not an ordinary bank account.

## 10. Existing financial infrastructure

The following may already exist partially:

- `financialLedger`
- `financialBalances`
- `obligations`
- `auditLogs`
- Idempotency records
- Permission keys such as `payments.create`, `expenses.create`, and `reports.viewAssigned`.

Inspect actual implementation before extending them.

A documented collection is not proof that its writers, readers, indexes, and security behavior are implemented.

The application uses Firestore, not Realtime Database, for its business records.

---

# PART C — ACCOUNTING PRINCIPLES

## 11. Core financial principles

1. All money is integer paise.
2. All business dates use `Asia/Kolkata`.
3. Financial records are written by Cloud Functions only.
4. Financial ledger entries are immutable.
5. Financial balances are projections of ledger activity and verified opening balances.
6. Every financial operation must be idempotent.
7. Every financial posting must have an audit record.
8. Approval must be separate from transaction creation.
9. Pending transactions must not affect balances, obligations, revenue, expenses, or stock.
10. Every financial posting must be atomic.
11. A retry must never duplicate a financial effect.
12. A reversal must create compensating entries rather than delete historical financial records.
13. Empty-cylinder obligations remain separate from money obligations.
14. Opening balances must be verified rather than guessed.
15. No historical financial records may be reconstructed without explicit verification.

## 12. Destination cashbook, not a general ledger

Phase 5 implements a destination-wise cashbook and financial projections.

It does not implement a complete double-entry general ledger.

Each receiving destination has its own immutable ledger.

A destination balance must reconcile to:

`Verified opening balance + sum of visible ledger entries`

A transfer creates two ledger entries:

- Debit source destination.
- Credit destination destination.

A transaction may also change an obligation, liability, inventory balance, or expense projection.

Do not introduce an unrelated general-ledger architecture.

## 13. Profit definition

Net operating profit is:

`Cylinder sales revenue + New Connection revenue + Accessories Sale revenue - Accessory COGS - Operating expenses - Salary expense`

Cylinder COGS is not posted in Phase 5.

Accessory COGS is posted when costed accessory stock is issued.

The following are not revenue or operating expenses:

- Customer payments against existing dues.
- Customer credit creation or application.
- Fund transfers.
- Portal funding.
- Portal settlement.
- Owner contribution.
- Owner loan received.
- Owner withdrawal.
- Owner loan repayment.
- Accessory stock purchase payments.
- Opening balances.
- Opening receivables.
- Salary advances.
- Salary payable payments.

Do not count the same transaction twice.

## 14. Commission and reference gross margin

The application must keep these concepts separate:

1. Actual agency commission, if configured.
2. Reference gross margin, if the required selling and buying values are configured.
3. Net operating profit.

Do not invent a commission amount, commission percentage, buying price, or cylinder cost.

The agency's historical business description of commission as the difference between selling price and buying price must not be treated as sufficient information to create a new calculation rule without a verified configuration.

Admin-configured rules may support:

- Fixed amount per cylinder.
- Basis points of a configured basis.
- Effective-from and effective-to dates.

The report must display `not_configured` when no valid rule exists.

Commission and reference gross margin are informational reports only. They do not create financial ledger entries and do not alter net operating profit.

Agent commission statements are outside Phase 5 and belong to Phase 6.

---

# PART D — FINANCIAL OPENING AND CUTOVER

## 15. Separate inventory cutover and financial opening

Phase 4 inventory cutover:

`2026-11-01`

This date is not automatically the financial opening date.

Financial opening begins when the agency receives its next filled-cylinder consignment from the plant.

While recording that anchor consignment, Admin manually selects the actual financial opening date.

The anchor consignment date should match the financial opening date.

If they differ, require an audited reason.

Do not automatically activate financial accounting merely because a distributor receipt is recorded.

## 16. Financial classification

Let:

- `D` = verified financial opening date.
- `today` = current date in `Asia/Kolkata`.

Classify each Godown sale as follows:

| Condition | Classification |
|---|---|
| `businessDate <= D` | pre_cutover |
| `D < businessDate <= today` | post_cutover bridge |
| `businessDate > today` | future_dated |
| Reversed transaction | Excluded from active financial effects |

A future-dated sale must not be financially released until its business date is reached.

Admin may release it early only with a mandatory reason.

Releasing a sale must never repost its cylinder inventory or empty-cylinder effects.

## 17. Opening lifecycle

Opening session states:

- `draft`
- `preparing`
- `ready_to_publish`
- `published`
- `abandoned`

Opening gate states:

- `not_opened`
- `sealing`
- `published`

Publication pointer:

`financePublication/current.publishedSessionId`

Initially, it is null.

After successful publication, it contains the published opening session ID.

Use an integer fence starting at 1.

Every worker must verify the session state and fence before writing.

Abandoning a session increments the fence.

If the opening plan becomes invalid because of new or amended sales, increment the generation/fence and rebuild the plan.

## 18. Opening gate behavior

### `not_opened`

- Godown operational sales may continue.
- No Phase 5 financial effects are posted.
- Other financial operations fail with a clear precondition error.
- No financial opening publication is visible.

### `sealing`

- Godown operational sales continue.
- New sales are registered as opening candidates.
- Each candidate or relevant amendment increments the mutation epoch.
- Other financial operations remain blocked.
- A plan must be rebuilt if the mutation epoch changes.

### `published`

- Post-cutover Godown sales post their financial effects atomically.
- Future-dated sales remain deferred.
- Empty-cylinder returns never create financial ledger entries.

## 19. Opening plan and generation isolation

Opening preparation must be deterministic, resumable, and bounded.

Use:

- Deterministic sorted sale IDs.
- Bounded chunk size: 80 sales maximum per chunk.
- SHA-256 hashes for plan and chunk verification.
- Destination count maximum: 40.
- Bounded Firestore transactions.
- A fixed `classificationAsOfDate` for each plan generation.

Every preparation generation must have a unique generation ID.

All staged rows, chunks, completion documents, and rollups must identify the exact generation.

The publication pointer must identify the exact verified session and generation.

A stale or abandoned generation must never become visible to ordinary clients.

A generation mismatch must prevent readiness and publication.

Never reuse staged rows from an older generation without explicit hash verification and generation validation.

## 20. Opening preparation

The opening workflow must:

1. Begin the financial opening seal.
2. Create the opening session.
3. Record the anchor consignment and financial opening date.
4. Capture the current mutation epoch.
5. Create the deterministic opening plan.
6. Divide the plan into bounded chunks.
7. Prepare opening records.
8. Review every pre-cutover sale's receivable.
9. Verify every required collection snapshot.
10. Build destination opening balances and rollups.
11. Verify all counts and hashes.
12. Mark the session ready.
13. Publish atomically.

No partial opening may be visible to ordinary users.

## 21. Opening balance sheet

Admin must verify the opening balance for every receiving destination.

The opening balance sheet:

- Uses existing destination IDs.
- Contains no duplicate destinations.
- Includes no more than 40 destinations.
- Excludes bridge sale collections.
- Requires an explicit verified value for every destination.
- Must not silently assume zero for an unverified destination.

Owner loan liability must also be explicitly verified at opening or explicitly confirmed as zero.

Opening accessory stock is handled in Phase 5C-a and must similarly require verified quantities or an explicit zero.

## 22. Opening ledger entries

Every verified destination opening balance must have a matching immutable ledger entry:

`entryClass = destination_opening`

This is mandatory.

Do not create a financial balance that cannot be reconciled to its visible cashbook.

After publication:

`destination balance = destination_opening + visible operational ledger entries + visible bridge ledger entries`

Opening balance ledger entries must be staged under the opening session and generation.

They become visible only through the publication pointer.

## 23. Opening receivable review

Every pre-cutover posted Godown sale must receive an explicit Admin decision.

The decision is one of:

- `include`
- `exclude`

Admin must review every sale, including sales with zero due.

The review must show:

- Sale ID.
- Customer ID.
- Customer name.
- Business date.
- Historical sale amount.
- Historical amount received.
- Historical due.
- Proposed receivable.
- Approved receivable amount.
- Existing review status.
- Duplicate warning, if applicable.

Admin may approve a receivable amount different from the historical due only with a mandatory reason.

Excluded sales require a reason.

Duplicate detection may flag sales with the same customer, date, and due amount, but must never automatically merge or delete them.

A money obligation must be created only from the approved receivable amount.

The approved amount, not the original historical due, is authoritative.

### Ordering requirement

Do not create final opening receivable obligations before their corresponding review is completed.

Use one of these safe approaches:

1. Complete all reviews first, then run a separate bounded materialization pass; or
2. Stage review-specific candidate records and materialize obligations only after a verified approval decision.

`markOpeningReady` must verify that every expected pre-cutover sale has a final review and that materialized obligations exactly match approved amounts.

## 24. Opening collection snapshots

For each pre-cutover sale, capture the verified historical collection snapshot.

Default values:

- Snapshot amount = original `receivedPaise`.
- Snapshot destination = original `receivingAccountId`.

The following statuses apply:

| Status | Meaning |
|---|---|
| `captured` | Non-zero collection and destination verified |
| `zero_collection` | No historical collection |
| `admin_corrected` | Admin verified a corrected amount or destination |
| `incomplete` | Required collection information is missing |
| `not_applicable` | Post-cutover or future-dated sale |

A variance requires:

- Explicit variance class.
- Corrected amount and/or destination.
- Mandatory reason.
- Admin identity.
- Audit record.

A non-zero collection without a verified destination is incomplete.

An incomplete snapshot blocks readiness and any reversal requiring that snapshot.

A captured or corrected snapshot must debit its destination exactly once if the historical sale is reversed after publication.

## 25. Opening publication

`publishFinancialOpening` must atomically:

- Verify session state.
- Verify fence and generation.
- Verify mutation epoch.
- Verify all chunk completion records.
- Verify all chunk hashes.
- Verify all cohort counts.
- Verify all pre-cutover receivable reviews.
- Verify all required snapshots.
- Verify all opening balance sheet entries.
- Verify destination rollups.
- Verify owner loan opening liability.
- Verify anchor date.
- Write opening destination balances.
- Write matching `destination_opening` ledger entries if not already staged.
- Set `financePublication/current.publishedSessionId`.
- Change the gate to `published`.
- Mark the session `published`.

The publication transaction must be bounded.

Maximum destination count: 40.

Do not update every sale individually during publication.

Publication must be one atomic visibility transition.

If publication fails, the pointer must remain unchanged.

## 26. Opening abandonment

An opening session may be abandoned only before publication.

Abandonment must:

- Verify the pointer has not published the session.
- Increment the fence.
- Mark the session abandoned.
- Return the gate to `not_opened`.
- Make all staged records permanently invisible to ordinary clients.

Staged records may remain for audit and cleanup.

Do not delete immutable audit history.

---

# PART E — FIRESTORE DATA MODEL AND SECURITY

## 27. Core collections

Inspect the repository and reuse existing collection names wherever possible.

The architecture requires the following logical collections or equivalent existing structures:

### Existing and extended collections

- `users`
- `customers`
- `transactions`
- `obligations`
- `auditLogs`
- Existing inventory collections.
- Existing inventory ledger and balances.
- Existing agency settings.

### Financial collections

- `financialLedger`
- `financialBalances`
- `paymentAllocations`
- `creditApplications`
- `reconciliationEvents`
- `saleCutoverRecords`

### Opening collections

- `financePublication`
- `financialOpeningGate`
- `openingSessions`
- Opening plans.
- Opening chunks.
- Opening chunk completions.
- Opening reviews.
- Opening snapshots.
- Opening balance sheets.
- Opening rollups.
- Opening candidates.
- Private opening working papers.

### Accessory collections

- Accessory balances.
- Accessory lots.
- Accessory ledger.
- Purchase payables.

### Salary collections

- Salary profiles.
- Salary periods.
- Salary advances.
- Salary settlement records.

Do not introduce duplicate collections if equivalent structures already exist.

## 28. Financial record scope

Live financial records must use:

- `recordScope: operational`
- `recordScope: opening`

Opening records must include:

- `openingSessionId`
- `openingGenerationId`

Operational records must not be mistaken for opening records.

Opening records must be visible only when both session and generation match the published pointer.

Private working papers must remain client-denied.

## 29. Financial ledger

`financialLedger` is immutable.

Each entry should contain, as appropriate:

- Entry ID.
- Transaction ID.
- Account ID.
- Amount in paise.
- Direction or signed amount.
- Entry class.
- Business date.
- Server timestamp.
- Actor ID.
- Related customer ID.
- Related obligation ID.
- Related transaction ID.
- Idempotency key.
- Record scope.
- Opening session and generation when applicable.
- Reversal reference.
- Audit reference.

Use explicit entry classes. At minimum:

- `destination_opening`
- `sale_collection`
- `customer_payment`
- `customer_credit_refund`
- `expense`
- `fund_transfer_out`
- `fund_transfer_in`
- `owner_contribution`
- `owner_loan_received`
- `owner_withdrawal`
- `owner_loan_repayment`
- `portal_funding_out`
- `portal_funding_in`
- `portal_settlement`
- `stock_purchase_payment`
- `new_connection_collection`
- `accessories_sale_collection`
- `salary_advance_included`
- `salary_settlement_payment`
- `salary_payable_payment`
- `godown_sale_reversal`
- Other explicitly documented compensating entries.

Do not use generic undocumented entry classes.

## 30. Financial balances

`financialBalances` is a projection, not the source of truth.

Each destination balance must include:

- Account ID.
- Balance in paise.
- Published session ID.
- Reconciliation status.
- Last updated timestamp.
- Any required reconciliation metadata.

The balance must reconcile to the visible ledger.

A newly created destination after publication must be created through an authorized Function with:

- A zero opening balance.
- A pointer-matched balance.
- A valid destination count check.
- A matching configuration record.

The 40-destination limit remains in force unless a later approved architecture change explicitly revises it.

## 31. Obligations

The existing `obligations` collection contains empty-cylinder obligations.

Preserve them.

Extend the model with distinct obligation types:

- `empty_cylinder`
- `money`
- `purchase_payable`
- `customer_credit`
- `salary_payable`

Do not make empty-cylinder records behave like money obligations.

Money obligations should contain:

- Customer or supplier reference.
- Original amount.
- Settled amount.
- Outstanding amount.
- Status.
- Business date.
- Related transaction.
- Record scope.
- Opening session and generation when applicable.

Invariant:

`outstandingPaise = originalPaise - settledPaise`

A settled obligation cannot be settled again.

Salary payable must not appear in customer dues.

## 32. Payment allocations and credit applications

Payment allocations and credit applications are immutable.

They must identify the target obligation and amount.

If Security Rules require published-opening filtering, include the necessary `recordScope`, `openingSessionId`, and `openingGenerationId` fields.

A credit application changes obligations but does not move cash.

A refund is a separate Admin-only transaction.

## 33. Security Rules

All financial client writes must be denied.

Cloud Functions are the only financial writers.

Remember that Firebase Admin SDK bypasses Firestore Security Rules. Every Function must independently enforce:

- Authentication.
- Permission.
- Admin-only restrictions.
- Ownership.
- Transaction status.
- Business-date restrictions.
- Opening gate state.
- Idempotency.
- Data validation.
- Amount limits and available balances.

Firestore Rules are not filters.

Every client query must be shaped so that every possible result is allowed by the Rules.

Explicitly handle:

1. Legacy `empty_cylinder` obligations.
2. Operational money obligations.
3. Published opening money obligations.
4. Purchase payables.
5. Customer credit.
6. Salary payable.

Do not accidentally block existing empty-cylinder functionality when adding money-obligation restrictions.

Do not allow an unconstrained query to expose unpublished opening records.

Admin working screens must use authorized Functions rather than exposing private preparation collections.

## 34. Client listener behavior

Operational financial listeners may start immediately after publication.

Opening listeners may start only after the client obtains a valid published session pointer.

If a listener receives permission denied:

1. Drop its stale snapshot.
2. Re-read the publication pointer.
3. Reattach only when the pointer contains a valid published session.
4. Never display stale unpublished opening data.

---

# PART F — GODOWN SALES, CLASSIFICATION AND REVERSALS

## 35. Existing Godown sale behavior

Keep the existing Godown sale form and operational posting behavior.

Existing fields include:

- Customer.
- Cylinder quantity.
- Sale amount.
- Amount received.
- Amount due.
- Payment method.
- Receiving destination.
- Business date.
- Optional booking information.

The total must reconcile:

`Total sale amount = Amount received + Amount due`

The existing one-receiving-destination-per-sale limitation remains.

Do not create a second receiving destination for one Godown sale.

Godown sale staff entries continue to post immediately.

## 36. Financial effect of Godown sales

### Before financial opening

Godown sales affect operational cylinder inventory and empty-cylinder obligations only.

They do not create Phase 5 ledger entries or money obligations until opening preparation.

### During sealing

Sales continue operationally.

They register as candidates and increment the mutation epoch.

### After publication

For post-cutover sales:

- Create a `sale_collection` entry for received money.
- Create a money obligation for due money.
- Recognize sale revenue once.
- Update financial projections atomically.

For future-dated sales:

- Mark as deferred.
- Do not create a current financial ledger entry.
- Do not create a released financial receivable.
- Release later through an authorized Function.

## 37. Backdated Godown sales after publication

A sale created after publication with a business date on or before the financial opening date must not silently alter the published historical opening snapshot.

Do not:

- Credit the current destination cashbook using an unverified historical receipt.
- Treat historical receipt as current cash.
- Rewrite published opening balances.
- Create historical revenue automatically.

Use a controlled Admin resolution path.

The system must:

1. Classify the sale as a historical exception.
2. Preserve the original operational transaction.
3. Mark its financial status as requiring Admin review.
4. Allow Admin to create an audited opening receivable if a verified amount remains due.
5. Require explicit verification of historical collection information.
6. Keep unverified historical collections out of current destination balances.
7. Record the resolution and reason in audit logs.

If no safe financial resolution exists, block financial posting and show a clear reconciliation warning.

## 38. Godown sale reversal

Only Admin may reverse a Godown sale financially.

The sale business date must be today in `Asia/Kolkata`.

A `saleCutoverRecord` must exist.

If it does not exist, do not perform a financial or operational reversal through the new reversal path.

Block reversal if:

- Any payment allocation exists.
- Any credit application exists.
- Settled amount is greater than zero.

The absence of an obligation alone does not prove a sale was unpaid.

### Pre-cutover reversal

- Reverse the verified opening collection snapshot once.
- Reverse the approved opening receivable once.
- Do not create Phase 5 revenue reversal because pre-cutover revenue was not recognized in Phase 5.
- Restore inventory and empty-cylinder effects through the existing operational reversal mechanism.
- Mark the finance effect reversed.

### Zero-collection pre-cutover reversal

- No destination debit.
- Reverse the approved receivable if one exists.
- Restore operational inventory and empty-cylinder effects.

### Post-cutover reversal

- Debit the original collection destination once.
- Reverse the outstanding money obligation.
- Exclude the sale from active revenue.
- Restore operational inventory and empty-cylinder effects.

### Incomplete snapshot

Block reversal.

Admin must first resolve the missing snapshot through the audited correction workflow.

### Negative destination balance

A negative destination balance is permitted only for a valid authorized Godown reversal unwind.

It must create a reconciliation flag.

Only Admin may clear that flag, with a mandatory reason and audit event.

Clearing the flag must not change the balance.

### Idempotency

Use deterministic reversal transaction and ledger IDs.

Repeated reversal requests must return the original result and must never double-debit.

---

# PART G — FUTURE-DATED TRANSACTIONS

## 39. Future release

Use `releaseFutureDatedTransaction`.

Release is allowed only when:

`businessDate <= today in Asia/Kolkata`

Admin may release earlier only with a mandatory `earlyReleaseReason`.

Release must:

- Create the financial collection entry.
- Create the money obligation if due.
- Update the financial effect status.
- Be idempotent.
- Avoid duplicate revenue.
- Avoid reposting inventory.
- Avoid recreating empty-cylinder obligations.

---

# PART H — CUSTOMER PAYMENTS AND CREDIT

## 40. Receive customer payment

Payment creation is available only after financial opening is published.

The form must support:

- Registered customer.
- Amount received.
- Payment method.
- Receiving destination.
- Business date.
- Reference or notes where appropriate.
- Allocation against one or more eligible customer dues.
- Remainder as customer credit for registered customers.

A payment may settle multiple obligations.

Total payment must equal:

`Sum of allocations + newly created customer credit`

The destination receives the full payment amount.

## 41. Pending payment behavior

A staff-created payment requiring approval must remain pending.

A pending payment must not:

- Create final payment allocations.
- Settle customer dues.
- Create a customer credit obligation.
- Credit the destination balance.
- Create a posted financial ledger entry.

Approval must atomically create all required financial effects.

Rejection must create none.

The pending request may store proposed allocations, but they must be revalidated at approval time because outstanding balances may have changed.

## 42. Overpayment

For registered customers:

- Apply the amount needed to settle selected obligations.
- Create the remaining amount as customer credit.
- Keep the full received amount in the destination ledger.

For walk-in customers:

- Excess payment is rejected.
- Do not create anonymous customer credit.

## 43. Apply customer credit

Credit application:

- Requires a registered customer.
- Uses an existing customer credit balance.
- Applies credit to one or more eligible money obligations.
- Decreases the credit obligation.
- Decreases the target obligation.
- Creates an immutable credit application record.
- Does not move cash.
- Does not create revenue.
- Does not create a destination ledger entry.

The application must be atomic.

## 44. Refund customer credit

Refund is Admin-only.

A refund:

- Debits the selected destination.
- Reduces the outstanding customer credit obligation.
- Creates an immutable ledger entry.
- Is not an operating expense.
- Requires a reason.
- Must be idempotent.

## 45. Customer dues and receipts

Provide a customer dues view showing:

- Original amount.
- Amount settled.
- Outstanding amount.
- Business date.
- Related sale.
- Payment history.
- Credit applications.
- Current status.

Provide shareable receipts for customer payments and collections.

Receipts must not expose unrelated customer information.

---

# PART I — TRANSFERS, OWNER MOVEMENTS AND PORTAL

## 46. Fund transfers

A fund transfer moves agency money between receiving destinations.

It creates:

- Source debit.
- Destination credit.

It does not create revenue or expense.

Both entries must be atomic.

A transfer requires:

- Source destination.
- Destination destination.
- Amount.
- Business date.
- Optional note.
- Actor.
- Idempotency key.

A transfer to the same destination must be rejected.

## 47. Owner personal money entering the agency

For each transaction, Admin chooses one of two classifications:

### Owner contribution

- Increases the destination balance.
- Does not create owner loan liability.
- Does not create revenue.

### Owner loan

- Increases the destination balance.
- Increases owner loan liability.
- Does not create revenue.

Do not create a personal owner destination account.

Track owner loan liability separately.

## 48. Agency money going to owner

For each transaction, Admin chooses:

### Owner withdrawal

- Debits the destination.
- Does not reduce owner loan liability.

### Owner loan repayment

- Debits the destination.
- Reduces owner loan liability.
- Cannot exceed the outstanding owner loan.

Both require a reason and audit record.

## 49. IndianOil Portal

IndianOil Portal is a prepaid balance.

### Funding portal

- Debit the source bank/cash destination.
- Credit the portal destination.
- Do not record an expense.

### Portal settlement

- Debit the portal balance.
- Record the settlement as a separate non-expense transaction.
- Do not create accessory COGS.
- Do not count the settlement as operating expense.

Portal funding and settlement must reconcile to the portal destination balance.

---

# PART J — EXPENSES

## 50. Expense management

Expenses are available only after financial opening.

Expense fields:

- Category.
- Amount.
- Payment method.
- Paying destination.
- Business date.
- Description.
- Optional receipt/photo.
- Actor.

Photo is optional.

Expenses created by staff require approval.

Pending expenses do not debit destination balances or affect profit.

Approval atomically:

- Debits the destination.
- Creates the expense ledger entry.
- Recognizes the expense.
- Writes audit history.

Rejection creates no financial effect.

## 51. Expense categories

Add a Settings UI for managing `expenseCategories[]`.

Use the existing setting structure if already implemented.

Categories must be configurable by Admin.

Do not hardcode the only available categories in the application.

Do not delete categories that are already referenced by historical transactions; use an inactive status where appropriate.

---

# PART K — ACCESSORY INVENTORY

## 52. Accessory inventory scope

Accessory inventory is separate from Phase 4 cylinder inventory.

It is one agency-wide stock balance.

There are no location-wise accessory balances in Phase 5.

Accessories include items such as:

- Gas stove.
- Lighter.
- Gas pipe.
- Regulator.
- Other Admin-configured products.

Do not create supplier master or a full purchase-management module.

## 53. Add Stock

Admin can add accessory stock using a simple Add Stock workflow.

Fields:

- Accessory.
- Quantity.
- Optional total purchase cost.
- Payment status.
- Paying destination when paid.
- Supplier/reference note, optional.
- Business date.

Cost handling:

### Known cost, paid

- Increase accessory quantity.
- Increase cost basis.
- Debit destination through `stock_purchase_payment`.
- Do not recognize immediate expense or COGS.

### Known cost, unpaid

- Increase accessory quantity.
- Increase cost basis.
- Create a purchase payable.
- Do not debit a destination until payable settlement.

### Unknown cost

- Increase accessory quantity.
- Increase uncosted quantity.
- Do not create cost basis.
- Do not create a purchase payable.

A paid or unpaid purchase cannot have a known payable/payment amount without a known cost.

## 54. Accessory lots and costing

Each stock receipt creates a lot.

A lot tracks:

- Received quantity.
- Remaining quantity.
- Costed quantity.
- Uncosted quantity remaining.
- Cost basis in paise.
- Cost status.
- Purchase payable reference, if any.

Accessory costing must be deterministic.

Use a documented lot-consumption policy and implement it consistently. Prefer oldest eligible lot first unless the repository already contains an approved compatible policy.

Costed units must be consumed before uncosted units.

For a costed issue of `q` units from a costed quantity `n` with remaining basis `b`:

If `q < n`:

`COGS = floor(b * q / n)`

If `q == n`:

`COGS = b`

The residual paise remain in the lot until its final costed unit is issued.

This prevents rounding loss.

## 55. Assign accessory cost later

Admin may assign cost to previously uncosted remaining stock.

The assignment must:

- Identify the lot.
- Identify the remaining uncosted quantity.
- Supply a verified total cost.
- Reduce uncosted quantity.
- Increase cost basis.
- Preserve historical sale records.

The assignment cannot exceed the lot's `uncostedQtyRemaining`.

Previously sold uncosted units remain cost-incomplete permanently.

Never retrospectively assign COGS to already-sold units.

## 56. Accessory stock correction

Admin may increase or decrease accessory stock.

A correction requires a mandatory reason.

Increase:

- Adds uncosted stock by default.
- Admin may supply verified cost when appropriate.

Decrease:

- Consumes costed stock first.
- Reduces cost basis proportionately.
- Then consumes uncosted stock.
- Must not produce negative stock.

Do not introduce damaged/lost/returned accessory categories in Phase 5.

## 57. Concurrency

Accessory sales, cost assignments, and corrections must transaction-read the relevant balance and lots.

Firestore transaction retries must recalculate quantities and COGS.

Do not calculate COGS from stale client-side balances.

---

# PART L — NEW CONNECTION

## 58. New Connection workflow

Add a dedicated New Connection action in Main Hisab.

A filled cylinder is mandatory.

Optional accessories:

- Gas stove.
- Lighter.
- Gas pipe.
- Regulator.

Pipe variants:

- 1.5 metre: default ₹190.
- 1.2 metre: default ₹100.

Regulator default: ₹450.

These default prices are:

- 19000 paise.
- 10000 paise.
- 45000 paise.

Use the existing configurable price rules/catalogue where appropriate.

Prices are prefilled but editable per transaction.

Editing a transaction price must not silently modify the catalogue default.

## 59. New Connection posting

New Connection must:

- Reuse the existing filled-cylinder issue mechanism.
- Reduce accessory inventory for selected accessories.
- Create the correct financial transaction.
- Distinguish cylinder revenue from accessory revenue.
- Record accessory COGS for costed items.
- Mark uncosted items as cost-incomplete.
- Preserve the Phase 4 cylinder ledger behavior.

A staff-created New Connection requires approval before financial and accessory effects are posted.

An approval failure must not leave accessory stock reduced.

The filled-cylinder issue and accessory deductions must be atomic or use a safe compensating design that guarantees no partial posting.

---

# PART M — ACCESSORIES SALE

## 60. Accessories Sale workflow

Add a dedicated Accessories Sale action.

It must support multiple accessory lines.

Each line includes:

- Accessory.
- Quantity.
- Selling price.
- Cost information derived from inventory lots.

Accessories Sale:

- Does not affect cylinder stock.
- Reduces agency-wide accessory stock.
- Recognizes accessory revenue when posted.
- Recognizes COGS only for costed units.
- Marks uncosted lines as cost-incomplete.
- Supports the approved payment/approval workflow.

A staff-created Accessories Sale requires approval.

Do not allow stock to become negative.

---

# PART N — STAFF SALARY AND ADVANCES

## 61. Salary profile and period

Salary functionality must support:

- Staff member.
- Salary period.
- Earned salary.
- Actual salary reduction.
- Included advances.
- Cash paid now.
- Remaining salary payable.

Salary reductions are limited to:

1. Actual salary reductions.
2. Recovery of advances explicitly included in Main Hisab.

Do not add unrelated deduction categories.

## 62. Salary advance

Salary advance has an optional checkbox:

`Include in Main Hisab`

Default: OFF.

If OFF:

- It remains a staff advance record.
- It does not debit a destination.
- It does not create a Main Hisab expense.
- It does not reduce salary cash due.

If ON:

- It is recorded as an agency-funded advance.
- It debits the selected destination when posted.
- It becomes eligible for salary recovery.
- It is tracked as an advance asset.

A staff-created advance requires approval.

## 63. Salary settlement calculations

Definitions:

`salaryExpensePaise = earnedPaise - reductionPaise`

`includedAdvanceRecoveryPaise = sum of eligible included advances recovered FIFO`

`cashDuePaise = salaryExpensePaise - includedAdvanceRecoveryPaise`

`cashPaidNowPaise <= cashDuePaise`

`salaryPayablePaise = cashDuePaise - cashPaidNowPaise`

Rules:

- Recovery is FIFO.
- Recovery cannot exceed eligible included advances.
- Recovery cannot exceed salary expense.
- Cash paid now cannot exceed cash due.
- Expense must be recognized once.
- Later payable payments must not recognize salary expense again.

## 64. Salary examples

### Example A

Earned salary: ₹20,000.

Included advance: ₹5,000.

No actual salary reduction.

Salary expense: ₹20,000.

Advance recovery: ₹5,000.

Cash due: ₹15,000.

If paid fully, salary payable is zero.

### Example B

Earned salary: ₹20,000.

Actual salary reduction: ₹2,000.

Included advance: ₹5,000.

Salary expense: ₹18,000.

Cash due: ₹13,000.

### Example C

Cash due: ₹13,000.

Cash paid now: ₹10,000.

Salary payable: ₹3,000.

Later payment of ₹3,000 must not create another salary expense.

---

# PART O — APPROVALS

## 65. Unified approvals

The Approvals module must be implemented in Phase 5F, when the first pending financial workflow is introduced.

It must support pending financial transactions from the relevant sub-phases.

At minimum:

- Expenses.
- Fund transfers.
- Owner movements.
- Portal transactions.
- Customer payments.
- Accessory stock purchases.
- New Connections.
- Accessories Sales.
- Salary advances and settlements, where applicable.

Godown sales and empty-cylinder returns remain immediate and do not enter this approval queue.

## 66. Approval rules

Pending transactions must not create final financial effects.

Approval must:

1. Revalidate permissions.
2. Revalidate available balances and stock.
3. Revalidate obligations.
4. Revalidate the opening gate.
5. Revalidate the business date.
6. Post all required effects atomically.
7. Mark the transaction posted.
8. Write audit history.

Rejecting a pending transaction must not create financial or stock effects.

Approving twice must never post twice.

---

# PART P — FUNCTIONS AND IDEMPOTENCY

## 67. Shared Cloud Function requirements

All financial Functions must:

- Run in `asia-south1`.
- Require authentication.
- Validate input with Zod or the repository's established validation standard.
- Check permission from trusted claims and staff profile.
- Enforce Admin-only operations.
- Enforce business-date rules.
- Enforce opening gate rules.
- Use integer paise.
- Use an idempotency key.
- Store a request hash.
- Write audit logs.
- Use server timestamps.
- Return standard errors.
- Use atomic Firestore transactions where required.

Do not trust client-supplied actor IDs, roles, balances, permissions, approval status, or calculated totals.

## 68. Idempotency behavior

For every financial operation:

1. Read the deterministic idempotency document.
2. If it exists, compare its request hash.
3. If the hash matches, return the original result.
4. If the hash differs, return an idempotency conflict.
5. If it does not exist, perform the operation atomically.
6. Create the idempotency document with the financial effects.

For deterministic opening records:

- Read the target record before writing.
- If absent, create it.
- If present with the same hash, treat it as a successful no-op.
- If present with a different hash, fail with an integrity error.

Do not attempt to continue after a Firestore `create` precondition abort.

Do not assume a failed create means the operation partially succeeded.

## 69. Opening Functions

Implement the following contracts:

- `beginFinancialOpeningSeal`
- `saveOpeningBalanceSheet`
- `planFinancialOpening`
- `prepareOpeningChunk`
- `listOpeningReviews`
- `verifyOpeningReceivable`
- `materializeOpeningReceivables`
- `buildOpeningRollup`
- `markOpeningReady`
- `publishFinancialOpening`
- `abandonFinancialOpeningSeal`

Every Function must validate the current session, generation, fence, and mutation epoch as applicable.

Preparation must be resumable and bounded.

No unbounded transaction or unbounded query may be used for opening publication.

## 70. Godown and release Functions

Implement or extend:

- `createGodownSale`
- `updateGodownSale`
- `reverseGodownSale`
- `releaseFutureDatedTransaction`
- `createManualOpeningReceivable`
- `linkOpeningReceivable`
- `createOpeningReceivableAdjustment`
- Historical sale exception review/resolution Function.

Preserve existing Phase 3 and Phase 4 behavior.

## 71. Payment and expense Functions

Implement:

- `receiveCustomerPayment`
- `applyCustomerCredit`
- `refundCustomerCredit`
- `createExpense`

Payment approval must create allocations, credit, destination entries, and obligation updates atomically.

## 72. Transfer and owner Functions

Implement:

- `createFundTransfer`
- `createOwnerMovement`
- `fundPortal`
- `settlePortal`
- `clearReconciliationFlag`

## 73. Accessory and salary Functions

Implement:

- `addAccessoryStock`
- `assignAccessoryCost`
- `correctAccessoryStock`
- `payPurchasePayable`
- `createNewConnection`
- `createAccessoriesSale`
- `createSalaryAdvance`
- `settleSalary`
- `paySalaryPayable`

## 74. Reporting Function

Implement:

`getFinancialReport`

It must enforce report permissions and filter unpublished opening rows.

Admin-only information must not be exposed to staff without the corresponding permission.

---

# PART Q — REPORTS

## 75. Required financial reports

Phase 5G must provide:

1. Main Hisab summary.
2. Destination balances.
3. Destination cashbook.
4. Customer dues.
5. Customer credit.
6. Expense report.
7. Salary report.
8. Owner loan liability.
9. IndianOil Portal prepaid balance.
10. Accessory stock valuation.
11. Accessory COGS.
12. Accessory gross profit.
13. New Connection sales.
14. Accessories Sale.
15. Cylinder sales revenue.
16. Net operating profit.
17. Commission/reference gross-margin report.
18. Reconciliation warnings.
19. Cash denomination closing report.

## 76. Report calculations

### Cylinder sales revenue

Sum posted post-cutover or released future-dated cylinder sale revenue.

Exclude:

- Pre-cutover sales.
- Reversed sales.
- Deferred sales not yet released.
- Pending transactions.

### New Connection revenue

Include posted New Connection revenue.

Separate cylinder and accessory components.

### Accessories Sale revenue

Include posted accessory sale revenue.

### Cash collections

Include:

- Godown sale collections.
- Customer payment collections.
- New Connection collections.
- Accessories Sale collections.

Do not omit New Connection or Accessories Sale collections.

### Customer dues

Sum outstanding operational and published opening money obligations.

Exclude empty-cylinder obligations and salary payable.

### Customer credit

Sum outstanding customer credit obligations.

### Destination balances

Use only balances matching the current publication pointer.

### Operating expenses

Include posted operating expense entries.

### Salary expense

Include recognized salary expense once.

Exclude advance and payable payments as additional expenses.

### Accessory valuation

Use remaining cost basis of costed stock.

Show uncosted quantity separately at zero valuation.

### Accessory COGS

Sum posted accessory COGS.

Incomplete cost lines contribute zero and must be visibly identified.

### Accessory gross profit

`Accessory revenue - Accessory COGS`

### Net operating profit

`Cylinder revenue + New Connection revenue + Accessories Sale revenue - Accessory COGS - Operating expenses - Salary expense`

Exclude transfers, opening balances, owner movements, portal movements, customer due collections, customer credit, stock purchase payments, and salary advances.

## 77. Cash denomination closing

Preserve the existing requirement for cash denomination closing.

Support denomination counts for:

- ₹500.
- ₹200.
- ₹100.
- ₹50.
- Smaller notes and coins.

The closing workflow must calculate the physical cash total.

It must compare physical cash with the selected cash destination's system balance and show the difference.

Do not silently change the destination balance to match the physical count.

Any adjustment must use a separately authorized, reasoned, audited reconciliation transaction.

The cash denomination closing is a reconciliation tool, not a new revenue or expense.

---

# PART R — PERMISSIONS

## 78. Permission keys

Reuse existing permissions where appropriate.

Existing:

- `payments.create`
- `expenses.create`
- `reports.viewAssigned`

Required Phase 5 permissions:

- `finance.transfer`
- `finance.viewBalances`
- `finance.manageOpening`
- `sales.newConnection`
- `sales.accessories`
- `inventory.accessoryManage`
- `salary.manage`

Inspect the existing permission model before extending it.

Do not grant new permissions to all staff by default.

## 79. Admin-only actions

At minimum:

- Financial opening seal, preparation, review and publication.
- Opening abandonment.
- Manual opening receivables.
- Opening receivable adjustments.
- Historical sale financial resolution.
- Godown financial reversal.
- Customer credit refunds.
- Reconciliation flag clearing.
- Accessory stock correction.
- Accessory cost assignment.
- Salary configuration and authorized settlement operations.
- Verification of opening balances.

## 80. Staff actions

Staff may create permitted financial requests.

The request remains pending until Admin approval.

Staff cannot directly write financial ledger records, balances, obligations, allocations, credit applications, opening records, or audit logs.

Assigned reports require `reports.viewAssigned`.

Destination balances require Admin or `finance.viewBalances`.

---

# PART S — STATE MACHINES

## 81. Opening session

`draft → preparing → ready_to_publish → published`

`preparing → abandoned`

`ready_to_publish → abandoned`

## 82. Opening gate

`not_opened → sealing → published`

`sealing → not_opened` on abandonment.

## 83. Sale finance effect

- `opening_snapshot → opening_reversed`
- `phase5_posted → phase5_reversed`
- `deferred → phase5_posted` on release
- Historical exceptions remain unresolved until Admin resolution.

The immutable sale cohort must never change after classification.

## 84. Obligation

- `open → partial`
- `open → settled`
- `partial → settled`
- `open → reversed`
- `partial → reversed`

Do not allow invalid transitions.

## 85. Approval

`pending_approval → posted`

`pending_approval → rejected`

No transition back to pending.

## 86. Reconciliation

A valid reversal unwind may set:

`reconciliationRequired = true`

Only Admin may clear it, with reason and audit.

Clearing the flag does not change the balance.

---

# PART T — CONCURRENCY AND RECOVERY

## 87. Required concurrency behavior

### Two payments against the same due

Only one may consume the available outstanding amount.

The second must retry and revalidate, or fail with an insufficient outstanding balance error.

No over-settlement is allowed.

### Duplicate payment request

Same idempotency key and request hash returns the original result.

Different request hash returns conflict.

### Two approvals

Only one may post.

The second must return the existing posted result or a clear terminal-state response.

### Opening preparation crash

A missing completion document means the chunk is incomplete.

Retry must use the same deterministic IDs.

Equal hashes are no-ops.

Different hashes are integrity errors.

### Stale worker

A worker with an old fence or generation cannot write.

### Sale during sealing

The mutation epoch changes.

Readiness and publication fail until the plan is rebuilt.

### Sale during publication

Use transaction conflicts and gate/session reads so the sale is either included in the rebuilt plan or posted through the published operational path.

Never allow a sale to fall between both paths.

### Reversal during preparation

The candidate is updated or invalidated through the controlled epoch mechanism.

Rebuild the affected generation.

### Accessory concurrency

Two simultaneous issues must not sell more stock than exists.

The losing transaction must recalculate stock and COGS after retry.

### Function timeout

A retry must return the original result and must not duplicate effects.

---

# PART U — IMPLEMENTATION SEQUENCE

## 88. Phase 5.0 — Financial foundation and opening

Scope:

- Financial opening gate.
- Session lifecycle.
- Fence and mutation epoch.
- Generation-specific planning.
- Bounded chunks.
- Opening snapshots.
- Receivable review.
- Receivable materialization.
- Opening balance sheet.
- Destination opening ledger entries.
- Owner loan opening verification.
- Rollups.
- Publication pointer.
- Financial balances.
- Immutable sale cohort records.
- Godown financial posting after publication.
- Godown financial reversal.
- Future-dated release.
- Historical sale exception handling.
- Manual opening receivable workflows.
- Required Security Rules and indexes.

Explicitly excluded:

- Customer payment UI.
- Expenses.
- Transfers.
- Accessory workflows.
- Salary workflows.
- Financial reports beyond opening diagnostics.

Acceptance requires all relevant tests in Part V.

Stop after 5.0.

## 89. Phase 5F — Transfers and destination management

Scope:

- Fund transfers.
- Owner contribution.
- Owner loan.
- Owner withdrawal.
- Owner loan repayment.
- Portal funding.
- Portal settlement.
- Destination balance views.
- Cashbook views.
- Reconciliation flag management.
- Unified Approvals module.
- Relevant permissions, Rules, indexes and tests.

Stop after 5F.

## 90. Phase 5A — Customer payments and dues

Scope:

- Receive customer payment.
- Multiple allocations.
- Customer credit creation.
- Credit application.
- Admin-only refund.
- Customer dues UI.
- Payment receipts.
- Customer payment history.
- Relevant approvals and reports.

Stop after 5A.

## 91. Phase 5B — Expenses

Scope:

- Expense categories in Settings.
- Expense creation.
- Approval.
- Destination debit.
- Expense report.
- Optional receipt/photo.
- Relevant Rules, indexes and tests.

Stop after 5B.

## 92. Phase 5C-a — Accessory inventory foundation

Scope:

- Agency-wide accessory balances.
- Accessory catalogue compatibility.
- Add Stock.
- Lots.
- Cost basis.
- Uncosted stock.
- Cost assignment.
- Purchase payables.
- Payable settlement.
- Stock correction.
- Accessory inventory UI.
- Relevant Rules, indexes and tests.

Opening accessory stock must be verified or explicitly confirmed as zero.

Stop after 5C-a.

## 93. Phase 5C-b — New Connection

Scope:

- Dedicated New Connection action.
- Mandatory filled cylinder.
- Optional accessories.
- Default price prefill.
- Transaction-specific price edits.
- Accessory stock deduction.
- Cylinder inventory integration.
- Revenue classification.
- COGS.
- Approval.
- Relevant tests.

Stop after 5C-b.

## 94. Phase 5D — Accessories Sale

Scope:

- Multiple accessory lines.
- Agency-wide stock deduction.
- Revenue.
- COGS.
- Uncosted stock handling.
- Approval.
- Receipts.
- Relevant reports and tests.

Stop after 5D.

## 95. Phase 5E — Staff salary

Scope:

- Salary profile.
- Salary advance.
- Include in Main Hisab option.
- Actual salary reductions.
- FIFO advance recovery.
- Salary expense recognition.
- Salary payable.
- Partial and later payment.
- Approval.
- Relevant reports and tests.

Stop after 5E.

## 96. Phase 5G — Financial reports and closing

Scope:

- All financial reports in Part Q.
- Net operating profit.
- Commission and reference gross-margin configuration.
- `not_configured` reporting.
- Cash denomination closing.
- Reconciliation warnings.
- Staff report restrictions.
- Export/share options where supported.
- Final Phase 5 integration tests.

Stop after 5G.

---

# PART V — ACCEPTANCE TESTS

Cursor must implement automated tests for the following requirements.

Do not mark a test as passed merely because code compiles.

Automated tests and manual tests must be reported separately.

## 97. Opening tests

**T1 — Staged data isolation**

Unpublished opening rows are invisible to ordinary clients.

Incomplete chunks cannot be marked ready.

**T2 — Readiness completeness**

Missing chunk, review, snapshot, opening balance, or rollup must prevent readiness.

**T3 — Fence protection**

A stale worker cannot write after session abandonment or generation change.

**T4 — Security query restrictions**

Unconstrained or unpublished opening queries are rejected.

**T5 — Published-session query**

Only operational records and the exact published session/generation are visible.

**T6 — Function authorization**

Functions enforce authentication and permission even though Admin SDK bypasses Security Rules.

**T7 — Cohort immutability**

Every planned sale receives exactly one valid cohort. Reversal does not change the immutable cohort.

**T8 — Opening balance ledger reconciliation**

Every verified destination opening balance has a matching `destination_opening` ledger entry.

The balance equals the visible ledger net.

**T9 — Publication atomicity**

The pointer, gate, session, and balances publish together.

A failed publication leaves the previous pointer unchanged.

**T10 — Generation isolation**

Rows from an abandoned or older generation cannot be published or read.

**T11 — Bounded processing**

Large opening datasets are processed through bounded chunks and bounded publication transactions.

**T12 — Review materialization**

No opening receivable is materialized from an unreviewed sale.

Approved amount is authoritative.

**T13 — Opening liability verification**

Owner loan liability must be explicitly verified or explicitly confirmed as zero.

**T14 — Snapshot verification**

Missing destination or unverified non-zero receipt blocks readiness.

**T15 — Snapshot variance**

A corrected amount/destination requires Admin, variance class, reason, and audit.

**T16 — Anchor date**

Anchor consignment date must match the financial opening date unless an audited mismatch reason exists.

**T17 — Empty return separation**

An empty-cylinder return never writes a Phase 5 financial ledger entry.

**T18 — Pre-cutover classification**

Sales on or before D are pre-cutover.

**T19 — Bridge classification**

Sales after D and on or before today are bridge sales.

**T20 — Future release**

Future sales remain deferred until eligible release or audited early release.

**T21 — Opening receivable exclusion**

Excluded historical sales do not create money obligations.

**T22 — Duplicate review warning**

Potential duplicate sales are flagged but never automatically merged.

**T23 — Preparation retry**

A crashed chunk can be retried with deterministic IDs and hash verification.

**T24 — Sale during sealing**

A new sale increments the mutation epoch and forces a plan rebuild.

**T25 — Backdated sale after publication**

A backdated sale does not silently credit the current cashbook or rewrite the published opening snapshot.

**T26 — Abandonment**

Abandoned staged data remains invisible.

**T27 — Destination count**

More than 40 destinations is rejected safely.

## 98. Reversal tests

**T28 — Pre-cutover paid reversal**

A verified snapshot is debited once.

No Phase 5 revenue reversal is created.

**T29 — Pre-cutover unpaid reversal**

The approved opening receivable is reversed once.

**T30 — Zero-collection reversal**

No destination debit occurs.

**T31 — Post-cutover reversal**

Collection is debited once, unpaid receivable is reversed, and revenue is excluded.

**T32 — Incomplete snapshot**

Reversal is blocked.

**T33 — Settled sale reversal**

Any payment allocation or credit application blocks reversal.

**T34 — Negative reversal unwind**

Negative balance is allowed only for a valid authorized reversal unwind and creates a reconciliation flag.

**T35 — Clear reconciliation flag**

Admin reason is required. Balance remains unchanged.

**T36 — Duplicate reversal**

Repeated reversal never double-debits or duplicates inventory restoration.

## 99. Customer payment tests

**T37 — Full payment**

Destination is credited and the correct obligation is settled.

**T38 — Partial payment**

Destination is credited and obligation becomes partial.

**T39 — Multiple allocations**

One payment can settle multiple obligations atomically.

**T40 — Registered customer overpayment**

Excess becomes customer credit.

**T41 — Walk-in overpayment**

Excess is rejected.

**T42 — Credit application**

Credit and target obligations decrease without destination movement.

**T43 — Credit refund**

Admin-only refund debits destination and is not an expense.

**T44 — Payment concurrency**

Concurrent payments cannot over-settle the same obligation.

**T45 — Pending payment**

Pending payment creates no final allocation, credit, destination credit, or obligation settlement.

**T46 — Payment approval**

Approval revalidates balances and posts all effects atomically.

**T47 — Payment rejection**

Rejection creates no financial effect.

## 100. Transfer and owner tests

**T48 — Fund transfer**

Source debit and destination credit occur once. Profit is unchanged.

**T49 — Owner contribution**

Destination increases without owner loan liability.

**T50 — Owner loan**

Destination increases and owner loan liability increases.

**T51 — Owner withdrawal**

Destination decreases without changing owner loan liability.

**T52 — Owner loan repayment**

Destination decreases and owner loan liability decreases.

**T53 — Excess loan repayment**

Repayment greater than outstanding liability is rejected.

**T54 — Portal funding**

Source decreases and portal increases. No expense is created.

**T55 — Portal settlement**

Portal decreases. No expense or COGS is created.

## 101. Expense tests

**T56 — Expense approval**

Approved expense debits destination and recognizes expense once.

**T57 — Expense pending**

Pending expense has no destination or profit effect.

**T58 — Duplicate approval**

Second approval cannot double-debit.

**T59 — Expense category**

Inactive categories remain available for historical display but cannot be selected for new transactions.

## 102. Accessory tests

**T60 — Paid stock purchase**

Quantity and cost basis increase; destination decreases; no immediate expense or COGS.

**T61 — Unpaid stock purchase**

Quantity and cost basis increase; purchase payable is created.

**T62 — Unknown-cost purchase**

Quantity and uncosted quantity increase; cost basis remains unchanged.

**T63 — Partial uncosted sale**

Costed units are consumed first. Remaining uncosted quantity is accurate.

**T64 — Later cost assignment**

Only remaining uncosted quantity can be costed.

Previously sold uncosted units remain cost-incomplete.

**T65 — Weighted average residual**

Rounding residual is preserved and fully consumed on the final costed unit.

**T66 — Concurrent accessory sales**

Stock cannot become negative and COGS is recalculated after transaction retry.

**T67 — Accessory correction**

Reason is mandatory. Cost basis and quantities reconcile.

**T68 — Purchase payable payment**

Payable decreases and destination is debited without creating a second expense or COGS.

**T69 — Opening accessory stock**

Opening quantity is verified or explicitly zero; no silent opening value.

## 103. New Connection and Accessories Sale tests

**T70 — New Connection cylinder**

Filled cylinder is mandatory.

**T71 — New Connection accessories**

Optional accessories reduce agency-wide stock only after successful posting.

**T72 — Default prices**

Pipe and regulator defaults are prefilled correctly and transaction edits do not alter catalogue defaults.

**T73 — New Connection approval**

Staff pending transaction has no financial, cylinder, or accessory effect until approved.

**T74 — New Connection cashbook**

Posted New Connection collections use the correct ledger class and appear once in Cash Collections.

**T75 — Accessories Sale**

Multiple lines are supported and no cylinder stock changes.

**T76 — Accessories Sale cashbook**

Posted collections appear once in Cash Collections.

**T77 — Uncosted Accessories Sale**

Incomplete cost is reported and no retrospective COGS is created.

## 104. Salary tests

**T78 — Included advance**

Included advance debits destination and is recoverable.

**T79 — Excluded advance**

Excluded advance has no destination, expense, or cash-due effect.

**T80 — Salary expense**

Expense is recognized exactly once.

**T81 — Actual salary reduction**

Reduction changes salary expense and cash due correctly.

**T82 — FIFO recovery**

Oldest included advances are recovered first.

**T83 — Recovery limit**

Recovery above eligible advance balance or salary expense is rejected.

**T84 — Partial salary payment**

Remaining amount becomes salary payable.

**T85 — Later payable payment**

Later payment does not create a second salary expense.

## 105. Reporting and security tests

**T86 — Profit formula**

Net operating profit matches the defined formula.

**T87 — Excluded movements**

Transfers, portal movements, owner movements, opening balances, dues collections, stock purchases, and salary advances do not become profit.

**T88 — Cash collections**

Godown, customer payment, New Connection, and Accessories Sale collections are all included exactly once.

**T89 — Commission not configured**

Report returns `not_configured` when no effective rule exists.

**T90 — Staff report permissions**

Assigned reports do not expose destination balances without permission.

**T91 — Published balance visibility**

Client cannot read an unpublished balance.

**T92 — Legacy empty-cylinder Rules**

Existing empty-cylinder functionality continues to work after financial Rules are added.

**T93 — Credit application visibility**

Published and operational credit applications follow the correct Rules and publication filtering.

**T94 — Cash denomination closing**

Physical cash total is calculated correctly and differences do not silently change system balances.

**T95 — Reconciliation**

Destination balances reconcile to visible cashbook entries.

**T96 — Audit completeness**

Every financial posting, approval, reversal, correction, refund, and opening decision has an auditable record.

---

# PART W — REQUIRED TRACEABILITY

## 106. Requirement-to-implementation mapping

Maintain a traceability matrix in the repository.

For every business requirement, record:

- Requirement ID.
- Requirement description.
- Architecture section.
- Function or service.
- Firestore collection/fields.
- Permission.
- Security Rule behavior.
- Automated test ID.
- Manual test status.

The matrix must reference the correct test IDs from Part V.

Do not claim that a requirement is tested unless its test actually verifies that behavior.

If a requirement is not implemented in the current sub-phase, mark it `out_of_scope_for_current_subphase`, not completed.

---

# PART X — FINAL IMPLEMENTATION RULES

## 107. UI requirements

The application must remain usable on mobile and desktop.

Financial forms must:

- Use clear labels.
- Display currency in INR.
- Show amount due and amount received separately where applicable.
- Clearly identify pending versus posted transactions.
- Show destination balances only to authorized users.
- Prevent accidental duplicate submissions.
- Display clear validation errors.
- Preserve business date and timestamp information.
- Support English and Hindi through the existing language architecture.
- Avoid exposing unrelated customer or staff data.

Do not replace existing UI architecture without a clear implementation reason.

## 108. Error handling

Use clear domain errors.

Examples:

- Financial opening not published.
- Opening session is stale.
- Opening generation mismatch.
- Insufficient outstanding customer due.
- Insufficient accessory stock.
- Transaction already approved.
- Transaction already reversed.
- Destination not authorized.
- Historical sale requires Admin review.
- Snapshot incomplete.
- Business date not eligible for release.
- Idempotency conflict.

Do not display raw Firebase stack traces to ordinary users.

## 109. Migration and compatibility

Before adding or changing a field:

1. Inspect existing documents.
2. Identify legacy records.
3. Determine whether a default is safe.
4. Avoid destructive migration.
5. Preserve historical records.
6. Document the migration.
7. Add tests for old and new document formats.

Do not assume all existing transactions contain fields introduced by Phase 5.

## 110. Completion criteria

Phase 5 is complete only when:

- All approved sub-phases are implemented.
- All relevant automated tests pass.
- Manual acceptance tests are completed by the user.
- Existing Phase 1–4 behavior remains intact.
- Firestore Rules and Functions enforce the specified security.
- Financial balances reconcile to the ledger.
- Obligations reconcile to allocations and credit applications.
- Accessory stock and cost basis reconcile.
- Salary expense is recognized exactly once.
- Reports use the defined calculations.
- No unpublished opening data is exposed.
- No duplicate financial posting occurs under retries.
- The user has explicitly approved final production deployment.

---

# FINAL DIRECTIVE TO CURSOR

Treat this file as the authoritative Phase 5 architecture.

**Your first response must be an architecture and repository assessment only.**

Do not implement Phase 5 immediately.

First inspect the existing repository and compare it with this specification. Identify conflicts, reusable code, missing pieces, required migrations, Security Rules, Functions, indexes, and test gaps.

Then propose the exact implementation plan for **Phase 5.0 only**.

Do not start Phase 5.0 implementation until the user explicitly approves the plan.

After approval, implement Phase 5.0 only. Test it, report the results, provide a manual testing checklist, and stop.

Wait for explicit approval before moving to Phase 5F.

Do not skip phases, invent accounting rules, silently alter locked decisions, or change existing Phase 1–4 behavior.

**This document governs Phase 5 implementation.**