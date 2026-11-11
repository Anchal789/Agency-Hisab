import { describe, expect, it } from 'vitest'
import { parseAgencySettings, parseLocation, parsePriceRule, parseProduct } from '../../shared/models/agency-config'
import { manageAgencyConfigSchema } from '../../shared/schemas/agency-settings'

describe('agency configuration models', () => {
  it('parses agency settings with safe defaults', () => {
    const parsed = parseAgencySettings({
      name: ' Miragpur Indane Gas Agency ',
      paymentMethods: [{ id: 'pm1', name: 'Cash', active: true }],
      receivingAccounts: [{ id: 'ra1', name: 'Counter cash', kind: 'cash', active: true }],
    })
    expect(parsed.timezone).toBe('Asia/Kolkata')
    expect(parsed.currency).toBe('INR')
    expect(parsed.paymentMethods).toEqual([{ id: 'pm1', name: 'Cash', kind: 'cash', active: true }])
    expect(parsed.receivingAccounts[0]?.kind).toBe('cash')
  })

  it('normalizes legacy portal destination kind and Online payment method', () => {
    const parsed = parseAgencySettings({
      paymentMethods: [{ id: 'pm_online', name: 'Online', active: true }],
      receivingAccounts: [{ id: 'ra_portal', name: 'Portal', kind: 'portal', active: true }],
    })
    expect(parsed.paymentMethods[0]).toMatchObject({ name: 'UPI', kind: 'upi' })
    expect(parsed.receivingAccounts[0]?.kind).toBe('indane_portal')
  })

  it('rejects invalid manage payloads and accepts profile updates', () => {
    expect(manageAgencyConfigSchema.safeParse({ action: 'updateProfile', payload: { name: 'A', timezone: 'Asia/Kolkata', currency: 'INR' } }).success).toBe(
      false,
    )
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'updateProfile',
        payload: { name: 'Miragpur Indane Gas Agency', timezone: 'Asia/Kolkata', currency: 'INR' },
      }).success,
    ).toBe(true)
  })

  it('accepts create payloads when id is omitted or null', () => {
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'upsertLocation',
        payload: { id: null, name: 'Main Godown', kind: 'godown', active: true },
      }).success,
    ).toBe(true)
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'upsertProduct',
        payload: { name: '14.2 kg', code: 'DOM142', kind: 'cylinder', unit: 'cylinder', active: true },
      }).success,
    ).toBe(true)
    expect(
      manageAgencyConfigSchema.safeParse({
        action: 'upsertPriceRule',
        payload: { id: null, productId: 'p1', label: 'Refill', amountPaise: 110000, active: true },
      }).success,
    ).toBe(true)
  })

  it('parses location, product and price documents', () => {
    expect(parseLocation('loc1', { name: 'Main Godown', kind: 'godown', active: true })?.name).toBe('Main Godown')
    expect(parseProduct('p1', { name: '14.2 kg', code: 'DOM142', kind: 'cylinder', unit: 'cylinder' })?.code).toBe('DOM142')
    expect(parsePriceRule('pr1', { productId: 'p1', label: 'Domestic refill', amountPaise: 110050 })?.amountPaise).toBe(110050)
  })
})
