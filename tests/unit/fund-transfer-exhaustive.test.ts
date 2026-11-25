import { describe, expect, it } from 'vitest'
import type { ReceivingAccount } from '../../shared/models/agency-config'
import { createFundTransferSchema } from '../../shared/schemas/finance-hisab'
import { validateFundTransferAccounts } from '../../shared/rules/fund-transfer'
import { validateHisabBusinessDate } from '../../shared/rules/hisab-date'
import { rupeesToPaise, MoneyFormatError } from '../../shared/models/money'

const accounts: ReceivingAccount[] = [
  { id: 'cash', name: 'Cash', kind: 'cash', active: true, ownership: 'agency' },
  { id: 'bank', name: 'Bank', kind: 'bank', active: true, ownership: 'agency' },
  { id: 'upi', name: 'UPI', kind: 'upi', active: true, ownership: 'agency' },
  { id: 'agent', name: 'Agent', kind: 'cash', active: true, ownership: 'third_party_held' },
  { id: 'portal', name: 'Portal', kind: 'indane_portal', active: true, ownership: 'portal' },
  { id: 'dead', name: 'Dead', kind: 'cash', active: false, ownership: 'agency' },
]

const base = {
  idempotencyKey: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  transactionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  sourceAccountId: 'cash',
  destinationAccountId: 'bank',
  businessDate: '2026-11-23',
}

describe('B — amount schema / money parsing', () => {
  it('B02/B03 rejects zero and negative paise', () => {
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: 0 }).success).toBe(false)
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: -1 }).success).toBe(false)
  })

  it('B06 accepts ₹100.50 as 10050 paise', () => {
    expect(rupeesToPaise('100.50')).toBe(10050)
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: 10050 }).success).toBe(true)
  })

  it('B07 rejects more than two decimal places', () => {
    expect(() => rupeesToPaise('100.501')).toThrow(MoneyFormatError)
  })

  it('B04/B05 rejects alphabetic and invalid money strings', () => {
    expect(() => rupeesToPaise('abc')).toThrow(MoneyFormatError)
    expect(() => rupeesToPaise('12.3.4')).toThrow(MoneyFormatError)
    expect(() => rupeesToPaise('')).toThrow(MoneyFormatError)
  })

  it('B09 rejects amount above schema max', () => {
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: 1_000_000_001 }).success).toBe(false)
  })
})

describe('C — account validation', () => {
  it('C03 same account rejected', () => {
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'cash', destinationAccountId: 'cash', accounts }),
    ).toEqual({ ok: false, code: 'same_account' })
  })

  it('C04/C05 nonexistent accounts rejected', () => {
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'missing', destinationAccountId: 'bank', accounts }).ok,
    ).toBe(false)
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'cash', destinationAccountId: 'missing', accounts }).ok,
    ).toBe(false)
  })

  it('C06/C07 inactive rejected', () => {
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'dead', destinationAccountId: 'bank', accounts }),
    ).toEqual({ ok: false, code: 'source_inactive' })
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'cash', destinationAccountId: 'dead', accounts }),
    ).toEqual({ ok: false, code: 'destination_inactive' })
  })

  it('H04–H06 agency and third_party allowed; portal rejected', () => {
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'cash', destinationAccountId: 'agent', accounts }).ok,
    ).toBe(true)
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'agent', destinationAccountId: 'bank', accounts }).ok,
    ).toBe(true)
    expect(
      validateFundTransferAccounts({ sourceAccountId: 'cash', destinationAccountId: 'portal', accounts }),
    ).toEqual({ ok: false, code: 'destination_portal' })
  })
})

describe('D — date validation', () => {
  const opening = '2026-11-19'
  const today = '2026-11-23'

  it('D01–D03 accept today, yesterday, opening date', () => {
    expect(validateHisabBusinessDate({ selected: today, financialOpeningDate: opening, today })).toEqual({
      ok: true,
    })
    expect(validateHisabBusinessDate({ selected: '2026-11-22', financialOpeningDate: opening, today })).toEqual({
      ok: true,
    })
    expect(validateHisabBusinessDate({ selected: opening, financialOpeningDate: opening, today })).toEqual({
      ok: true,
    })
  })

  it('D04/D05 reject pre-opening and future', () => {
    expect(
      validateHisabBusinessDate({ selected: '2026-11-18', financialOpeningDate: opening, today }),
    ).toEqual({ ok: false, code: 'before_opening' })
    expect(
      validateHisabBusinessDate({ selected: '2026-11-24', financialOpeningDate: opening, today }),
    ).toEqual({ ok: false, code: 'future' })
  })

  it('D06/D07 reject invalid/empty date strings', () => {
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: 100, businessDate: '' }).success).toBe(
      false,
    )
    expect(
      createFundTransferSchema.safeParse({ ...base, amountPaise: 100, businessDate: '23-11-2026' }).success,
    ).toBe(false)
  })
})
