/** Phase 5 financial cashbook and money-obligation models. */

export const RECORD_SCOPES = ['operational', 'opening'] as const
export type RecordScope = (typeof RECORD_SCOPES)[number]

export const DESTINATION_OWNERSHIPS = ['agency', 'third_party_held', 'portal'] as const
export type DestinationOwnership = (typeof DESTINATION_OWNERSHIPS)[number]

export const FINANCIAL_ENTRY_CLASSES = [
  'destination_opening',
  'sale_collection',
  'customer_payment',
  'customer_credit_refund',
  'expense',
  'fund_transfer_out',
  'fund_transfer_in',
  'owner_contribution',
  'owner_loan_received',
  'owner_withdrawal',
  'owner_loan_repayment',
  'portal_funding_out',
  'portal_funding_in',
  'portal_settlement',
  'stock_purchase_payment',
  'new_connection_collection',
  'accessories_sale_collection',
  'salary_advance_included',
  'salary_settlement_payment',
  'salary_payable_payment',
  'godown_sale_reversal',
  'collection_unwind',
] as const
export type FinancialEntryClass = (typeof FINANCIAL_ENTRY_CLASSES)[number]

export const LEDGER_DIRECTIONS = ['credit', 'debit'] as const
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number]

export const MONEY_OBLIGATION_SOURCES = [
  'opening_receivable',
  'godown_sale',
  'new_connection',
  'accessories_sale',
  'backdated_adjustment',
  'manual_opening_receivable',
] as const
export type MoneyObligationSource = (typeof MONEY_OBLIGATION_SOURCES)[number]

export const CUTOVER_COHORTS = ['pre_cutover', 'post_cutover', 'future_dated'] as const
export type CutoverCohort = (typeof CUTOVER_COHORTS)[number]

export const FINANCE_EFFECTS = [
  'none',
  'opening_snapshot',
  'phase5_posted',
  'opening_reversed',
  'phase5_reversed',
  'deferred',
  'excluded_reversed',
] as const
export type FinanceEffect = (typeof FINANCE_EFFECTS)[number]

export const SNAPSHOT_STATUSES = [
  'captured',
  'zero_collection',
  'admin_corrected',
  'incomplete',
  'not_applicable',
] as const
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number]

export const RECEIVABLE_STATUSES = ['none', 'staged', 'open', 'reversed', 'excluded'] as const
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number]

export const HISTORICAL_EXCEPTION_STATES = [
  'needs_historical_review',
  'blocked_reconciliation',
  'resolved_no_receivable',
  'resolved_receivable',
] as const
export type HistoricalExceptionState = (typeof HISTORICAL_EXCEPTION_STATES)[number]

export const OPENING_GATE_STATES = ['not_opened', 'sealing', 'published'] as const
export type OpeningGateState = (typeof OPENING_GATE_STATES)[number]

export const OPENING_SESSION_STATES = [
  'draft',
  'preparing',
  'ready_to_publish',
  'published',
  'abandoned',
] as const
export type OpeningSessionState = (typeof OPENING_SESSION_STATES)[number]

export const REVIEW_DECISIONS = ['include', 'exclude'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

/** Deterministic money obligation id for a sale-originated receivable. */
export function moneyObligationIdForSale(saleId: string): string {
  return `money_${saleId}`
}

/** Claim docs enforce sale↔obligation uniqueness under concurrency. */
export function moneyOriginClaimId(saleId: string): string {
  return saleId
}

export function moneyLinkClaimId(obligationId: string): string {
  return obligationId
}

export function destinationOpeningLedgerId(
  sessionId: string,
  generationId: string,
  accountId: string,
): string {
  return `${sessionId}_${generationId}_destination_opening_${accountId}`
}

export function saleCollectionLedgerId(saleId: string, accountId: string): string {
  return `${saleId}_${accountId}_sale_collection`
}

export function collectionUnwindLedgerId(saleId: string): string {
  return `${saleId}_collection_unwind`
}

export function godownReversalTransactionId(saleId: string): string {
  return `${saleId}_reversal`
}

export type FinancialLedgerDoc = {
  accountId: string
  amountPaise: number
  direction: LedgerDirection
  entryClass: FinancialEntryClass
  businessDate: string
  transactionId: string
  recordScope: RecordScope
  openingSessionId: string | null
  openingGenerationId: string | null
  customerId: string | null
  obligationId: string | null
  relatedTransactionId: string | null
  idempotencyKey: string | null
  reversalOfEntryId: string | null
  createdBy: string
}

export type FinancialBalanceDoc = {
  accountId: string
  balancePaise: number
  publishedSessionId: string
  publishedGenerationId: string
  needsReconciliation: boolean
  reconciliationReason: string | null
  updatedByTransactionId: string
}

export type MoneyOriginClaimDoc = {
  obligationId: string
  saleId: string
  status: 'claimed' | 'released'
  createdBy: string
}

export type MoneyLinkClaimDoc = {
  saleId: string
  obligationId: string
  status: 'claimed' | 'released'
  createdBy: string
}
