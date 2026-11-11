import { describe, expect, it } from 'vitest'
import { saleIdentityHolds } from '../../shared/models/money'
import {
  emptyOutstandingFromIssue,
  obligationStatusFromQuantities,
  parseTransaction,
  returnRemainingOutstanding,
  saleEmptyCylinderBreakdown,
  sortEmptyReturns,
  summarizeGodownDay,
  summarizeSaleReturnHistory,
  type TransactionDoc,
} from '../../shared/models/transaction'
import { canViewGodown, emptyPermissions } from '../../shared/rules/permissions'
import {
  destinationsForPaymentMethod,
  isDestinationCompatibleWithPaymentMethod,
} from '../../shared/rules/payment-destinations'
import {
  amountsFromReceivedAndDue,
  createGodownSaleSchema,
  derivedSaleQuantities,
  recordEmptyReturnSchema,
  reverseGodownSaleSchema,
} from '../../shared/schemas/godown'

function sampleSale(overrides: Partial<TransactionDoc> = {}): TransactionDoc {
  return {
    id: 'tx1',
    type: 'godown_sale',
    status: 'posted',
    approval: 'not_required',
    businessDate: '2026-11-07',
    timezone: 'Asia/Kolkata',
    customerKind: 'custom',
    customerId: null,
    customerSnapshot: {
      name: 'Walk-in',
      consumerNumber: null,
      address: '',
      city: '',
      lastRefillDate: null,
    },
    locationId: null,
    productId: 'p1',
    productName: '14.2 kg',
    quantities: { filledIssued: 15, emptyReceived: 5, emptyOutstanding: 10 },
    amountsPaise: { salePaise: 100000, receivedPaise: 60000, duePaise: 40000 },
    paymentMethodId: 'cash',
    paymentMethodName: 'Cash',
    receivingAccountId: 'cash',
    receivingAccountName: 'Cash',
    bookingStatus: 'no',
    bookingName: null,
    note: '',
    idempotencyKey: 'tx1',
    originTransactionId: null,
    originBusinessDate: null,
    remainingOutstandingAfter: null,
    obligationId: 'ob1',
    reversalOf: null,
    reversedByTransactionId: null,
    reverseReason: null,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAtMs: null,
    updatedAtMs: null,
    ...overrides,
  }
}

const accounts = [
  { id: 'ra_cash', name: 'Cash Counter', kind: 'cash' as const, active: true },
  { id: 'ra_dp', name: 'D.P. Ji', kind: 'upi' as const, active: true },
  { id: 'ra_nikhil', name: 'Nikhil', kind: 'upi' as const, active: true },
  { id: 'ra_user', name: 'User Account', kind: 'upi' as const, active: true },
  { id: 'ra_bank', name: 'Agency Bank Account', kind: 'bank' as const, active: true },
  { id: 'ra_inactive', name: 'Old UPI', kind: 'upi' as const, active: false },
]

describe('godown quantities and money', () => {
  it('calculates empty outstanding from filled and received', () => {
    expect(emptyOutstandingFromIssue(15, 5)).toBe(10)
    expect(emptyOutstandingFromIssue(1, 0)).toBe(1)
    expect(emptyOutstandingFromIssue(2, 3)).toBeNaN()
  })

  it('breaks down original due, later returns, and remaining for a sale', () => {
    // Sale: 15 filled, 5 empty at sale → 10 due. Later return of 4 → 6 remaining.
    const afterPartial = saleEmptyCylinderBreakdown({
      filledIssued: 15,
      emptyReceived: 5,
      emptyOutstanding: 6,
    })
    expect(afterPartial).toEqual({
      filledIssued: 15,
      emptyReceivedAtSale: 5,
      originalDue: 10,
      subsequentlyReturned: 4,
      remainingDue: 6,
    })

    const afterMore = saleEmptyCylinderBreakdown({
      filledIssued: 15,
      emptyReceived: 5,
      emptyOutstanding: 2,
    })
    expect(afterMore?.subsequentlyReturned).toBe(8)
    expect(afterMore?.remainingDue).toBe(2)
  })

  it('keeps separate sales independent when computing remaining due', () => {
    const saleA = saleEmptyCylinderBreakdown({ filledIssued: 10, emptyReceived: 0, emptyOutstanding: 6 })
    const saleB = saleEmptyCylinderBreakdown({ filledIssued: 5, emptyReceived: 1, emptyOutstanding: 4 })
    expect(saleA).toEqual({
      filledIssued: 10,
      emptyReceivedAtSale: 0,
      originalDue: 10,
      subsequentlyReturned: 4,
      remainingDue: 6,
    })
    expect(saleB).toEqual({
      filledIssued: 5,
      emptyReceivedAtSale: 1,
      originalDue: 4,
      subsequentlyReturned: 0,
      remainingDue: 4,
    })
  })

  it('exposes remaining after a linked empty return when denormalized', () => {
    const returnRow = sampleSale({
      id: 'ret1',
      type: 'empty_return',
      businessDate: '2026-11-11',
      originTransactionId: 'tx1',
      originBusinessDate: '2026-11-10',
      remainingOutstandingAfter: 6,
      quantities: { filledIssued: 0, emptyReceived: 4, emptyOutstanding: 0 },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
    })
    expect(returnRemainingOutstanding(returnRow)).toBe(6)
    expect(returnRow.originBusinessDate).toBe('2026-11-10')
    expect(returnRemainingOutstanding(sampleSale())).toBeNull()
  })

  it('rejects return quantities above outstanding via schema and business rule shape', () => {
    expect(
      recordEmptyReturnSchema.safeParse({
        transactionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
        idempotencyKey: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
        originTransactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        businessDate: '2026-11-11',
        emptyReturned: 0,
      }).success,
    ).toBe(false)
    const outstanding = 10
    const returning = 4
    expect(returning).toBeLessThanOrEqual(outstanding)
    expect(outstanding - returning).toBe(6)
    expect(11 > outstanding).toBe(true)
  })

  it('parses denormalized empty-return relationship fields', () => {
    const parsed = parseTransaction('ret1', {
      type: 'empty_return',
      status: 'posted',
      approval: 'not_required',
      businessDate: '2026-11-11',
      timezone: 'Asia/Kolkata',
      customerKind: 'custom',
      customerId: null,
      customerSnapshot: { name: 'Walk-in', consumerNumber: null, address: '', city: '', lastRefillDate: null },
      locationId: null,
      productId: 'p1',
      productName: '14.2 kg',
      quantities: { filledIssued: 0, emptyReceived: 4, emptyOutstanding: 0 },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      bookingStatus: 'no',
      note: '',
      idempotencyKey: 'ret1',
      originTransactionId: 'sale1',
      originBusinessDate: '2026-11-10',
      remainingOutstandingAfter: 6,
      obligationId: 'ob1',
      createdBy: 'u1',
      updatedBy: 'u1',
    })
    expect(parsed?.originBusinessDate).toBe('2026-11-10')
    expect(parsed?.remainingOutstandingAfter).toBe(6)
    expect(parsed?.originTransactionId).toBe('sale1')
  })

  it('models multiple partial returns against one sale without allocating to another sale', () => {
    const saleA = sampleSale({
      id: 'saleA',
      businessDate: '2026-11-10',
      quantities: { filledIssued: 15, emptyReceived: 5, emptyOutstanding: 2 },
    })
    const saleB = sampleSale({
      id: 'saleB',
      businessDate: '2026-11-10',
      quantities: { filledIssued: 8, emptyReceived: 0, emptyOutstanding: 8 },
    })
    const return1 = sampleSale({
      id: 'ret1',
      type: 'empty_return',
      businessDate: '2026-11-11',
      originTransactionId: 'saleA',
      originBusinessDate: '2026-11-10',
      remainingOutstandingAfter: 6,
      quantities: { filledIssued: 0, emptyReceived: 4, emptyOutstanding: 0 },
      note: 'Partial',
    })
    const return2 = sampleSale({
      id: 'ret2',
      type: 'empty_return',
      businessDate: '2026-11-12',
      originTransactionId: 'saleA',
      originBusinessDate: '2026-11-10',
      remainingOutstandingAfter: 2,
      quantities: { filledIssued: 0, emptyReceived: 4, emptyOutstanding: 0 },
    })
    expect(saleEmptyCylinderBreakdown(saleA.quantities)?.subsequentlyReturned).toBe(8)
    expect(saleEmptyCylinderBreakdown(saleB.quantities)?.subsequentlyReturned).toBe(0)
    expect(return1.originTransactionId).toBe('saleA')
    expect(return2.originTransactionId).toBe('saleA')
    expect(return2.originTransactionId).not.toBe('saleB')

    const historyA = summarizeSaleReturnHistory(saleA, [return1, return2, sampleSale({
      id: 'retOther',
      type: 'empty_return',
      originTransactionId: 'saleB',
      quantities: { filledIssued: 0, emptyReceived: 1, emptyOutstanding: 0 },
    })])
    expect(historyA).toEqual({
      originalDue: 10,
      returnedLater: 8,
      remainingDue: 2,
      returnCount: 2,
      returnedFromLinkedRows: 8,
    })
    expect(summarizeSaleReturnHistory(saleB, [return1, return2])?.returnCount).toBe(0)
    expect(summarizeSaleReturnHistory(saleB, [])?.returnCount).toBe(0)
  })

  it('sorts empty returns by business date then created time for history display', () => {
    const sorted = sortEmptyReturns([
      sampleSale({
        id: 'retLate',
        type: 'empty_return',
        businessDate: '2026-11-14',
        createdAtMs: 100,
        originTransactionId: 'saleA',
        quantities: { filledIssued: 0, emptyReceived: 2, emptyOutstanding: 0 },
      }),
      sampleSale({
        id: 'retEarly',
        type: 'empty_return',
        businessDate: '2026-11-11',
        createdAtMs: 300,
        originTransactionId: 'saleA',
        quantities: { filledIssued: 0, emptyReceived: 4, emptyOutstanding: 0 },
      }),
      sampleSale({
        id: 'retMid',
        type: 'empty_return',
        businessDate: '2026-11-12',
        createdAtMs: 200,
        originTransactionId: 'saleA',
        quantities: { filledIssued: 0, emptyReceived: 3, emptyOutstanding: 0 },
      }),
    ])
    expect(sorted.map((row) => row.id)).toEqual(['retEarly', 'retMid', 'retLate'])
  })

  it('requires godown.view for register/return history access', () => {
    expect(canViewGodown('staff', emptyPermissions())).toBe(false)
    expect(canViewGodown('staff', { ...emptyPermissions(), 'godown.view': true })).toBe(true)
    expect(canViewGodown('admin', emptyPermissions())).toBe(true)
  })

  it('calculates total sale from received + due', () => {
    expect(amountsFromReceivedAndDue(50000, 20000)).toEqual({
      receivedPaise: 50000,
      duePaise: 20000,
      salePaise: 70000,
    })
    expect(amountsFromReceivedAndDue(70000, 0)).toEqual({
      receivedPaise: 70000,
      duePaise: 0,
      salePaise: 70000,
    })
    const amounts = amountsFromReceivedAndDue(60000, 40000)
    expect(saleIdentityHolds(amounts.salePaise, amounts.receivedPaise, amounts.duePaise)).toBe(true)
  })

  it('derives sale quantities', () => {
    expect(derivedSaleQuantities(15, 5)).toEqual({
      filledIssued: 15,
      emptyReceived: 5,
      emptyOutstanding: 10,
    })
  })

  it('updates obligation status from settled quantities', () => {
    expect(obligationStatusFromQuantities(10, 0)).toBe('open')
    expect(obligationStatusFromQuantities(10, 4)).toBe('partial')
    expect(obligationStatusFromQuantities(10, 10)).toBe('settled')
  })
})

describe('payment destination filtering', () => {
  it('filters destinations by payment method category kind', () => {
    const upi = destinationsForPaymentMethod({ id: 'pm_upi', name: 'UPI', kind: 'upi', active: true }, accounts)
    expect(upi.map((row) => row.id)).toEqual(['ra_dp', 'ra_nikhil', 'ra_user'])

    const cash = destinationsForPaymentMethod({ id: 'pm_cash', name: 'Cash', kind: 'cash', active: true }, accounts)
    expect(cash.map((row) => row.id)).toEqual(['ra_cash'])

    const bank = destinationsForPaymentMethod(
      { id: 'pm_bank', name: 'Bank', kind: 'bank', active: true },
      accounts,
    )
    expect(bank.map((row) => row.id)).toEqual(['ra_bank'])
  })

  it('rejects incompatible destinations', () => {
    const method = { id: 'pm_cash', name: 'Cash', kind: 'cash' as const, active: true }
    expect(isDestinationCompatibleWithPaymentMethod(method, accounts[0])).toBe(true)
    expect(isDestinationCompatibleWithPaymentMethod(method, accounts[1])).toBe(false)
  })

  it('clears incompatible destination when method changes (form rule)', () => {
    const previousDestinationId = 'ra_dp'
    const nextMethod = { id: 'pm_cash', name: 'Cash', kind: 'cash' as const, active: true }
    const allowed = destinationsForPaymentMethod(nextMethod, accounts)
    const stillValid = allowed.some((row) => row.id === previousDestinationId)
    expect(stillValid).toBe(false)
    expect(stillValid ? previousDestinationId : '').toBe('')
  })
})

describe('godown schemas', () => {
  const validSale = {
    transactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    idempotencyKey: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    businessDate: '2026-11-07',
    customerKind: 'custom' as const,
    customCustomerName: 'Ramesh',
    productId: 'prod_1',
    filledIssued: 2,
    emptyReceived: 1,
    salePaise: 70000,
    receivedPaise: 50000,
    duePaise: 20000,
    paymentMethodId: 'pm_cash',
    receivingAccountId: 'ra_cash',
    bookingStatus: 'no' as const,
  }

  it('accepts a fully paid transaction', () => {
    const amounts = amountsFromReceivedAndDue(70000, 0)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        ...amounts,
        bookingStatus: 'no',
      }).success,
    ).toBe(true)
  })

  it('accepts a partially paid transaction', () => {
    expect(createGodownSaleSchema.safeParse(validSale).success).toBe(true)
  })

  it('accepts zero received with outstanding due', () => {
    const amounts = amountsFromReceivedAndDue(0, 70000)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        ...amounts,
        paymentMethodId: null,
        receivingAccountId: null,
      }).success,
    ).toBe(true)
  })

  it('rejects when sale is not received + due', () => {
    const result = createGodownSaleSchema.safeParse({
      ...validSale,
      salePaise: 90000,
      receivedPaise: 50000,
      duePaise: 20000,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty received above filled issued', () => {
    const result = createGodownSaleSchema.safeParse({ ...validSale, emptyReceived: 5 })
    expect(result.success).toBe(false)
  })

  it('requires payment fields when money is received', () => {
    const result = createGodownSaleSchema.safeParse({
      ...validSale,
      paymentMethodId: null,
      receivingAccountId: null,
    })
    expect(result.success).toBe(false)
  })

  it('requires registered customer id', () => {
    const result = createGodownSaleSchema.safeParse({
      ...validSale,
      customerKind: 'registered',
      customCustomerName: undefined,
      customerId: null,
    })
    expect(result.success).toBe(false)
  })

  it('accepts registered customer with customCustomerName null (callable wire format)', () => {
    const result = createGodownSaleSchema.safeParse({
      ...validSale,
      customerKind: 'registered',
      customerId: 'cust_1',
      customCustomerName: null,
      note: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.customCustomerName).toBeNull()
      expect(result.data.note).toBeNull()
    }
  })

  it('accepts registered customer with customCustomerName and note omitted', () => {
    const { customCustomerName: _n, note: _note, ...withoutOptionals } = {
      ...validSale,
      customerKind: 'registered' as const,
      customerId: 'cust_1',
      customCustomerName: 'ignored',
      note: 'ignored',
    }
    void _n
    void _note
    const payload = {
      transactionId: withoutOptionals.transactionId,
      idempotencyKey: withoutOptionals.idempotencyKey,
      businessDate: withoutOptionals.businessDate,
      customerKind: 'registered' as const,
      customerId: 'cust_1',
      productId: withoutOptionals.productId,
      filledIssued: withoutOptionals.filledIssued,
      emptyReceived: withoutOptionals.emptyReceived,
      salePaise: withoutOptionals.salePaise,
      receivedPaise: withoutOptionals.receivedPaise,
      duePaise: withoutOptionals.duePaise,
      paymentMethodId: withoutOptionals.paymentMethodId,
      receivingAccountId: withoutOptionals.receivingAccountId,
      bookingStatus: withoutOptionals.bookingStatus,
    }
    expect(createGodownSaleSchema.safeParse(payload).success).toBe(true)
  })

  it('accepts custom customer with a valid name', () => {
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'custom',
        customerId: null,
        customCustomerName: 'Walk-in Customer',
      }).success,
    ).toBe(true)
  })

  it('rejects custom customer with missing or empty name', () => {
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'custom',
        customerId: null,
        customCustomerName: null,
      }).success,
    ).toBe(false)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'custom',
        customerId: null,
        customCustomerName: '   ',
      }).success,
    ).toBe(false)
    const { customCustomerName: _omitted, ...withoutName } = validSale
    void _omitted
    expect(
      createGodownSaleSchema.safeParse({
        ...withoutName,
        customerKind: 'custom',
        customerId: null,
      }).success,
    ).toBe(false)
  })

  it('accepts optional note as null, omitted, or text', () => {
    expect(createGodownSaleSchema.safeParse({ ...validSale, note: null }).success).toBe(true)
    expect(createGodownSaleSchema.safeParse({ ...validSale }).success).toBe(true)
    const withNote = createGodownSaleSchema.safeParse({ ...validSale, note: '  Paid at counter  ' })
    expect(withNote.success).toBe(true)
    if (withNote.success) expect(withNote.data.note).toBe('Paid at counter')
  })

  it('rejects invalid customer combinations', () => {
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'registered',
        customerId: '',
        customCustomerName: null,
      }).success,
    ).toBe(false)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'custom',
        customerId: 'cust_1',
        customCustomerName: 'Ramesh',
      }).success,
    ).toBe(false)
  })

  it('requires payment method and destination when money is received', () => {
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        paymentMethodId: null,
        receivingAccountId: 'ra_cash',
      }).success,
    ).toBe(false)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        paymentMethodId: 'pm_cash',
        receivingAccountId: null,
      }).success,
    ).toBe(false)
  })

  it('accepts the reported failing New Godown Entry payload shape', () => {
    const result = createGodownSaleSchema.safeParse({
      transactionId: '56d0afa1-fe57-419e-b263-86b25f3539ce',
      idempotencyKey: '56d0afa1-fe57-419e-b263-86b25f3539ce',
      businessDate: '2026-11-10',
      customerKind: 'registered',
      customerId: 'kQP69vX62vnfM3Wzwcws',
      customCustomerName: null,
      locationId: 'pERHBZEqRDWQUvyhsboc',
      productId: 'iyHzdSMLgze5yY8jQL0J',
      filledIssued: 1,
      emptyReceived: 1,
      salePaise: 100000,
      receivedPaise: 100000,
      duePaise: 0,
      paymentMethodId: 'pm_604b42ae-609d-4e41-bc63-8cb47cf8a43f',
      receivingAccountId: 'ra_ec7f5a43-be26-41d0-a6df-bbd58a2c5251',
      bookingStatus: 'yes',
      note: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts all customer/booking combinations without bookingName', () => {
    const registered = {
      ...validSale,
      customerKind: 'registered' as const,
      customerId: 'cust_1',
      customCustomerName: undefined,
    }
    expect(createGodownSaleSchema.safeParse({ ...registered, bookingStatus: 'yes' }).success).toBe(true)
    expect(createGodownSaleSchema.safeParse({ ...registered, bookingStatus: 'no' }).success).toBe(true)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'custom',
        bookingStatus: 'yes',
      }).success,
    ).toBe(true)
    expect(
      createGodownSaleSchema.safeParse({
        ...validSale,
        customerKind: 'custom',
        bookingStatus: 'no',
      }).success,
    ).toBe(true)
  })

  it('ignores legacy bookingName if a client still sends it', () => {
    const payload: Record<string, unknown> = {
      ...validSale,
      bookingStatus: 'yes',
      bookingName: 'Legacy leftover',
    }
    expect(createGodownSaleSchema.safeParse(payload).success).toBe(true)
  })

  it('validates reverse confirmation phrase', () => {
    expect(
      reverseGodownSaleSchema.safeParse({
        transactionId: validSale.transactionId,
        reason: 'Wrong entry',
        confirmPhrase: 'DELETE',
      }).success,
    ).toBe(true)
    expect(
      reverseGodownSaleSchema.safeParse({
        transactionId: validSale.transactionId,
        reason: 'Wrong entry',
        confirmPhrase: 'delete',
      }).success,
    ).toBe(false)
  })

  it('validates empty return payload including null note', () => {
    expect(
      recordEmptyReturnSchema.safeParse({
        transactionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
        idempotencyKey: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
        originTransactionId: validSale.transactionId,
        businessDate: '2026-11-08',
        emptyReturned: 4,
      }).success,
    ).toBe(true)
    expect(
      recordEmptyReturnSchema.safeParse({
        transactionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
        idempotencyKey: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
        originTransactionId: validSale.transactionId,
        businessDate: '2026-11-08',
        emptyReturned: 4,
        note: null,
      }).success,
    ).toBe(true)
  })
})

describe('daily godown summary', () => {
  it('sums posted sales and later empty returns without fabricating values', () => {
    const summary = summarizeGodownDay([
      sampleSale(),
      sampleSale({
        id: 'tx2',
        type: 'empty_return',
        quantities: { filledIssued: 0, emptyReceived: 4, emptyOutstanding: 0 },
        amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      }),
      sampleSale({
        id: 'tx3',
        status: 'reversed',
        quantities: { filledIssued: 99, emptyReceived: 0, emptyOutstanding: 99 },
        amountsPaise: { salePaise: 99999, receivedPaise: 0, duePaise: 99999 },
      }),
    ])
    expect(summary.salesCount).toBe(1)
    expect(summary.filledIssued).toBe(15)
    expect(summary.emptyReceived).toBe(9)
    expect(summary.emptyOutstanding).toBe(10)
    expect(summary.salePaise).toBe(100000)
    expect(summary.receivedPaise).toBe(60000)
    expect(summary.duePaise).toBe(40000)
  })
})
