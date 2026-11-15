import { describe, expect, it } from 'vitest'
import { buildLocationStock, groupLedgerLines, parseQty, sumRecorded } from '../../src/modules/inventory/inventory-stock'
import {
  applyBalanceDeltas,
  inventoryBalanceId,
  inventoryLedgerEntryId,
  inventoryOpeningId,
  isInventoryCutoverEligible,
  isInventoryTransactionType,
  reconciliationDeltas,
  summarizeBalancesByState,
  type InventoryBalanceDoc,
} from '../../shared/models/inventory'
import {
  createStockOpeningSchema,
  createStockTransferSchema,
  rejectInventoryTransactionSchema,
} from '../../shared/schemas/inventory'
import {
  canCreateInventoryOpening,
  canCreateInventoryReceive,
  canCreateInventoryReconcile,
  canCreateInventoryTransfer,
  canViewInventory,
  emptyPermissions,
} from '../../shared/rules/permissions'

describe('inventory stock display helpers', () => {
  it('keeps unopened location stock as not recorded instead of zero', () => {
    const locations = [
      { id: 'g1', name: 'Main', kind: 'godown' as const, active: true },
      { id: 'v1', name: 'Van', kind: 'vehicle' as const, active: true },
    ]
    const products = [{ id: 'p1', name: '14.2', code: 'D', kind: 'cylinder' as const, unit: 'cylinder', active: true }]
    const rows = buildLocationStock(
      locations,
      products,
      [{ id: 'g1_p1_filled', locationId: 'g1', productId: 'p1', state: 'filled', quantity: 4, updatedByTransactionId: null, updatedAtMs: null }],
      [{ id: 'g1_p1', locationId: 'g1', productId: 'p1', openingTransactionId: 't1', businessDate: '2026-11-12', createdBy: 'a' }],
    )
    expect(rows[0]?.filled).toBe(4)
    expect(rows[0]?.empty).toBe(0)
    expect(rows[1]?.filled).toBeNull()
    expect(sumRecorded(rows, 'filled')).toBe(4)
    expect(parseQty('')).toBe(0)
    expect(parseQty('2')).toBe(2)
    expect(parseQty('1.5')).toBeNull()
  })

  it('groups ledger lines so filled and empty changes stay on one movement', () => {
    const grouped = groupLedgerLines([
      {
        id: 'a',
        transactionId: 'tx',
        businessDate: '2026-11-12',
        locationId: 'g1',
        productId: 'p1',
        state: 'filled',
        quantityDelta: -2,
        sourceLocationId: 'g1',
        destinationLocationId: 'v1',
        movementType: 'transfer_out',
        note: '',
        createdBy: 'a',
        createdAtMs: 1,
      },
      {
        id: 'b',
        transactionId: 'tx',
        businessDate: '2026-11-12',
        locationId: 'g1',
        productId: 'p1',
        state: 'empty',
        quantityDelta: -1,
        sourceLocationId: 'g1',
        destinationLocationId: 'v1',
        movementType: 'transfer_out',
        note: 'shift',
        createdBy: 'a',
        createdAtMs: 2,
      },
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.filledDelta).toBe(-2)
    expect(grouped[0]?.emptyDelta).toBe(-1)
    expect(grouped[0]?.note).toBe('shift')
  })
})

describe('inventory cutover gate', () => {
  it('blocks when cutover is unset or date is before cutover', () => {
    expect(isInventoryCutoverEligible('2026-11-11', null)).toBe(false)
    expect(isInventoryCutoverEligible('2026-11-10', '2026-11-11')).toBe(false)
    expect(isInventoryCutoverEligible('2026-11-11', '2026-11-11')).toBe(true)
    expect(isInventoryCutoverEligible('2026-11-12', '2026-11-11')).toBe(true)
  })
})

describe('inventory balance math', () => {
  it('applies signed deltas and rejects negative results unless allowed', () => {
    const current = new Map([[inventoryBalanceId('g1', 'p1', 'filled'), 5]])
    const ok = applyBalanceDeltas(
      current,
      [{ locationId: 'g1', productId: 'p1', state: 'filled', quantityDelta: -2 }],
      false,
    )
    expect(ok?.get(inventoryBalanceId('g1', 'p1', 'filled'))).toBe(3)

    const blocked = applyBalanceDeltas(
      current,
      [{ locationId: 'g1', productId: 'p1', state: 'filled', quantityDelta: -6 }],
      false,
    )
    expect(blocked).toBeNull()

    const allowed = applyBalanceDeltas(
      current,
      [{ locationId: 'g1', productId: 'p1', state: 'filled', quantityDelta: -6 }],
      true,
    )
    expect(allowed?.get(inventoryBalanceId('g1', 'p1', 'filled'))).toBe(-1)
  })

  it('computes transfer as out+in netting to zero across locations', () => {
    const current = new Map([
      [inventoryBalanceId('a', 'p1', 'filled'), 10],
      [inventoryBalanceId('b', 'p1', 'filled'), 1],
    ])
    const next = applyBalanceDeltas(
      current,
      [
        { locationId: 'a', productId: 'p1', state: 'filled', quantityDelta: -4 },
        { locationId: 'b', productId: 'p1', state: 'filled', quantityDelta: 4 },
      ],
      false,
    )
    expect(next?.get(inventoryBalanceId('a', 'p1', 'filled'))).toBe(6)
    expect(next?.get(inventoryBalanceId('b', 'p1', 'filled'))).toBe(5)
  })

  it('builds reconciliation variance deltas and skips zero rows', () => {
    expect(
      reconciliationDeltas({
        locationId: 'g1',
        productId: 'p1',
        systemFilled: 10,
        systemEmpty: 2,
        systemDamaged: 0,
        actualFilled: 9,
        actualEmpty: 2,
        actualDamaged: 1,
      }),
    ).toEqual([
      { locationId: 'g1', productId: 'p1', state: 'filled', quantityDelta: -1 },
      { locationId: 'g1', productId: 'p1', state: 'damaged', quantityDelta: 1 },
    ])
  })

  it('summarizes balances by state without inventing zeros for missing docs', () => {
    const rows: InventoryBalanceDoc[] = [
      {
        id: 'g1_p1_filled',
        locationId: 'g1',
        productId: 'p1',
        state: 'filled',
        quantity: 7,
        updatedByTransactionId: 't1',
        updatedAtMs: null,
      },
    ]
    expect(summarizeBalancesByState(rows)).toEqual({ filled: 7, empty: 0, damaged: 0 })
  })
})

describe('inventory ids and types', () => {
  it('uses deterministic opening/balance/ledger ids', () => {
    expect(inventoryOpeningId('loc', 'prod')).toBe('loc_prod')
    expect(inventoryBalanceId('loc', 'prod', 'empty')).toBe('loc_prod_empty')
    expect(inventoryLedgerEntryId('tx1', 'loc', 'prod', 'filled', 0)).toBe('tx1_loc_prod_filled_0')
  })

  it('recognizes inventory transaction types', () => {
    expect(isInventoryTransactionType('stock_opening')).toBe(true)
    expect(isInventoryTransactionType('godown_sale')).toBe(false)
  })
})

describe('inventory schemas', () => {
  const validOpening = {
    transactionId: '717fc204-31de-427a-aa83-e761fbbc8f79',
    idempotencyKey: '717fc204-31de-427a-aa83-e761fbbc8f79',
    businessDate: '2026-11-14',
    locationId: 'OqPyR2IkjT0EPYZKr9mC',
    productId: 'pr0leQMG6016qHDWHm9r',
    filledQuantity: 150,
    emptyQuantity: 100,
    damagedQuantity: 3,
  }

  it('requires at least one opening quantity and distinct transfer locations', () => {
    expect(
      createStockOpeningSchema.safeParse({
        transactionId: 'tx-open-1',
        idempotencyKey: 'tx-open-1',
        businessDate: '2026-11-11',
        locationId: 'g1',
        productId: 'p1',
        filledQuantity: 0,
        emptyQuantity: 0,
        damagedQuantity: 0,
      }).success,
    ).toBe(false)

    expect(
      createStockTransferSchema.safeParse({
        transactionId: 'tx-tr-1',
        idempotencyKey: 'tx-tr-1',
        businessDate: '2026-11-11',
        sourceLocationId: 'g1',
        destinationLocationId: 'g1',
        productId: 'p1',
        state: 'filled',
        quantity: 1,
      }).success,
    ).toBe(false)

    expect(
      rejectInventoryTransactionSchema.safeParse({
        transactionId: 'tx-1',
        reason: 'no',
      }).success,
    ).toBe(false)
  })

  it('accepts note as null, omitted, or a trimmed string for opening stock', () => {
    expect(createStockOpeningSchema.safeParse({ ...validOpening, note: null }).success).toBe(true)
    expect(createStockOpeningSchema.safeParse(validOpening).success).toBe(true)
    const withNote = createStockOpeningSchema.safeParse({ ...validOpening, note: '  first count  ' })
    expect(withNote.success).toBe(true)
    if (withNote.success) expect(withNote.data.note).toBe('first count')
  })

  it('rejects empty location or product ids without inventing defaults', () => {
    expect(createStockOpeningSchema.safeParse({ ...validOpening, locationId: '' }).success).toBe(false)
    expect(createStockOpeningSchema.safeParse({ ...validOpening, productId: '   ' }).success).toBe(false)
  })
})

describe('godown inventory ledger line shapes', () => {
  it('models sale as −filled and +empty received only; reverse flips signs', () => {
    const saleDeltas = [
      { locationId: 'g1', productId: 'p1', state: 'filled' as const, quantityDelta: -2 },
      { locationId: 'g1', productId: 'p1', state: 'empty' as const, quantityDelta: 1 },
    ]
    const afterSale = applyBalanceDeltas(
      new Map([
        [inventoryBalanceId('g1', 'p1', 'filled'), 20],
        [inventoryBalanceId('g1', 'p1', 'empty'), 3],
      ]),
      saleDeltas,
      false,
    )
    expect(afterSale?.get(inventoryBalanceId('g1', 'p1', 'filled'))).toBe(18)
    expect(afterSale?.get(inventoryBalanceId('g1', 'p1', 'empty'))).toBe(4)

    const reverse = saleDeltas.map((row) => ({ ...row, quantityDelta: -row.quantityDelta }))
    const afterReverse = applyBalanceDeltas(afterSale!, reverse, false)
    expect(afterReverse?.get(inventoryBalanceId('g1', 'p1', 'filled'))).toBe(20)
    expect(afterReverse?.get(inventoryBalanceId('g1', 'p1', 'empty'))).toBe(3)
  })

  it('models empty return as +empty at the receive location without touching filled', () => {
    const next = applyBalanceDeltas(
      new Map([[inventoryBalanceId('recv', 'p1', 'empty'), 0]]),
      [{ locationId: 'recv', productId: 'p1', state: 'empty', quantityDelta: 2 }],
      false,
    )
    expect(next?.get(inventoryBalanceId('recv', 'p1', 'empty'))).toBe(2)
    expect(next?.has(inventoryBalanceId('recv', 'p1', 'filled'))).toBe(false)
  })
})

describe('inventory permissions', () => {
  it('gates inventory capabilities by staff permission flags; admin always allowed', () => {
    const none = emptyPermissions()
    expect(canViewInventory('admin', none)).toBe(true)
    expect(canViewInventory('staff', none)).toBe(false)
    expect(canCreateInventoryOpening('staff', { ...none, 'inventory.openingStock': true })).toBe(true)
    expect(canCreateInventoryTransfer('staff', { ...none, 'inventory.transfer': true })).toBe(true)
    expect(canCreateInventoryReceive('staff', { ...none, 'inventory.receive': true })).toBe(true)
    expect(canCreateInventoryReconcile('staff', { ...none, 'inventory.reconcile': true })).toBe(true)
  })
})
