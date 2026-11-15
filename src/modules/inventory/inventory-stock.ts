import type { LocationDoc, ProductDoc } from '@shared/models/agency-config'
import {
  inventoryBalanceId,
  type InventoryBalanceDoc,
  type InventoryLedgerLine,
  type InventoryMovementType,
  type InventoryOpeningDoc,
  type InventoryState,
} from '@shared/models/inventory'

export type ProductStock = {
  product: ProductDoc
  opened: boolean
  filled: number | null
  empty: number | null
  damaged: number | null
}

export type LocationStock = {
  location: LocationDoc
  filled: number | null
  empty: number | null
  damaged: number | null
  products: ProductStock[]
}

export type LedgerDisplayRow = {
  key: string
  transactionId: string
  businessDate: string
  locationId: string
  productId: string
  movementType: InventoryMovementType
  filledDelta: number
  emptyDelta: number
  damagedDelta: number
  sourceLocationId: string | null
  destinationLocationId: string | null
  note: string
  createdBy: string
  createdAtMs: number | null
}

export function parseQty(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  if (!/^\d+$/.test(trimmed)) return null
  const quantity = Number(trimmed)
  if (!Number.isSafeInteger(quantity) || quantity > 100_000) return null
  return quantity
}

export function buildLocationStock(
  locations: readonly LocationDoc[],
  products: readonly ProductDoc[],
  balances: readonly InventoryBalanceDoc[],
  openings: readonly InventoryOpeningDoc[],
): LocationStock[] {
  const openSet = new Set(openings.map((row) => `${row.locationId}_${row.productId}`))
  const quantities = new Map(balances.map((row) => [row.id, row.quantity]))

  return locations.map((location) => {
    const productRows = products.map((product) => {
      const opened = openSet.has(`${location.id}_${product.id}`)
      const qty = (state: InventoryState): number | null =>
        opened ? (quantities.get(inventoryBalanceId(location.id, product.id, state)) ?? 0) : null
      return {
        product,
        opened,
        filled: qty('filled'),
        empty: qty('empty'),
        damaged: qty('damaged'),
      }
    })
    const openedRows = productRows.filter((row) => row.opened)
    const sum = (key: 'filled' | 'empty' | 'damaged'): number | null =>
      openedRows.length === 0 ? null : openedRows.reduce((total, row) => total + (row[key] ?? 0), 0)
    return {
      location,
      filled: sum('filled'),
      empty: sum('empty'),
      damaged: sum('damaged'),
      products: productRows,
    }
  })
}

export function sumRecorded(rows: readonly LocationStock[], state: 'filled' | 'empty' | 'damaged'): number | null {
  const recorded = rows.filter((row) => row[state] !== null)
  if (recorded.length === 0) return null
  return recorded.reduce((total, row) => total + (row[state] ?? 0), 0)
}

export function countLocationsHolding(
  rows: readonly LocationStock[],
  state: 'filled' | 'empty' | 'damaged',
): number {
  return rows.filter((row) => (row[state] ?? 0) > 0).length
}

export function groupLedgerLines(lines: readonly InventoryLedgerLine[]): LedgerDisplayRow[] {
  const map = new Map<string, LedgerDisplayRow>()
  for (const line of lines) {
    const key = `${line.transactionId}|${line.locationId}|${line.productId}|${line.movementType}`
    const current = map.get(key) ?? {
      key,
      transactionId: line.transactionId,
      businessDate: line.businessDate,
      locationId: line.locationId,
      productId: line.productId,
      movementType: line.movementType,
      filledDelta: 0,
      emptyDelta: 0,
      damagedDelta: 0,
      sourceLocationId: line.sourceLocationId,
      destinationLocationId: line.destinationLocationId,
      note: line.note,
      createdBy: line.createdBy,
      createdAtMs: line.createdAtMs,
    }
    if (line.state === 'filled') current.filledDelta += line.quantityDelta
    if (line.state === 'empty') current.emptyDelta += line.quantityDelta
    if (line.state === 'damaged') current.damagedDelta += line.quantityDelta
    if (!current.note && line.note) current.note = line.note
    if (line.sourceLocationId) current.sourceLocationId = line.sourceLocationId
    if (line.destinationLocationId) current.destinationLocationId = line.destinationLocationId
    if ((line.createdAtMs ?? 0) > (current.createdAtMs ?? 0)) current.createdAtMs = line.createdAtMs
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => {
    const byDate = b.businessDate.localeCompare(a.businessDate)
    if (byDate !== 0) return byDate
    return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)
  })
}

export function movementDirection(
  row: Pick<LedgerDisplayRow, 'movementType' | 'filledDelta' | 'emptyDelta' | 'damagedDelta'>,
): 'in' | 'out' | 'transfer' | 'adjust' {
  if (row.movementType === 'transfer_in' || row.movementType === 'transfer_out') return 'transfer'
  if (row.movementType === 'adjustment') return 'adjust'
  const net = row.filledDelta + row.emptyDelta + row.damagedDelta
  return net >= 0 ? 'in' : 'out'
}
