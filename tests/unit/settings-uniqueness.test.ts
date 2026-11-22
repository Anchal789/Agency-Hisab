import { describe, expect, it } from 'vitest'
import { manageAgencyConfigSchema } from '../../shared/schemas/agency-settings'
import {
  findDuplicateConfigKeyInList,
  isDuplicateAmong,
  locationUniquenessKey,
  normalizeConfigName,
  paymentMethodUniquenessKey,
  priceRuleUniquenessKey,
  productCodeUniquenessKey,
  productNameUniquenessKey,
  receivingAccountUniquenessKey,
} from '../../shared/rules/settings-uniqueness'

describe('settings uniqueness helpers', () => {
  it('normalizes trim and case', () => {
    expect(normalizeConfigName('  Anchal  ')).toBe('anchal')
    expect(normalizeConfigName('ANCHAL')).toBe('anchal')
  })

  it('allows Anchal Cash and Anchal UPI destinations', () => {
    const items = [
      { id: 'ra1', name: 'Anchal', kind: 'cash', active: true },
      { id: 'ra2', name: 'Anchal', kind: 'upi', active: true },
    ]
    expect(findDuplicateConfigKeyInList(items, receivingAccountUniquenessKey)).toBeNull()
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'setReceivingAccounts',
        payload: {
          items: [
            {
              id: 'ra1',
              name: 'Anchal',
              kind: 'cash',
              active: true,
              ownership: 'agency',
              compatiblePaymentMethodIds: ['pm_cash'],
            },
            {
              id: 'ra2',
              name: 'Anchal',
              kind: 'upi',
              active: true,
              ownership: 'agency',
              compatiblePaymentMethodIds: ['pm_upi'],
            },
          ],
        },
      }).success,
    ).toBe(true)
  })

  it('rejects Anchal Cash entered twice', () => {
    const items = [
      { id: 'ra1', name: 'Anchal', kind: 'cash', active: true },
      { id: 'ra2', name: 'Anchal', kind: 'cash', active: true },
    ]
    expect(findDuplicateConfigKeyInList(items, receivingAccountUniquenessKey)).not.toBeNull()
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'setReceivingAccounts',
        payload: {
          items: [
            { id: 'ra1', name: 'Anchal', kind: 'cash', active: true },
            { id: 'ra2', name: 'Anchal', kind: 'cash', active: true },
          ],
        },
      }).success,
    ).toBe(false)
  })

  it('rejects case and whitespace variants as duplicates in the same category', () => {
    const items = [
      { id: 'pm1', name: 'Cash', kind: 'cash', active: true },
      { id: 'pm2', name: '  cash ', kind: 'cash', active: true },
    ]
    expect(findDuplicateConfigKeyInList(items, paymentMethodUniquenessKey)).not.toBeNull()
  })

  it('allows editing an existing record without treating it as a duplicate of itself', () => {
    const items = [
      { id: 'ra1', name: 'Anchal', kind: 'cash', active: true },
      { id: 'ra2', name: 'Maharashtra Bank', kind: 'bank', active: true },
    ]
    expect(
      isDuplicateAmong(
        items,
        { id: 'ra1' },
        receivingAccountUniquenessKey({ name: 'Anchal', kind: 'cash' }),
        receivingAccountUniquenessKey,
      ),
    ).toBe(false)
  })

  it('allows the same cylinder display name in different categories', () => {
    const items = [
      { id: 'p1', name: '14.2 kg', kind: 'cylinder', code: 'DOM142' },
      { id: 'p2', name: '14.2 kg', kind: 'accessory', code: 'ACC142' },
    ]
    expect(findDuplicateConfigKeyInList(items, productNameUniquenessKey)).toBeNull()
    expect(
      isDuplicateAmong(
        items,
        { id: 'p3' },
        productNameUniquenessKey({ name: '14.2 kg', kind: 'other' }),
        productNameUniquenessKey,
      ),
    ).toBe(false)
  })

  it('rejects duplicate cylinder codes regardless of category', () => {
    const items = [
      { id: 'p1', name: 'Domestic', kind: 'cylinder', code: 'DOM142' },
      { id: 'p2', name: 'Commercial', kind: 'cylinder', code: 'dom142' },
    ]
    expect(
      isDuplicateAmong(
        items,
        { id: 'p2' },
        productCodeUniquenessKey('dom142'),
        (item) => productCodeUniquenessKey(item.code),
      ),
    ).toBe(true)
    expect(
      isDuplicateAmong(
        items.slice(0, 1),
        { id: 'p2' },
        productCodeUniquenessKey('  DOM142 '),
        (item) => productCodeUniquenessKey(item.code),
      ),
    ).toBe(true)
  })

  it('allows the same price label on different products and rejects it on the same product', () => {
    const items = [
      { id: 'pr1', label: 'Refill', productId: 'p1' },
      { id: 'pr2', label: 'Refill', productId: 'p2' },
    ]
    expect(findDuplicateConfigKeyInList(items, priceRuleUniquenessKey)).toBeNull()
    expect(
      isDuplicateAmong(
        items,
        { id: 'pr3' },
        priceRuleUniquenessKey({ label: ' refill ', productId: 'p1' }),
        priceRuleUniquenessKey,
      ),
    ).toBe(true)
  })

  it('allows the same location name in different location kinds', () => {
    const items = [
      { id: 'l1', name: 'Mirjapur', kind: 'godown' },
      { id: 'l2', name: 'Mirjapur', kind: 'vehicle' },
    ]
    expect(findDuplicateConfigKeyInList(items, locationUniquenessKey)).toBeNull()
    expect(
      isDuplicateAmong(
        items,
        { id: 'l3' },
        locationUniquenessKey({ name: 'Mirjapur', kind: 'godown' }),
        locationUniquenessKey,
      ),
    ).toBe(true)
  })

  it('backend schema rejects payment-method duplicates even if UI is bypassed', () => {
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'setPaymentMethods',
        payload: {
          items: [
            { id: 'pm1', name: 'Cash', kind: 'cash', active: true },
            { id: 'pm2', name: 'CASH', kind: 'cash', active: true },
          ],
        },
      }).success,
    ).toBe(false)
  })

  it('preserves distinct ids when validating an edit of the same identity', () => {
    const parsed = manageAgencyConfigSchema.safeParse({
      action: 'setReceivingAccounts',
      payload: {
        items: [
          {
            id: 'ra_existing',
            name: 'Anchal',
            kind: 'cash',
            active: true,
            ownership: 'agency',
            compatiblePaymentMethodIds: ['pm_cash', 'pm_upi'],
          },
        ],
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success || parsed.data.action !== 'setReceivingAccounts') return
    expect(parsed.data.payload.items[0]?.id).toBe('ra_existing')
  })
})
