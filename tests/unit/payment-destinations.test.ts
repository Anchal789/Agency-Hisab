import { describe, expect, it } from 'vitest'
import {
  inferPaymentCategoryFromName,
  normalizePaymentCategory,
  parseAgencySettings,
  type PaymentMethod,
  type ReceivingAccount,
} from '../../shared/models/agency-config'
import {
  destinationsForPaymentMethod,
  isDestinationCompatibleWithPaymentMethod,
} from '../../shared/rules/payment-destinations'
import { manageAgencyConfigSchema } from '../../shared/schemas/agency-settings'

const accounts: ReceivingAccount[] = [
  { id: 'ra_cash', name: 'Cash Counter', kind: 'cash', active: true },
  { id: 'ra_anchal', name: 'Anchal', kind: 'upi', active: true },
  { id: 'ra_dp', name: 'D.P. Ji', kind: 'upi', active: true },
  { id: 'ra_nikhil', name: 'Nikhil', kind: 'upi', active: true },
  { id: 'ra_bank', name: 'Agency Bank Account', kind: 'bank', active: true },
  { id: 'ra_portal', name: 'Portal', kind: 'indane_portal', active: true },
  { id: 'ra_other', name: 'Misc', kind: 'other', active: true },
  { id: 'ra_old_upi', name: 'Old UPI', kind: 'upi', active: false },
]

const methods: Record<string, PaymentMethod> = {
  cash: { id: 'pm_cash', name: 'Cash', kind: 'cash', active: true },
  upi: { id: 'pm_upi', name: 'UPI', kind: 'upi', active: true },
  bank: { id: 'pm_bank', name: 'Bank', kind: 'bank', active: true },
  portal: { id: 'pm_portal', name: 'Indane Portal', kind: 'indane_portal', active: true },
  other: { id: 'pm_other', name: 'Other', kind: 'other', active: true },
}

describe('canonical payment categories', () => {
  it('normalizes legacy portal to indane_portal', () => {
    expect(normalizePaymentCategory('portal')).toBe('indane_portal')
    expect(normalizePaymentCategory('indane_portal')).toBe('indane_portal')
    expect(normalizePaymentCategory('Cash')).toBe('cash')
  })

  it('infers categories from legacy payment method names', () => {
    expect(inferPaymentCategoryFromName('Online')).toBe('upi')
    expect(inferPaymentCategoryFromName('Portal')).toBe('indane_portal')
    expect(inferPaymentCategoryFromName('Cash')).toBe('cash')
    expect(inferPaymentCategoryFromName('Bank Transfer')).toBe('bank')
  })

  it('parses legacy agency docs without dropping destinations', () => {
    const parsed = parseAgencySettings({
      paymentMethods: [
        { id: 'pm1', name: 'Online', active: true },
        { id: 'pm2', name: 'Portal', active: true },
        { id: 'pm3', name: 'Cash', active: true },
      ],
      receivingAccounts: [
        { id: 'ra1', name: 'Anchal', kind: 'upi', active: true },
        { id: 'ra2', name: 'Portal', kind: 'portal', active: true },
        { id: 'ra3', name: 'Cash Counter', kind: 'cash', active: true },
      ],
    })
    expect(parsed.paymentMethods.map((row) => ({ name: row.name, kind: row.kind }))).toEqual([
      { name: 'UPI', kind: 'upi' },
      { name: 'Indane Portal', kind: 'indane_portal' },
      { name: 'Cash', kind: 'cash' },
    ])
    expect(parsed.receivingAccounts.map((row) => ({ name: row.name, kind: row.kind }))).toEqual([
      { name: 'Anchal', kind: 'upi' },
      { name: 'Portal', kind: 'indane_portal' },
      { name: 'Cash Counter', kind: 'cash' },
    ])
  })
})

describe('destination filtering by payment method category', () => {
  it('filters Cash destinations only', () => {
    expect(destinationsForPaymentMethod(methods.cash, accounts).map((row) => row.name)).toEqual(['Cash Counter'])
  })

  it('filters UPI destinations only', () => {
    expect(destinationsForPaymentMethod(methods.upi, accounts).map((row) => row.name)).toEqual([
      'Anchal',
      'D.P. Ji',
      'Nikhil',
    ])
  })

  it('filters Bank destinations only', () => {
    expect(destinationsForPaymentMethod(methods.bank, accounts).map((row) => row.name)).toEqual([
      'Agency Bank Account',
    ])
  })

  it('filters Indane Portal destinations only', () => {
    expect(destinationsForPaymentMethod(methods.portal, accounts).map((row) => row.name)).toEqual(['Portal'])
  })

  it('filters Other destinations only', () => {
    expect(destinationsForPaymentMethod(methods.other, accounts).map((row) => row.name)).toEqual(['Misc'])
  })

  it('clears incompatible destination when payment method changes', () => {
    const previous = 'ra_anchal'
    const allowed = destinationsForPaymentMethod(methods.cash, accounts)
    const stillValid = allowed.some((row) => row.id === previous)
    expect(stillValid).toBe(false)
  })

  it('rejects mismatched destination for backend-style checks', () => {
    expect(isDestinationCompatibleWithPaymentMethod(methods.cash, accounts[0])).toBe(true)
    expect(isDestinationCompatibleWithPaymentMethod(methods.cash, accounts[1])).toBe(false)
    expect(isDestinationCompatibleWithPaymentMethod(methods.upi, accounts[5])).toBe(false)
  })

  it('includes newly added destinations for the matching category', () => {
    const withNew = [
      ...accounts,
      { id: 'ra_new_upi', name: 'New UPI Wallet', kind: 'upi' as const, active: true },
    ]
    expect(destinationsForPaymentMethod(methods.upi, withNew).map((row) => row.name)).toContain('New UPI Wallet')
  })
})

describe('settings save schema for payment categories', () => {
  it('accepts payment methods and destinations with canonical kinds', () => {
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'setPaymentMethods',
        payload: {
          items: [{ id: 'pm_upi', name: 'UPI', kind: 'upi', active: true }],
        },
      }).success,
    ).toBe(true)
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'setReceivingAccounts',
        payload: {
          items: [{ id: 'ra1', name: 'Portal', kind: 'portal', active: true }],
        },
      }).success,
    ).toBe(true)
  })

  it('rejects payment methods without a kind', () => {
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'setPaymentMethods',
        payload: {
          items: [{ id: 'pm1', name: 'Online', active: true }],
        },
      }).success,
    ).toBe(false)
  })
})
