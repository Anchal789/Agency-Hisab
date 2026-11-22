import { describe, expect, it } from 'vitest'
import {
  evaluateOpeningAnchor,
  filledQuantityFromStockReceipt,
  looksLikeTransactionDocumentId,
} from '../../shared/rules/opening-anchor'
import { beginFinancialOpeningSealSchema } from '../../shared/schemas/finance-opening'

const validReceipt = {
  id: '11111111-1111-1111-1111-111111111111',
  type: 'stock_receipt' as const,
  status: 'posted' as const,
  businessDate: '2026-11-22',
  note: 'Load come',
  inventoryPayload: { filledQuantity: 40, emptyQuantity: 0, damagedQuantity: 0 },
  quantities: { filledIssued: 40 },
  reversedByTransactionId: null,
  reversalOf: null,
}

describe('opening anchor eligibility', () => {
  it('accepts a posted stock receipt with filled cylinders and matching date', () => {
    const result = evaluateOpeningAnchor({
      transaction: validReceipt,
      openingDate: '2026-11-22',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.filledQuantity).toBe(40)
    expect(result.businessDate).toBe('2026-11-22')
  })

  it('rejects an arbitrary human reference string as a transaction document id', () => {
    expect(looksLikeTransactionDocumentId('Load come')).toBe(false)
    expect(looksLikeTransactionDocumentId('11111111-1111-1111-1111-111111111111')).toBe(true)
    expect(
      beginFinancialOpeningSealSchema.safeParse({
        idempotencyKey: '22222222-2222-2222-2222-222222222222',
        sessionId: '33333333-3333-3333-3333-333333333333',
        openingDate: '2026-11-22',
        anchorTransactionId: 'Load come',
        anchorDateMismatchReason: null,
      }).success,
    ).toBe(false)
  })

  it('returns not_found for a missing transaction', () => {
    const result = evaluateOpeningAnchor({
      transaction: null,
      openingDate: '2026-11-22',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('not_found')
    expect(result.message).toMatch(/not found/i)
  })

  it('rejects reversed or non-posted receipts', () => {
    expect(
      evaluateOpeningAnchor({
        transaction: { ...validReceipt, status: 'reversed' },
        openingDate: '2026-11-22',
      }).ok,
    ).toBe(false)
    expect(
      evaluateOpeningAnchor({
        transaction: {
          ...validReceipt,
          status: 'posted',
          reversedByTransactionId: 'rev-1',
        },
        openingDate: '2026-11-22',
      }).ok,
    ).toBe(false)
    expect(
      evaluateOpeningAnchor({
        transaction: { ...validReceipt, status: 'pending_approval' },
        openingDate: '2026-11-22',
      }).ok,
    ).toBe(false)
    expect(
      evaluateOpeningAnchor({
        transaction: { ...validReceipt, type: 'stock_opening' },
        openingDate: '2026-11-22',
      }).ok,
    ).toBe(false)
  })

  it('requires a mismatch reason when receipt date differs from opening date', () => {
    const withoutReason = evaluateOpeningAnchor({
      transaction: validReceipt,
      openingDate: '2026-11-21',
    })
    expect(withoutReason.ok).toBe(false)
    if (!withoutReason.ok) expect(withoutReason.code).toBe('date_mismatch')

    const withReason = evaluateOpeningAnchor({
      transaction: validReceipt,
      openingDate: '2026-11-21',
      mismatchReason: 'Receipt booked next calendar day after late unloading',
    })
    expect(withReason.ok).toBe(true)
  })

  it('records filled quantity from inventory payload for the selected receipt', () => {
    expect(filledQuantityFromStockReceipt(validReceipt)).toBe(40)
    expect(
      filledQuantityFromStockReceipt({
        ...validReceipt,
        inventoryPayload: null,
        quantities: { filledIssued: 12 },
      }),
    ).toBe(12)
  })

  it('accepts a valid begin-seal payload that uses a real transaction document id', () => {
    const parsed = beginFinancialOpeningSealSchema.safeParse({
      idempotencyKey: '22222222-2222-2222-2222-222222222222',
      sessionId: '33333333-3333-3333-3333-333333333333',
      openingDate: '2026-11-22',
      anchorTransactionId: validReceipt.id,
      anchorDateMismatchReason: null,
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.anchorTransactionId).toBe(validReceipt.id)
  })
})
