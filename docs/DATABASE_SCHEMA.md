# Database Schema

Status: Phase 1 foundation live for `users`, `settings/agency`, `settings/bootstrap`, `auditLogs`, plus admin-configured `locations`, `products`, and `priceRules`. Phase 2 live for `customers` and `customerImportBatches`. Remaining collections stay proposed until their phase.

Firestore is the system of record. Security Rules allow clients to read what their role permits and deny client writes to privileged collections. Cloud Functions using the Admin SDK perform those writes inside Firestore transactions.

## Conventions

- Document ids for business transactions are client-generated UUIDs, reused as idempotency anchors.
- Money is an integer number of paise. Field names use the suffix `Paise`.
- Quantities are integers.
- `businessDate` is `YYYY-MM-DD` in the agency timezone.
- `createdAt`, `updatedAt`, `approvedAt`, `reversedAt`, and `correctedAt` are Firestore server timestamps.
- Enum fields are string unions defined in `shared/models`.
- Balance documents are materialized read models. They are written only in the same transaction as the ledger lines that justify them. A ledger replay must reproduce them. Operators cannot edit a balance by itself.

## Collections

### `users/{uid}`

Mirrors Firebase Auth. Created by admin provisioning or staff creation.

- `phoneE164`: canonical Indian mobile in E.164 (`+91…`)
- `authEmail`: server-only synthetic Email/Password identifier (`{91…}@users.hisab.internal`); never shown in the UI
- `displayName`, `role` (`admin` | `staff`), `status` (`active` | `disabled`)
- `permissions`: map of staff capabilities (ignored for admin, who has full access)
- `language`: `en` | `hi`
- `mustChangePassword`: when true, the user must set a new password before using the app
- `createdAt`, `updatedAt`, `createdBy`

See `docs/AUTHENTICATION.md` for the phone → synthetic-email mapping.

### `settings/agency`

Single document.

- `name`, `timezone` (default `Asia/Kolkata`), `currency` (`INR`)
- `paymentMethods[]`, `receivingAccounts[]`
- `expenseCategories[]`, `inventoryStates[]`
- `negativeStockAllowed` (default false)
- `historicalCorrectionRequiresSecondAdmin` (default false until Phase 7)

### `settings/counters`

Optional human-readable voucher numbers. Not used as the accounting primary key.

### `agents/{agentId}`

- `name`, `phone`, `status`, `roles[]` (agent, driver, manager, staff)
- `userId` optional link to `users`
- `locationIds[]`
- `createdAt`, `updatedAt`

Phase 6 adds commission and statement views. The collection can exist earlier only if a later phase needs the id. Phase 1 does not seed fictional agents.

### `vehicles/{vehicleId}`

- `registrationNumber`, `label`, `status`
- `locationId` for the vehicle’s own stock location
- `createdAt`, `updatedAt`

### `locations/{locationId}`

- `name`, `kind` (`godown` | `vehicle` | `agent` | `other`)
- `agentId`, `vehicleId` when applicable
- `active`

Seeded with one Godown location when inventory work starts, not with fake stock.

### `products/{productId}`

- `name`, `code`, `kind` (`cylinder` | `accessory` | `other`)
- `unit`, `active`
- Cylinder capacity or commercial name (for example 14.2 kg domestic) is data, not a hardcoded price.

### `customers/{customerId}`

Writes only via Cloud Functions (`createCustomer`, `updateCustomer`, `commitCustomerImport`).

- `firstName`, `lastName`, `displayName` (normalized whitespace)
- `address`, `city`
- `consumerNumber` string, unique (case-insensitive via `consumerNumberLower`). Leading zeroes preserved.
- `consumerNumberLower` for uniqueness queries
- `lastRefillDate` (`YYYY-MM-DD` or null, Asia/Kolkata calendar date)
- `status` (`active` | `inactive`)
- `searchTokens[]` for name, number, address, and city prefixes
- `importBatchId`, `importSource` (`manual` | `excel` | null)
- `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

Custom (walk-in) names on a godown sale do not create a customer master row unless the operator explicitly saves one.

### `customerImportBatches/{batchId}`

Writes only via Cloud Functions (`commitCustomerImport`). Idempotent on `batchId` when status is already `committed`.

- `fileName`, `uploadedBy`, `createdAt`, `updatedAt`
- `status` (`committed`)
- `rowCount`, `createdCount`, `skippedCount`, `conflictCount`

Customer import writes customers only. It does not write `transactions` or ledgers.

### `priceRules/{ruleId}`, `costRules/{ruleId}`, `commissionRules/{ruleId}`

- `productId` or scope, `accountId` where relevant
- `amountPaise` or rate basis points
- `effectiveFrom`, `effectiveTo`
- Changing a rule never rewrites posted transactions. Posting copies the applied amount onto the transaction.

### `transactions/{transactionId}`

Central business event.

- `type` (examples: `godown_sale`, `customer_payment`, `empty_return`, `stock_receipt`, `stock_transfer`, `expense`, `new_connection`, `reversal`, `historical_correction`)
- `status` (`posted` | `pending_approval` | `rejected` | `reversed`)
- `businessDate`, `timezone`
- `customerId` optional, `customerSnapshot` (name, consumer number, address, city at posting time)
- `locationId`, `productId`
- `quantities`: filled, empty returned, empty due
- `amountsPaise`: sale, received, due, and per-account breakdown
- `paymentMethodId`, `receivingAccountId`
- `bookingStatus` (`yes` | `no` | `verification_required`)
- `note`
- `idempotencyKey`
- `createdBy`, `createdAt`
- `approval` (`not_required` | `pending` | `approved` | `rejected`)
- `reversalOf`, `reversedBy` optional
- `correctionId` optional

Godown sales use `approval: not_required` and `status: posted` in the same write.

### `inventoryLedger/{entryId}`

- `transactionId`, `businessDate`
- `locationId`, `productId`, `state` (`filled` | `empty` | `damaged` | configurable)
- `quantityDelta` (signed integer)
- `sourceLocationId`, `destinationLocationId`
- `movementType`

A transfer is two linked entries (out and in) with the same `transactionId` and no revenue.

### `inventoryBalances/{locationId}_{productId}_{state}`

- `quantity` integer
- `updatedAt`, `updatedByTransactionId`

### `financialLedger/{entryId}`

Double-entry lines.

- `transactionId`, `businessDate`
- `accountId`, `direction` (`debit` | `credit`)
- `amountPaise`
- `memo`

Every posted journal balances: sum of debits equals sum of credits. Cash, UPI, bank, portal, and named recipient accounts are distinct account ids. A transfer between accounts is not revenue. A refundable deposit is a liability, not income.

### `financialBalances/{accountId}`

- `balancePaise` (signed; convention documented per account type in `shared/rules`)
- `updatedAt`, `updatedByTransactionId`

### `payments/{paymentId}` and `paymentAllocations/{allocationId}`

A payment is also a `transactions` document of type `customer_payment`. These collections record allocation to specific money obligations.

- Payment: `transactionId`, `customerId`, `accountId`, `amountPaise`, `businessDate`
- Allocation: `paymentId`, `obligationId`, `amountPaise`

Unallocated remainder stays on the payment until assigned. Allocation never reduces an empty-cylinder obligation.

### `obligations/{obligationId}`

- `kind` (`money` | `empty_cylinder` | `filled_cylinder` | `security_deposit`)
- `customerId` or `agentId`
- `originTransactionId`
- `productId`, `locationId` when relevant
- `originalQuantity` or `originalAmountPaise`
- `settledQuantity` or `settledAmountPaise`
- `outstanding` derived and stored, updated only with a settlement transaction
- `status` (`open` | `partial` | `settled` | `reversed`)
- `businessDate`

Money and empty-cylinder obligations are separate documents.

### `dailyClosings/{businessDate}`

- `status` (`open` | `review_required` | `locked` | `reopened` | `reapproval_required`)
- Checklist snapshot, denomination count, expected vs actual cash
- `lockedAt`, `lockedBy`, `snapshot` (immutable once locked)
- Later corrections set `review_required` and do not overwrite the original snapshot.

### `approvalRequests/{transactionId}`

Present when approval is required. Godown sales do not get a pending request.

- `submittedBy`, `submittedAt`, `type`, `businessDate`, `summary`
- `decision`, `decidedBy`, `decidedAt`, `reason`

### `historicalCorrections/{correctionId}`

- `originalTransactionId`, `originalBusinessDate`
- `createdAt`, `createdBy`, `reason`
- `before`, `after`, financial impact, inventory impact
- `attachmentIds[]`
- `secondApproverId` when policy requires it

### `auditLogs/{logId}`

Append-only. Actor, action, target path, request id, timestamp.

### `idempotencyRecords/{key}`

- `transactionId`, `actorUid`, `createdAt`, `requestHash`

### `syncConflicts/{id}`

Phase 8. Local transaction id, server state, resolution.

### `attachmentMetadata/{id}`

Storage path, content type, linked record, uploaded by. Bytes live in Cloud Storage.

### `backupMetadata/{id}`

Phase 8. Who triggered it, scope, storage path, status. A backup record is not evidence of a tested restore.

## Indexes

Composite indexes will be added with the feature that queries them. Expected first indexes:

- `customers`: `status` + `consumerNumber`; array-contains on `searchTokens` with `status`
- `transactions`: `type` + `businessDate`; `businessDate` + `status`; `customerId` + `businessDate`
- `obligations`: `customerId` + `kind` + `status`
- `approvalRequests`: `decision` + `submittedAt`

Customer search keeps `consumerNumber` as a string. Prefix search uses `searchTokens` (full value plus bounded prefixes), not a scan of the collection.

## Invariants the schema must preserve

1. One business action, one `transactions` id, many ledger lines.
2. Posted journals balance.
3. Inventory movements for a transfer net to zero across locations.
4. Sales reduce stock at the source location. Returns increase stock at the receiving location.
5. Money settlement does not change empty-cylinder outstanding, and the reverse.
6. Reversal adds compensating ledger lines and marks the original `reversed`. It does not delete the original.
7. Retries with the same idempotency key do not add a second set of ledger lines.
8. Client SDK writes to ledger, balance, obligation, closing, audit, and idempotency collections fail security rules.
