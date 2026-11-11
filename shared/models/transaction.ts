/** Phase 3 godown register transaction and empty-cylinder obligation models. */

export const GODOWN_TRANSACTION_TYPES = ['godown_sale', 'empty_return'] as const
export type GodownTransactionType = (typeof GODOWN_TRANSACTION_TYPES)[number]

export const TRANSACTION_STATUSES = ['posted', 'pending_approval', 'rejected', 'reversed'] as const
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]

export const APPROVAL_STATES = ['not_required', 'pending', 'approved', 'rejected'] as const
export type ApprovalState = (typeof APPROVAL_STATES)[number]

export const BOOKING_STATUSES = ['yes', 'no'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const CUSTOMER_KINDS = ['registered', 'custom'] as const
export type CustomerKind = (typeof CUSTOMER_KINDS)[number]

export const OBLIGATION_KINDS = ['empty_cylinder', 'money'] as const
export type ObligationKind = (typeof OBLIGATION_KINDS)[number]

export const OBLIGATION_STATUSES = ['open', 'partial', 'settled', 'reversed'] as const
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number]

export type CustomerSnapshot = {
  name: string
  consumerNumber: string | null
  address: string
  city: string
  lastRefillDate: string | null
}

export type GodownQuantities = {
  filledIssued: number
  emptyReceived: number
  emptyOutstanding: number
}

export type GodownAmountsPaise = {
  salePaise: number
  receivedPaise: number
  duePaise: number
}

export type TransactionDoc = {
  id: string
  type: GodownTransactionType
  status: TransactionStatus
  approval: ApprovalState
  businessDate: string
  timezone: string
  customerKind: CustomerKind
  customerId: string | null
  customerSnapshot: CustomerSnapshot
  locationId: string | null
  productId: string
  productName: string
  quantities: GodownQuantities
  amountsPaise: GodownAmountsPaise
  paymentMethodId: string | null
  paymentMethodName: string | null
  receivingAccountId: string | null
  receivingAccountName: string | null
  bookingStatus: BookingStatus
  /** Legacy-only. New godown writes omit this; kept for reading older records. */
  bookingName: string | null
  note: string
  idempotencyKey: string
  /** Sale that created the empty obligation this return settles. */
  originTransactionId: string | null
  /** Business date of the linked origin sale (denormalized on empty returns). */
  originBusinessDate: string | null
  /**
   * Remaining empty cylinders on the origin obligation after this return posted.
   * Present on empty_return rows written after the Phase 3 return-history fix.
   */
  remainingOutstandingAfter: number | null
  obligationId: string | null
  reversalOf: string | null
  reversedByTransactionId: string | null
  reverseReason: string | null
  createdBy: string
  updatedBy: string
  createdAtMs: number | null
  updatedAtMs: number | null
}

/** Derived empty-cylinder figures for a godown sale without rewriting history. */
export type SaleEmptyCylinderBreakdown = {
  /** Filled issued on the original sale. */
  filledIssued: number
  /** Empties collected at sale time (historical). */
  emptyReceivedAtSale: number
  /** Original empty due created by the sale: filled − empty at sale. */
  originalDue: number
  /** Empties returned later against this sale. */
  subsequentlyReturned: number
  /** Still outstanding against this sale. */
  remainingDue: number
}

export type ObligationDoc = {
  id: string
  kind: 'empty_cylinder'
  status: ObligationStatus
  customerId: string | null
  customerKind: CustomerKind
  customerName: string
  originTransactionId: string
  productId: string
  locationId: string | null
  businessDate: string
  originalQuantity: number
  settledQuantity: number
  outstanding: number
  createdBy: string
  updatedBy: string
}

export function emptyOutstandingFromIssue(filledIssued: number, emptyReceived: number): number {
  if (!Number.isSafeInteger(filledIssued) || !Number.isSafeInteger(emptyReceived)) return NaN
  if (filledIssued < 0 || emptyReceived < 0) return NaN
  if (emptyReceived > filledIssued) return NaN
  return filledIssued - emptyReceived
}

export function obligationStatusFromQuantities(original: number, settled: number): ObligationStatus {
  if (settled <= 0) return 'open'
  if (settled >= original) return 'settled'
  return 'partial'
}

/**
 * Sale quantities keep historical emptyReceived-at-sale and live emptyOutstanding.
 * Later returns only reduce emptyOutstanding on the origin sale.
 */
export function saleEmptyCylinderBreakdown(quantities: GodownQuantities): SaleEmptyCylinderBreakdown | null {
  const originalDue = emptyOutstandingFromIssue(quantities.filledIssued, quantities.emptyReceived)
  if (!Number.isSafeInteger(originalDue)) return null
  const remainingDue = quantities.emptyOutstanding
  if (!Number.isSafeInteger(remainingDue) || remainingDue < 0 || remainingDue > originalDue) return null
  return {
    filledIssued: quantities.filledIssued,
    emptyReceivedAtSale: quantities.emptyReceived,
    originalDue,
    subsequentlyReturned: originalDue - remainingDue,
    remainingDue,
  }
}

/** Remaining after a specific return, when the denormalized field is present. */
export function returnRemainingOutstanding(row: Pick<TransactionDoc, 'type' | 'remainingOutstandingAfter'>): number | null {
  if (row.type !== 'empty_return') return null
  return typeof row.remainingOutstandingAfter === 'number' && Number.isSafeInteger(row.remainingOutstandingAfter)
    ? row.remainingOutstandingAfter
    : null
}

/** Sort empty returns oldest-first by business date, then createdAt. */
export function sortEmptyReturns(rows: readonly TransactionDoc[]): TransactionDoc[] {
  return [...rows].sort((a, b) => {
    const byDate = a.businessDate.localeCompare(b.businessDate)
    if (byDate !== 0) return byDate
    const aMs = a.createdAtMs ?? 0
    const bMs = b.createdAtMs ?? 0
    return aMs - bMs
  })
}

export type SaleReturnHistorySummary = {
  originalDue: number
  returnedLater: number
  remainingDue: number
  returnCount: number
  /** Sum of emptyReceived on linked return rows (for linkage checks). */
  returnedFromLinkedRows: number
}

/**
 * Summarize later empty returns for one original sale.
 * Only counts returns whose originTransactionId matches the sale.
 */
export function summarizeSaleReturnHistory(
  sale: Pick<TransactionDoc, 'id' | 'type' | 'quantities'>,
  returns: readonly TransactionDoc[],
): SaleReturnHistorySummary | null {
  if (sale.type !== 'godown_sale') return null
  const breakdown = saleEmptyCylinderBreakdown(sale.quantities)
  if (!breakdown) return null
  const linked = returns.filter(
    (row) =>
      row.type === 'empty_return' &&
      row.status !== 'reversed' &&
      row.originTransactionId === sale.id,
  )
  return {
    originalDue: breakdown.originalDue,
    returnedLater: breakdown.subsequentlyReturned,
    remainingDue: breakdown.remainingDue,
    returnCount: linked.length,
    returnedFromLinkedRows: linked.reduce((sum, row) => sum + row.quantities.emptyReceived, 0),
  }
}

export function isGodownTransactionType(value: unknown): value is GodownTransactionType {
  return value === 'godown_sale' || value === 'empty_return'
}

function asNonNegInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseSnapshot(value: unknown): CustomerSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name) return null
  return {
    name,
    consumerNumber: typeof row.consumerNumber === 'string' && row.consumerNumber.trim() ? row.consumerNumber.trim() : null,
    address: typeof row.address === 'string' ? row.address.trim() : '',
    city: typeof row.city === 'string' ? row.city.trim() : '',
    lastRefillDate:
      typeof row.lastRefillDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.lastRefillDate) ? row.lastRefillDate : null,
  }
}

function parseQuantities(value: unknown): GodownQuantities | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const filledIssued = asNonNegInt(row.filledIssued)
  const emptyReceived = asNonNegInt(row.emptyReceived)
  const emptyOutstanding = asNonNegInt(row.emptyOutstanding)
  if (filledIssued === null || emptyReceived === null || emptyOutstanding === null) return null
  return { filledIssued, emptyReceived, emptyOutstanding }
}

function parseAmounts(value: unknown): GodownAmountsPaise | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const salePaise = asNonNegInt(row.salePaise)
  const receivedPaise = asNonNegInt(row.receivedPaise)
  const duePaise = asNonNegInt(row.duePaise)
  if (salePaise === null || receivedPaise === null || duePaise === null) return null
  return { salePaise, receivedPaise, duePaise }
}

function timestampToMs(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { toMillis?: () => number; seconds?: number }
  if (typeof row.toMillis === 'function') return row.toMillis()
  if (typeof row.seconds === 'number') return row.seconds * 1000
  return null
}

export function parseTransaction(id: string, data: Record<string, unknown>): TransactionDoc | null {
  if (!isGodownTransactionType(data.type)) return null
  const status = TRANSACTION_STATUSES.includes(data.status as TransactionStatus) ? (data.status as TransactionStatus) : null
  const approval = APPROVAL_STATES.includes(data.approval as ApprovalState) ? (data.approval as ApprovalState) : null
  const businessDate = asString(data.businessDate)
  const timezone = asString(data.timezone) || 'Asia/Kolkata'
  const customerKind = CUSTOMER_KINDS.includes(data.customerKind as CustomerKind)
    ? (data.customerKind as CustomerKind)
    : null
  const snapshot = parseSnapshot(data.customerSnapshot)
  const productId = asString(data.productId)
  const productName = asString(data.productName)
  const quantities = parseQuantities(data.quantities)
  const amountsPaise = parseAmounts(data.amountsPaise)
  const bookingStatus = BOOKING_STATUSES.includes(data.bookingStatus as BookingStatus)
    ? (data.bookingStatus as BookingStatus)
    : null
  const idempotencyKey = asString(data.idempotencyKey)
  const createdBy = asString(data.createdBy)
  const updatedBy = asString(data.updatedBy)
  if (
    !status ||
    !approval ||
    !businessDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !customerKind ||
    !snapshot ||
    !productId ||
    !productName ||
    !quantities ||
    !amountsPaise ||
    !bookingStatus ||
    !idempotencyKey ||
    !createdBy ||
    !updatedBy
  ) {
    return null
  }

  return {
    id,
    type: data.type,
    status,
    approval,
    businessDate,
    timezone,
    customerKind,
    customerId: typeof data.customerId === 'string' && data.customerId ? data.customerId : null,
    customerSnapshot: snapshot,
    locationId: typeof data.locationId === 'string' && data.locationId ? data.locationId : null,
    productId,
    productName,
    quantities,
    amountsPaise,
    paymentMethodId: typeof data.paymentMethodId === 'string' && data.paymentMethodId ? data.paymentMethodId : null,
    paymentMethodName: typeof data.paymentMethodName === 'string' ? data.paymentMethodName : null,
    receivingAccountId:
      typeof data.receivingAccountId === 'string' && data.receivingAccountId ? data.receivingAccountId : null,
    receivingAccountName: typeof data.receivingAccountName === 'string' ? data.receivingAccountName : null,
    bookingStatus,
    bookingName: typeof data.bookingName === 'string' && data.bookingName.trim() ? data.bookingName.trim() : null,
    note: typeof data.note === 'string' ? data.note.trim() : '',
    idempotencyKey,
    originTransactionId:
      typeof data.originTransactionId === 'string' && data.originTransactionId ? data.originTransactionId : null,
    originBusinessDate:
      typeof data.originBusinessDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.originBusinessDate)
        ? data.originBusinessDate
        : null,
    remainingOutstandingAfter: asNonNegInt(data.remainingOutstandingAfter),
    obligationId: typeof data.obligationId === 'string' && data.obligationId ? data.obligationId : null,
    reversalOf: typeof data.reversalOf === 'string' && data.reversalOf ? data.reversalOf : null,
    reversedByTransactionId:
      typeof data.reversedByTransactionId === 'string' && data.reversedByTransactionId
        ? data.reversedByTransactionId
        : null,
    reverseReason: typeof data.reverseReason === 'string' && data.reverseReason.trim() ? data.reverseReason.trim() : null,
    createdBy,
    updatedBy,
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
  }
}

export function parseObligation(id: string, data: Record<string, unknown>): ObligationDoc | null {
  if (data.kind !== 'empty_cylinder') return null
  const status = OBLIGATION_STATUSES.includes(data.status as ObligationStatus) ? (data.status as ObligationStatus) : null
  const customerKind = CUSTOMER_KINDS.includes(data.customerKind as CustomerKind)
    ? (data.customerKind as CustomerKind)
    : null
  const customerName = asString(data.customerName)
  const originTransactionId = asString(data.originTransactionId)
  const productId = asString(data.productId)
  const businessDate = asString(data.businessDate)
  const originalQuantity = asNonNegInt(data.originalQuantity)
  const settledQuantity = asNonNegInt(data.settledQuantity)
  const outstanding = asNonNegInt(data.outstanding)
  const createdBy = asString(data.createdBy)
  const updatedBy = asString(data.updatedBy)
  if (
    !status ||
    !customerKind ||
    !customerName ||
    !originTransactionId ||
    !productId ||
    !businessDate ||
    originalQuantity === null ||
    settledQuantity === null ||
    outstanding === null ||
    !createdBy ||
    !updatedBy
  ) {
    return null
  }
  return {
    id,
    kind: 'empty_cylinder',
    status,
    customerId: typeof data.customerId === 'string' && data.customerId ? data.customerId : null,
    customerKind,
    customerName,
    originTransactionId,
    productId,
    locationId: typeof data.locationId === 'string' && data.locationId ? data.locationId : null,
    businessDate,
    originalQuantity,
    settledQuantity,
    outstanding,
    createdBy,
    updatedBy,
  }
}

export function summarizeGodownDay(rows: readonly TransactionDoc[]): {
  salesCount: number
  filledIssued: number
  emptyReceived: number
  emptyOutstanding: number
  salePaise: number
  receivedPaise: number
  duePaise: number
} {
  const summary = {
    salesCount: 0,
    filledIssued: 0,
    emptyReceived: 0,
    emptyOutstanding: 0,
    salePaise: 0,
    receivedPaise: 0,
    duePaise: 0,
  }
  for (const row of rows) {
    if (row.status === 'reversed') continue
    if (row.type === 'godown_sale') {
      summary.salesCount += 1
      summary.filledIssued += row.quantities.filledIssued
      summary.emptyReceived += row.quantities.emptyReceived
      // Live outstanding is maintained on the sale when later empty returns post.
      summary.emptyOutstanding += row.quantities.emptyOutstanding
      summary.salePaise += row.amountsPaise.salePaise
      summary.receivedPaise += row.amountsPaise.receivedPaise
      summary.duePaise += row.amountsPaise.duePaise
    } else if (row.type === 'empty_return') {
      summary.emptyReceived += row.quantities.emptyReceived
    }
  }
  return summary
}
