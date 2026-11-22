import type { CutoverCohort } from '../models/finance'

/**
 * Classify a Godown sale business date relative to financial opening date D and today (Asia/Kolkata).
 * pre_cutover: businessDate <= D
 * post_cutover (bridge when created during sealing / before publish): D < businessDate <= today
 * future_dated: businessDate > today
 */
export function classifyGodownSaleCohort(input: {
  businessDate: string
  openingDate: string
  today: string
}): CutoverCohort {
  const { businessDate, openingDate, today } = input
  if (businessDate <= openingDate) return 'pre_cutover'
  if (businessDate <= today) return 'post_cutover'
  return 'future_dated'
}

export const OPENING_CHUNK_DEFAULT_SALES = 40
export const OPENING_CHUNK_MAX_SALES = 49
export const OPENING_TX_WRITE_BUDGET = 200
export const OPENING_TX_READ_BUDGET = 200
export const OPENING_MAX_DESTINATIONS = 40

/** Worst-case writes per sale in prepareOpeningChunk (bridge with receipt + due). */
export const PREPARE_WRITES_PER_SALE_MAX = 4
export const PREPARE_READS_PER_SALE_MAX = 3
export const PREPARE_OVERHEAD_WRITES = 1
export const PREPARE_OVERHEAD_READS = 5

export function maxSalesForPrepareBudget(): number {
  const byWrites = Math.floor((OPENING_TX_WRITE_BUDGET - PREPARE_OVERHEAD_WRITES) / PREPARE_WRITES_PER_SALE_MAX)
  const byReads = Math.floor((OPENING_TX_READ_BUDGET - PREPARE_OVERHEAD_READS) / PREPARE_READS_PER_SALE_MAX)
  return Math.min(OPENING_CHUNK_MAX_SALES, byWrites, byReads)
}

export function splitSaleIdsForBudget(saleIds: readonly string[], maxSales = OPENING_CHUNK_DEFAULT_SALES): string[][] {
  const limit = Math.min(maxSales, maxSalesForPrepareBudget())
  const parts: string[][] = []
  for (let i = 0; i < saleIds.length; i += limit) {
    parts.push(saleIds.slice(i, i + limit))
  }
  return parts.length > 0 ? parts : [[]]
}

export function publishedBalancePaise(verifiedOpeningPaise: number, bridgeCollectionNetPaise: number): number {
  if (!Number.isSafeInteger(verifiedOpeningPaise) || !Number.isSafeInteger(bridgeCollectionNetPaise)) {
    throw new Error('Opening and bridge amounts must be safe integers.')
  }
  return verifiedOpeningPaise + bridgeCollectionNetPaise
}
