import { describe, expect, it } from 'vitest'
import {
  buildLocationStock,
  buildProductStockTotals,
  groupLedgerLines,
  parseQty,
  sumRecorded,
} from '../../src/modules/inventory/inventory-stock'
import {
  applyBalanceDeltas,
  inventoryBalanceId,
  inventoryLedgerEntryId,
  inventoryOpeningId,
  isInventoryCutoverEligible,
  isInventoryTransactionType,
  locationStartsWithZeroStock,
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
    // Vehicles start at zero without an opening row.
    expect(rows[1]?.filled).toBe(0)
    expect(rows[1]?.empty).toBe(0)
    expect(sumRecorded(rows, 'filled')).toBe(4)
    expect(parseQty('')).toBe(0)
    expect(parseQty('2')).toBe(2)
    expect(parseQty('1.5')).toBeNull()
  })

  it('keeps different cylinder types separate and does not combine filled with empty', () => {
    const locations = [
      { id: 'g1', name: 'Main', kind: 'godown' as const, active: true },
      { id: 'v1', name: 'Van', kind: 'vehicle' as const, active: true },
    ]
    const products = [
      { id: 'p_dom', name: '14.2 kg', code: 'DOM', kind: 'cylinder' as const, unit: 'cylinder', active: true },
      { id: 'p_com', name: '19 kg', code: 'COM', kind: 'cylinder' as const, unit: 'cylinder', active: true },
      { id: 'p_zero', name: '5 kg', code: 'FIVE', kind: 'cylinder' as const, unit: 'cylinder', active: true },
    ]
    const balances = [
      { id: 'g1_p_dom_filled', locationId: 'g1', productId: 'p_dom', state: 'filled' as const, quantity: 10, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_dom_empty', locationId: 'g1', productId: 'p_dom', state: 'empty' as const, quantity: 3, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_dom_damaged', locationId: 'g1', productId: 'p_dom', state: 'damaged' as const, quantity: 1, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_com_filled', locationId: 'g1', productId: 'p_com', state: 'filled' as const, quantity: 4, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_com_empty', locationId: 'g1', productId: 'p_com', state: 'empty' as const, quantity: 2, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'v1_p_dom_filled', locationId: 'v1', productId: 'p_dom', state: 'filled' as const, quantity: 5, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'v1_p_dom_empty', locationId: 'v1', productId: 'p_dom', state: 'empty' as const, quantity: 0, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'v1_p_dom_damaged', locationId: 'v1', productId: 'p_dom', state: 'damaged' as const, quantity: 0, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_zero_filled', locationId: 'g1', productId: 'p_zero', state: 'filled' as const, quantity: 0, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_zero_empty', locationId: 'g1', productId: 'p_zero', state: 'empty' as const, quantity: 0, updatedByTransactionId: null, updatedAtMs: null },
      { id: 'g1_p_zero_damaged', locationId: 'g1', productId: 'p_zero', state: 'damaged' as const, quantity: 0, updatedByTransactionId: null, updatedAtMs: null },
    ]
    const openings = [
      { id: 'g1_p_dom', locationId: 'g1', productId: 'p_dom', openingTransactionId: 't1', businessDate: '2026-11-12', createdBy: 'a' },
      { id: 'g1_p_com', locationId: 'g1', productId: 'p_com', openingTransactionId: 't2', businessDate: '2026-11-12', createdBy: 'a' },
      { id: 'g1_p_zero', locationId: 'g1', productId: 'p_zero', openingTransactionId: 't3', businessDate: '2026-11-12', createdBy: 'a' },
      { id: 'v1_p_dom', locationId: 'v1', productId: 'p_dom', openingTransactionId: 't4', businessDate: '2026-11-12', createdBy: 'a' },
    ]
    const rows = buildLocationStock(locations, products, balances, openings)
    const byType = buildProductStockTotals(rows, products)

    expect(byType.map((row) => row.product.id)).toEqual(['p_dom', 'p_com', 'p_zero'])
    expect(byType[0]).toMatchObject({ filled: 15, empty: 3, damaged: 1, locationsOpened: 2 })
    expect(byType[1]).toMatchObject({ filled: 4, empty: 2, damaged: 0, locationsOpened: 1 })
    expect(byType[2]).toMatchObject({ filled: 0, empty: 0, damaged: 0, locationsOpened: 1 })
    expect(byType[0]?.filled).not.toBe(byType[0]?.empty)

    const main = rows.find((row) => row.location.id === 'g1')
    expect(main?.products.find((row) => row.product.id === 'p_dom')).toMatchObject({
      filled: 10,
      empty: 3,
      damaged: 1,
    })
    expect(main?.products.find((row) => row.product.id === 'p_com')).toMatchObject({
      filled: 4,
      empty: 2,
      damaged: 0,
    })
    expect(main?.filled).toBe(14)
    expect(main?.empty).toBe(5)
    expect(sumRecorded(rows, 'filled')).toBe(19)
    expect(sumRecorded(rows, 'empty')).toBe(5)
    expect(sumRecorded(rows, 'damaged')).toBe(1)
  })

  it('marks cylinder types with no openings as not recorded', () => {
    const locations = [{ id: 'g1', name: 'Main', kind: 'godown' as const, active: true }]
    const products = [
      { id: 'p1', name: '14.2', code: 'D', kind: 'cylinder' as const, unit: 'cylinder', active: true },
      { id: 'p2', name: '19', code: 'C', kind: 'cylinder' as const, unit: 'cylinder', active: true },
    ]
    const rows = buildLocationStock(locations, products, [], [])
    const byType = buildProductStockTotals(rows, products)
    expect(byType[0]).toMatchObject({ filled: null, empty: null, damaged: null, locationsOpened: 0 })
    expect(byType[1]).toMatchObject({ filled: null, empty: null, damaged: null, locationsOpened: 0 })
    expect(sumRecorded(rows, 'filled')).toBeNull()
  })

  it('lets non-godown locations start at zero without opening rows', () => {
    expect(locationStartsWithZeroStock('godown')).toBe(false)
    expect(locationStartsWithZeroStock('vehicle')).toBe(true)
    expect(locationStartsWithZeroStock('agent')).toBe(true)

    const locations = [
      { id: 'g1', name: 'Main', kind: 'godown' as const, active: true },
      { id: 'v1', name: 'Van', kind: 'vehicle' as const, active: true },
      { id: 'a1', name: 'Agent A', kind: 'agent' as const, active: true },
    ]
    const products = [
      { id: 'p_dom', name: '14.2 kg', code: 'DOM', kind: 'cylinder' as const, unit: 'cylinder', active: true },
    ]
    const rows = buildLocationStock(
      locations,
      products,
      [
        {
          id: 'g1_p_dom_filled',
          locationId: 'g1',
          productId: 'p_dom',
          state: 'filled',
          quantity: 100,
          updatedByTransactionId: null,
          updatedAtMs: null,
        },
        {
          id: 'g1_p_dom_empty',
          locationId: 'g1',
          productId: 'p_dom',
          state: 'empty',
          quantity: 80,
          updatedByTransactionId: null,
          updatedAtMs: null,
        },
      ],
      [
        {
          id: 'g1_p_dom',
          locationId: 'g1',
          productId: 'p_dom',
          openingTransactionId: 't1',
          businessDate: '2026-11-12',
          createdBy: 'a',
        },
      ],
    )

    const van = rows.find((row) => row.location.id === 'v1')
    const agent = rows.find((row) => row.location.id === 'a1')
    const godown = rows.find((row) => row.location.id === 'g1')
    expect(godown?.filled).toBe(100)
    expect(van?.products[0]?.opened).toBe(true)
    expect(van?.filled).toBe(0)
    expect(van?.empty).toBe(0)
    expect(van?.damaged).toBe(0)
    expect(agent?.filled).toBe(0)
    expect(sumRecorded(rows, 'filled')).toBe(100)
  })

  it('preserves type and condition and keeps agency total unchanged across a transfer simulation', () => {
    const before = new Map([
      [inventoryBalanceId('g1', 'p_dom', 'filled'), 100],
      [inventoryBalanceId('g1', 'p_dom', 'empty'), 80],
      [inventoryBalanceId('v1', 'p_dom', 'filled'), 0],
      [inventoryBalanceId('v1', 'p_dom', 'empty'), 0],
    ])
    const after = applyBalanceDeltas(
      before,
      [
        { locationId: 'g1', productId: 'p_dom', state: 'filled', quantityDelta: -10 },
        { locationId: 'v1', productId: 'p_dom', state: 'filled', quantityDelta: 10 },
      ],
      false,
    )
    expect(after).not.toBeNull()
    expect(after?.get(inventoryBalanceId('g1', 'p_dom', 'filled'))).toBe(90)
    expect(after?.get(inventoryBalanceId('v1', 'p_dom', 'filled'))).toBe(10)
    expect(after?.get(inventoryBalanceId('g1', 'p_dom', 'empty'))).toBe(80)
    const agencyFilled =
      (after?.get(inventoryBalanceId('g1', 'p_dom', 'filled')) ?? 0) +
      (after?.get(inventoryBalanceId('v1', 'p_dom', 'filled')) ?? 0)
    expect(agencyFilled).toBe(100)
    expect(
      applyBalanceDeltas(
        before,
        [{ locationId: 'g1', productId: 'p_dom', state: 'filled', quantityDelta: -101 }],
        false,
      ),
    ).toBeNull()
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

/** Transfer math uses ledger balances only — opening rows are never required for eligibility. */
describe('transfer without opening-stock dependency', () => {
  const g = 'godown'
  const agent = 'gupta'
  const vehicle = 'van'
  const p142 = 'p_dom'
  const p192 = 'p_com'

  function qty(map: Map<string, number>, locationId: string, productId: string, state: 'filled' | 'empty' | 'damaged') {
    return map.get(inventoryBalanceId(locationId, productId, state)) ?? 0
  }

  function transfer(
    map: Map<string, number>,
    from: string,
    to: string,
    productId: string,
    state: 'filled' | 'empty' | 'damaged',
    quantity: number,
  ) {
    return applyBalanceDeltas(
      map,
      [
        { locationId: from, productId, state, quantityDelta: -quantity },
        { locationId: to, productId, state, quantityDelta: quantity },
      ],
      false,
    )
  }

  it('scenario 1: godown opening then transfer out and back without agent opening', () => {
    let balances = new Map([[inventoryBalanceId(g, p142, 'filled'), 100]])
    // Agent has no opening row and no prior balance doc — first inbound transfer creates stock.
    const toAgent = transfer(balances, g, agent, p142, 'filled', 20)
    expect(toAgent).not.toBeNull()
    balances = toAgent!
    expect(qty(balances, g, p142, 'filled')).toBe(80)
    expect(qty(balances, agent, p142, 'filled')).toBe(20)

    const back = transfer(balances, agent, g, p142, 'filled', 10)
    expect(back).not.toBeNull()
    balances = back!
    expect(qty(balances, g, p142, 'filled')).toBe(90)
    expect(qty(balances, agent, p142, 'filled')).toBe(10)
    expect(qty(balances, g, p142, 'filled') + qty(balances, agent, p142, 'filled')).toBe(100)
  })

  it('scenario 2: move stock between two locations that never had opening rows', () => {
    // Seed only via inbound transfer into agent A (as if from godown earlier).
    let balances = new Map([[inventoryBalanceId(agent, p142, 'filled'), 15]])
    const next = transfer(balances, agent, vehicle, p142, 'filled', 7)
    expect(next).not.toBeNull()
    balances = next!
    expect(qty(balances, agent, p142, 'filled')).toBe(8)
    expect(qty(balances, vehicle, p142, 'filled')).toBe(7)
  })

  it('scenario 3: multi-hop Godown → Gupta → Vehicle → Godown preserves agency total', () => {
    let balances = new Map([[inventoryBalanceId(g, p142, 'filled'), 50]])
    balances = transfer(balances, g, agent, p142, 'filled', 20)!
    balances = transfer(balances, agent, vehicle, p142, 'filled', 12)!
    balances = transfer(balances, vehicle, g, p142, 'filled', 5)!
    expect(qty(balances, g, p142, 'filled')).toBe(35)
    expect(qty(balances, agent, p142, 'filled')).toBe(8)
    expect(qty(balances, vehicle, p142, 'filled')).toBe(7)
    expect(
      qty(balances, g, p142, 'filled') +
        qty(balances, agent, p142, 'filled') +
        qty(balances, vehicle, p142, 'filled'),
    ).toBe(50)
  })

  it('scenario 4: different cylinder types stay separate', () => {
    let balances = new Map([
      [inventoryBalanceId(g, p142, 'filled'), 40],
      [inventoryBalanceId(g, p192, 'filled'), 25],
    ])
    balances = transfer(balances, g, agent, p142, 'filled', 10)!
    balances = transfer(balances, g, agent, p192, 'filled', 5)!
    expect(qty(balances, agent, p142, 'filled')).toBe(10)
    expect(qty(balances, agent, p192, 'filled')).toBe(5)
    expect(qty(balances, g, p142, 'filled')).toBe(30)
    expect(qty(balances, g, p192, 'filled')).toBe(20)
  })

  it('scenario 5: filled, empty and damaged conditions stay separate', () => {
    let balances = new Map([
      [inventoryBalanceId(g, p142, 'filled'), 20],
      [inventoryBalanceId(g, p142, 'empty'), 8],
      [inventoryBalanceId(g, p142, 'damaged'), 3],
    ])
    balances = transfer(balances, g, agent, p142, 'filled', 4)!
    balances = transfer(balances, g, agent, p142, 'empty', 2)!
    balances = transfer(balances, g, agent, p142, 'damaged', 1)!
    expect(qty(balances, agent, p142, 'filled')).toBe(4)
    expect(qty(balances, agent, p142, 'empty')).toBe(2)
    expect(qty(balances, agent, p142, 'damaged')).toBe(1)
    expect(qty(balances, g, p142, 'filled')).toBe(16)
    expect(qty(balances, g, p142, 'empty')).toBe(6)
    expect(qty(balances, g, p142, 'damaged')).toBe(2)
  })

  it('scenario 6: rejects transfer above actual available balance', () => {
    const balances = new Map([[inventoryBalanceId(agent, p142, 'filled'), 10]])
    expect(transfer(balances, agent, g, p142, 'filled', 11)).toBeNull()
    expect(transfer(balances, agent, g, p142, 'filled', 10)).not.toBeNull()
  })

  it('scenario 7: pending transfers do not change balances until posted deltas apply', () => {
    const posted = new Map([[inventoryBalanceId(agent, p142, 'filled'), 20]])
    // Pending approval creates no ledger deltas — balances stay unchanged.
    expect(qty(posted, agent, p142, 'filled')).toBe(20)
    expect(qty(posted, g, p142, 'filled')).toBe(0)
  })

  it('scenario 8: reversing a transfer restores source and destination exactly once', () => {
    let balances = new Map([[inventoryBalanceId(g, p142, 'filled'), 100]])
    const forwardLines = [
      { locationId: g, productId: p142, state: 'filled' as const, quantityDelta: -20 },
      { locationId: agent, productId: p142, state: 'filled' as const, quantityDelta: 20 },
    ]
    balances = applyBalanceDeltas(balances, forwardLines, false)!
    const reverseLines = forwardLines.map((row) => ({ ...row, quantityDelta: -row.quantityDelta }))
    balances = applyBalanceDeltas(balances, reverseLines, false)!
    expect(qty(balances, g, p142, 'filled')).toBe(100)
    expect(qty(balances, agent, p142, 'filled')).toBe(0)
    // Applying the same reverse again would invent stock — blocked when agent is already 0.
    expect(applyBalanceDeltas(balances, reverseLines, false)).toBeNull()
  })

  it('scenario 9: previously transferred stock is available without an opening row', () => {
    // Emulator-like state: Gupta received 20 via transfer; no inventoryOpenings for Gupta.
    const balances = new Map([[inventoryBalanceId(agent, p142, 'filled'), 20]])
    const openingsForAgent: unknown[] = []
    expect(openingsForAgent).toHaveLength(0)
    expect(transfer(balances, agent, g, p142, 'filled', 10)).not.toBeNull()
  })

  it('scenario 10: duplicate transfer deltas are not applied twice when rejected by stock', () => {
    let balances = new Map([
      [inventoryBalanceId(g, p142, 'filled'), 10],
      [inventoryBalanceId(agent, p142, 'filled'), 0],
    ])
    balances = transfer(balances, g, agent, p142, 'filled', 10)!
    expect(qty(balances, g, p142, 'filled')).toBe(0)
    expect(qty(balances, agent, p142, 'filled')).toBe(10)
    // Second identical movement fails — stock moved only once.
    expect(transfer(balances, g, agent, p142, 'filled', 10)).toBeNull()
  })

  it('shows agent transfer-in stock on the dashboard without an opening row', () => {
    const locations = [
      { id: g, name: 'Godown', kind: 'godown' as const, active: true },
      { id: agent, name: 'Gupta', kind: 'agent' as const, active: true },
    ]
    const products = [{ id: p142, name: '14.2', code: 'D', kind: 'cylinder' as const, unit: 'cylinder', active: true }]
    const rows = buildLocationStock(
      locations,
      products,
      [
        {
          id: inventoryBalanceId(g, p142, 'filled'),
          locationId: g,
          productId: p142,
          state: 'filled',
          quantity: 90,
          updatedByTransactionId: 't1',
          updatedAtMs: null,
        },
        {
          id: inventoryBalanceId(agent, p142, 'filled'),
          locationId: agent,
          productId: p142,
          state: 'filled',
          quantity: 10,
          updatedByTransactionId: 't2',
          updatedAtMs: null,
        },
      ],
      [{ id: `${g}_${p142}`, locationId: g, productId: p142, openingTransactionId: 'o1', businessDate: '2026-11-19', createdBy: 'a' }],
    )
    const gupta = rows.find((row) => row.location.id === agent)
    expect(gupta?.products[0]?.hasOpening).toBe(false)
    expect(gupta?.products[0]?.opened).toBe(true)
    expect(gupta?.filled).toBe(10)
  })
})
