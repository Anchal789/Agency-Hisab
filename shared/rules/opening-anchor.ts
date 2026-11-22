/**
 * Pure eligibility checks for the Financial Opening plant stock-receipt anchor.
 * Backend and unit tests share this; Firestore lookups stay in Cloud Functions / UI queries.
 */

export type OpeningAnchorTransaction = {
  id: string
  type: string
  status: string
  businessDate: string
  note?: string | null
  quantities?: { filledIssued?: number } | null
  inventoryPayload?: Record<string, unknown> | null
  reversedByTransactionId?: string | null
  reversalOf?: string | null
}

export type OpeningAnchorEvaluation =
  | { ok: true; filledQuantity: number; businessDate: string }
  | { ok: false; code: OpeningAnchorErrorCode; message: string }

export type OpeningAnchorErrorCode =
  | 'not_found'
  | 'invalid_type'
  | 'not_posted'
  | 'reversed'
  | 'no_filled'
  | 'date_mismatch'

export function filledQuantityFromStockReceipt(tx: OpeningAnchorTransaction): number {
  const fromPayload = Number(tx.inventoryPayload?.filledQuantity)
  if (Number.isSafeInteger(fromPayload) && fromPayload >= 0) return fromPayload
  const fromQuantities = Number(tx.quantities?.filledIssued)
  if (Number.isSafeInteger(fromQuantities) && fromQuantities >= 0) return fromQuantities
  return 0
}

/**
 * Evaluate whether a loaded transaction may anchor financial opening.
 * Caller supplies null when the document id does not exist.
 */
export function evaluateOpeningAnchor(args: {
  transaction: OpeningAnchorTransaction | null
  openingDate: string
  mismatchReason?: string | null
}): OpeningAnchorEvaluation {
  const { transaction, openingDate } = args
  const mismatchReason = args.mismatchReason?.trim() || null

  if (!transaction) {
    return {
      ok: false,
      code: 'not_found',
      message: 'Anchor consignment transaction not found.',
    }
  }

  if (transaction.type !== 'stock_receipt') {
    return {
      ok: false,
      code: 'invalid_type',
      message: 'Anchor must be a posted filled-cylinder plant receipt.',
    }
  }

  if (transaction.status === 'reversed' || transaction.reversedByTransactionId) {
    return {
      ok: false,
      code: 'reversed',
      message: 'This stock receipt has been reversed and cannot anchor financial opening.',
    }
  }

  if (transaction.status !== 'posted') {
    return {
      ok: false,
      code: 'not_posted',
      message: 'Anchor must be a posted filled-cylinder plant receipt.',
    }
  }

  const filledQuantity = filledQuantityFromStockReceipt(transaction)
  if (filledQuantity < 1) {
    return {
      ok: false,
      code: 'no_filled',
      message: 'Anchor stock receipt must include at least one filled cylinder.',
    }
  }

  const businessDate = String(transaction.businessDate ?? '')
  if (businessDate !== openingDate && !mismatchReason) {
    return {
      ok: false,
      code: 'date_mismatch',
      message: 'Provide an audited reason when the anchor date does not match the opening date.',
    }
  }

  return { ok: true, filledQuantity, businessDate }
}

/** Document ids are UUID-like; human receipt notes (with spaces) must never be accepted as ids. */
export function looksLikeTransactionDocumentId(value: string): boolean {
  const trimmed = value.trim()
  return /^[A-Za-z0-9_-]{8,80}$/.test(trimmed)
}
