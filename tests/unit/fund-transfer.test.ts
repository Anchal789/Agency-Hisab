import { describe, expect, it } from 'vitest'
import type { ReceivingAccount } from '../../shared/models/agency-config'
import { fundTransferInLedgerId, fundTransferOutLedgerId } from '../../shared/models/finance'
import { createFundTransferSchema } from '../../shared/schemas/finance-hisab'
import {
  fundTransferAccountErrorMessage,
  validateFundTransferAccounts,
} from '../../shared/rules/fund-transfer'
import { canCreateFundTransfer, emptyPermissions } from '../../shared/rules/permissions'

const accounts: ReceivingAccount[] = [
  { id: 'cash1', name: 'Cash', kind: 'cash', active: true, ownership: 'agency' },
  { id: 'bank1', name: 'Bank', kind: 'bank', active: true, ownership: 'agency' },
  { id: 'upi1', name: 'UPI', kind: 'upi', active: true, ownership: 'agency' },
  { id: 'portal1', name: 'Portal', kind: 'indane_portal', active: true, ownership: 'portal' },
  { id: 'old', name: 'Old', kind: 'cash', active: false, ownership: 'agency' },
]

describe('fund transfer account validation', () => {
  it('accepts cash ↔ bank and upi ↔ cash', () => {
    expect(
      validateFundTransferAccounts({
        sourceAccountId: 'cash1',
        destinationAccountId: 'bank1',
        accounts,
      }).ok,
    ).toBe(true)
    expect(
      validateFundTransferAccounts({
        sourceAccountId: 'upi1',
        destinationAccountId: 'cash1',
        accounts,
      }).ok,
    ).toBe(true)
  })

  it('rejects same account, inactive, and portal', () => {
    expect(
      validateFundTransferAccounts({
        sourceAccountId: 'cash1',
        destinationAccountId: 'cash1',
        accounts,
      }),
    ).toEqual({ ok: false, code: 'same_account' })
    expect(
      validateFundTransferAccounts({
        sourceAccountId: 'old',
        destinationAccountId: 'bank1',
        accounts,
      }).ok,
    ).toBe(false)
    expect(
      validateFundTransferAccounts({
        sourceAccountId: 'bank1',
        destinationAccountId: 'portal1',
        accounts,
      }),
    ).toEqual({ ok: false, code: 'destination_portal' })
    expect(fundTransferAccountErrorMessage('same_account')).toMatch(/different/i)
  })
})

describe('fund transfer schema and ids', () => {
  it('rejects zero and negative amounts', () => {
    const base = {
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      transactionId: '22222222-2222-2222-2222-222222222222',
      sourceAccountId: 'cash1',
      destinationAccountId: 'bank1',
      businessDate: '2026-11-23',
    }
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: 0 }).success).toBe(false)
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: -100 }).success).toBe(false)
    expect(createFundTransferSchema.safeParse({ ...base, amountPaise: 100 }).success).toBe(true)
  })

  it('uses deterministic ledger ids', () => {
    expect(fundTransferOutLedgerId('tx1')).toBe('tx1_fund_transfer_out')
    expect(fundTransferInLedgerId('tx1')).toBe('tx1_fund_transfer_in')
  })
})

describe('fund transfer permissions', () => {
  it('allows admin or finance.transfer staff', () => {
    expect(canCreateFundTransfer('admin', emptyPermissions())).toBe(true)
    expect(canCreateFundTransfer('staff', emptyPermissions())).toBe(false)
    expect(canCreateFundTransfer('staff', { ...emptyPermissions(), 'finance.transfer': true })).toBe(true)
  })
})
