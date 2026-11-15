/** Phase 4 inventory ledger, balances, openings, and stock helpers. */

export const INVENTORY_STATES = ['filled', 'empty', 'damaged'] as const
export type InventoryState = (typeof INVENTORY_STATES)[number]

export const INVENTORY_TRANSACTION_TYPES = [
  'stock_opening',
  'stock_receipt',
  'stock_return_distributor',
  'stock_transfer',
  'stock_reconciliation',
] as const
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number]

export const INVENTORY_MOVEMENT_TYPES = [
  'opening',
  'distributor_receipt',
  'distributor_return',
  'transfer_out',
  'transfer_in',
  'customer_sale',
  'empty_received_at_sale',
  'empty_return',
  'adjustment',
  'damaged',
] as const
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number]

export type InventoryLedgerLine = {
  id: string
  transactionId: string
  businessDate: string
  locationId: string
  productId: string
  state: InventoryState
  quantityDelta: number
  sourceLocationId: string | null
  destinationLocationId: string | null
  movementType: InventoryMovementType
  note: string
  createdBy: string
  createdAtMs: number | null
}

export type InventoryBalanceDoc = {
  id: string
  locationId: string
  productId: string
  state: InventoryState
  quantity: number
  updatedByTransactionId: string | null
  updatedAtMs: number | null
}

export type InventoryOpeningDoc = {
  id: string
  locationId: string
  productId: string
  openingTransactionId: string
  businessDate: string
  createdBy: string
}

export function isInventoryState(value: unknown): value is InventoryState {
  return value === 'filled' || value === 'empty' || value === 'damaged'
}

export function isInventoryTransactionType(value: unknown): value is InventoryTransactionType {
  return (
    value === 'stock_opening' ||
    value === 'stock_receipt' ||
    value === 'stock_return_distributor' ||
    value === 'stock_transfer' ||
    value === 'stock_reconciliation'
  )
}

export function isInventoryMovementType(value: unknown): value is InventoryMovementType {
  return (INVENTORY_MOVEMENT_TYPES as readonly string[]).includes(String(value))
}

export function inventoryBalanceId(locationId: string, productId: string, state: InventoryState): string {
  return `${locationId}_${productId}_${state}`
}

export function inventoryOpeningId(locationId: string, productId: string): string {
  return `${locationId}_${productId}`
}

export function inventoryLedgerEntryId(
  transactionId: string,
  locationId: string,
  productId: string,
  state: InventoryState,
  seq: number,
): string {
  return `${transactionId}_${locationId}_${productId}_${state}_${seq}`
}

/** Whether a godown business date may write inventory after cutover. */
export function isInventoryCutoverEligible(
  businessDate: string,
  inventoryCutoverDate: string | null | undefined,
): boolean {
  if (!inventoryCutoverDate || !/^\d{4}-\d{2}-\d{2}$/.test(inventoryCutoverDate)) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return false
  return businessDate >= inventoryCutoverDate
}

export type BalanceDelta = {
  locationId: string
  productId: string
  state: InventoryState
  quantityDelta: number
}

/** Apply signed deltas to a quantity map; returns null if any resulting quantity would be negative. */
export function applyBalanceDeltas(
  current: ReadonlyMap<string, number>,
  deltas: readonly BalanceDelta[],
  allowNegative: boolean,
): Map<string, number> | null {
  const next = new Map(current)
  for (const delta of deltas) {
    if (!Number.isSafeInteger(delta.quantityDelta) || delta.quantityDelta === 0) continue
    const id = inventoryBalanceId(delta.locationId, delta.productId, delta.state)
    const before = next.get(id) ?? 0
    const after = before + delta.quantityDelta
    if (!Number.isSafeInteger(after)) return null
    if (after < 0 && !allowNegative) return null
    next.set(id, after)
  }
  return next
}

export function reconciliationDeltas(input: {
  locationId: string
  productId: string
  systemFilled: number
  systemEmpty: number
  systemDamaged: number
  actualFilled: number
  actualEmpty: number
  actualDamaged: number
}): BalanceDelta[] {
  const rows: BalanceDelta[] = [
    {
      locationId: input.locationId,
      productId: input.productId,
      state: 'filled',
      quantityDelta: input.actualFilled - input.systemFilled,
    },
    {
      locationId: input.locationId,
      productId: input.productId,
      state: 'empty',
      quantityDelta: input.actualEmpty - input.systemEmpty,
    },
    {
      locationId: input.locationId,
      productId: input.productId,
      state: 'damaged',
      quantityDelta: input.actualDamaged - input.systemDamaged,
    },
  ]
  return rows.filter((row) => row.quantityDelta !== 0)
}

function asNonNegInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function timestampToMs(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { toMillis?: () => number; seconds?: number }
  if (typeof row.toMillis === 'function') return row.toMillis()
  if (typeof row.seconds === 'number') return row.seconds * 1000
  return null
}

export function parseInventoryLedger(id: string, data: Record<string, unknown>): InventoryLedgerLine | null {
  const transactionId = typeof data.transactionId === 'string' ? data.transactionId : null
  const businessDate = typeof data.businessDate === 'string' ? data.businessDate : null
  const locationId = typeof data.locationId === 'string' ? data.locationId : null
  const productId = typeof data.productId === 'string' ? data.productId : null
  const state = isInventoryState(data.state) ? data.state : null
  const quantityDelta =
    typeof data.quantityDelta === 'number' && Number.isSafeInteger(data.quantityDelta) ? data.quantityDelta : null
  const movementType = isInventoryMovementType(data.movementType) ? data.movementType : null
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy : null
  if (
    !transactionId ||
    !businessDate ||
    !locationId ||
    !productId ||
    !state ||
    quantityDelta === null ||
    !movementType ||
    !createdBy
  ) {
    return null
  }
  return {
    id,
    transactionId,
    businessDate,
    locationId,
    productId,
    state,
    quantityDelta,
    sourceLocationId: typeof data.sourceLocationId === 'string' ? data.sourceLocationId : null,
    destinationLocationId: typeof data.destinationLocationId === 'string' ? data.destinationLocationId : null,
    movementType,
    note: typeof data.note === 'string' ? data.note.trim() : '',
    createdBy,
    createdAtMs: timestampToMs(data.createdAt),
  }
}

export function parseInventoryBalance(id: string, data: Record<string, unknown>): InventoryBalanceDoc | null {
  const locationId = typeof data.locationId === 'string' ? data.locationId : null
  const productId = typeof data.productId === 'string' ? data.productId : null
  const state = isInventoryState(data.state) ? data.state : null
  const quantity = asNonNegInt(data.quantity)
  if (!locationId || !productId || !state || quantity === null) return null
  return {
    id,
    locationId,
    productId,
    state,
    quantity,
    updatedByTransactionId:
      typeof data.updatedByTransactionId === 'string' ? data.updatedByTransactionId : null,
    updatedAtMs: timestampToMs(data.updatedAt),
  }
}

export function parseInventoryOpening(id: string, data: Record<string, unknown>): InventoryOpeningDoc | null {
  const locationId = typeof data.locationId === 'string' ? data.locationId : null
  const productId = typeof data.productId === 'string' ? data.productId : null
  const openingTransactionId = typeof data.openingTransactionId === 'string' ? data.openingTransactionId : null
  const businessDate = typeof data.businessDate === 'string' ? data.businessDate : null
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy : null
  if (!locationId || !productId || !openingTransactionId || !businessDate || !createdBy) return null
  return { id, locationId, productId, openingTransactionId, businessDate, createdBy }
}

export function summarizeBalancesByState(
  rows: readonly InventoryBalanceDoc[],
): Record<InventoryState, number> {
  const summary: Record<InventoryState, number> = { filled: 0, empty: 0, damaged: 0 }
  for (const row of rows) {
    summary[row.state] += row.quantity
  }
  return summary
}
