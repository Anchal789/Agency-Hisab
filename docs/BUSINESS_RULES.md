# Business Rules

Status: agreed from the product brief. Implementation has not started.

These rules override convenience in the UI. If a screen and a rule disagree, the Cloud Function rejects the write.

## Roles

**Admin** can do everything in the product brief, including settings, user management, daily closing, approvals, and historical corrections.

**Staff** can do only the capabilities an admin has turned on. Examples: add godown entries, view customers, record payments, view inventory, record vehicle transactions, record expenses, view assigned reports. Staff cannot approve, close a day, manage users, or post a historical correction.

A role or permission sent in a request body is ignored. The server reads custom claims and `users/{uid}`.

## Approval

- Staff-created financial and inventory transactions stay `pending_approval` until an admin approves them. They do not affect posted balances before approval.
- **Godown Customer Register entries do not require approval.** After server-side validation they post immediately, including when a staff member creates them.
- Rejected transactions do not affect balances. Rejection requires a reason.
- Godown entries display approval `not_required`.

## Single source of truth

A godown sale is one transaction id referenced by the register, temporary Hisab, main Hisab, inventory ledger, customer history, financial ledger, money dues, empty-cylinder obligations, and reports.

Modules do not keep their own editable copies of those totals.

Materialized balance documents exist so screens stay fast. They change only inside the posting transaction that writes the ledger lines.

## Money

- Store and calculate money as integer paise. One rupee is 100 paise.
- Do not use binary floating point for accounting.
- Display with Indian grouping and the rupee sign.
- Sale amount, amount received, and money due must satisfy: received + due = sale, all in paise, none negative.
- Partial payment is normal. Example: sale ₹1,000.00, received ₹600.00, due ₹400.00.
- Cash, UPI, bank, Indane portal, and named recipients are separate accounts. A UPI collection does not increase the cash balance.
- Payment method and receiving account are different fields. Both are configurable in settings. No prices or account lists are hardcoded in components.
- A customer payment allocates only to money obligations.
- Refundable security deposits are liabilities, not sales revenue.

## Inventory

Stock is counted by location, product, and state (filled, empty, damaged, or a configured state).

- A sale decreases filled stock at the issuing location.
- An empty return increases empty stock at the location that actually received it.
- A transfer is an out from the source and an in at the destination. It creates no revenue and no customer due.
- Negative stock is rejected unless `settings/agency.negativeStockAllowed` is true and the caller is allowed to use that exception.
- Opening stock, receipt, issue, adjustment, and reconciliation are their own transaction types. Adjustments require authorization.

## Empty cylinders and money are separate

Selling one filled cylinder and receiving zero empties creates an empty-cylinder obligation of 1. Collecting the money later does not close that obligation. Receiving the empty later does not close the money obligation.

A customer may return an empty cylinder before taking a filled cylinder. That event is not a sale and posts no income. When the filled cylinder is later collected, the sale links to that earlier return, stock moves at the real locations, and a second empty obligation is not created. Partial matching is allowed.

## Customers

Master data fields: consumer name, consumer number, address, city, last refill date, created and updated timestamps, import source, active flag.

Excel import accepts only those five business fields (name, number, address, city, last refill date). Every other column is ignored and is not stored.

Consumer numbers stay strings, including leading zeroes. Reimporting a file matches on consumer number and must not create a second customer. Existing rows are not overwritten without an explicit conflict review. Import does not create financial transactions.

Walk-in godown sales may omit a consumer number. They store the typed name on the transaction.

Search must support consumer number, full name, first name, last name, address, and city.

## Godown deletion versus historical correction

An admin may reverse a godown entry through the delete action only when its **business date is today** in the agency timezone. Created-at and edited-at do not matter. Staff cannot delete godown entries.

The flow shows the effects, requires a reason, and requires two confirmations. The original document becomes `reversed`. Compensating ledger lines restore money, stock, and obligations. An audit record is stored. The document is not physically deleted.

A past business date cannot use that action. It goes through Historical Correction (Phase 7): original preserved, correction id, reason, before and after, impact preview, authorization, and recalculation of affected balances and later day-close snapshots.

## Hisab

Main Hisab and temporary Hisab are queries over transactions and ledgers. Nobody types a daily total into a summary field.

Temporary Hisab shows godown entries as soon as they post, and shows other staff entries with their approval status. Status labels stay distinct: posted, pending approval, rejected, reversed, offline queued, failed.

## Daily closing

Day statuses: `open`, `review_required`, `locked`, `reopened`, `reapproval_required`.

Locking stores a checklist snapshot and, when used, a cash denomination count. Expected cash and counted cash are both shown. A difference is never written into the books silently.

A locked day rejects ordinary edits. Corrections reopen or flag reapproval according to policy and keep the original snapshot.

## Offline

A record that exists only on the device is not posted and not approved. After sync, godown entries still pass server validation before they post. Retries use the same idempotency key so they cannot double-post.

## Language and dates

English and Hindi for all user-visible text. Agency timezone defaults to `Asia/Kolkata`. “Today” for deletion and closing uses that timezone, not the device’s zone if they differ.
