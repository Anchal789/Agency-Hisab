import { describe, expect, it } from 'vitest'
import {
  buildCustomerSearchTokens,
  buildDisplayName,
  customerMatchesSearch,
  isValidConsumerNumber,
  normalizeConsumerNumber,
  normalizeWhitespace,
  parseCustomer,
} from '../../shared/models/customer'
import { customerWriteFields, createCustomerSchema } from '../../shared/schemas/customer'

describe('customer model', () => {
  it('preserves leading zeros and strips spaces in consumer numbers', () => {
    expect(normalizeConsumerNumber(' 0012345 ')).toBe('0012345')
    expect(isValidConsumerNumber('0012345')).toBe(true)
    expect(isValidConsumerNumber('')).toBe(false)
  })

  it('normalizes whitespace in names and builds display name', () => {
    expect(normalizeWhitespace('  Ram   Kumar ')).toBe('Ram Kumar')
    expect(buildDisplayName('Ram', 'Kumar')).toBe('Ram Kumar')
  })

  it('matches first, last, full, and partial consumer searches via tokens', () => {
    const customer = parseCustomer('c1', {
      firstName: 'Sita',
      lastName: 'Devi',
      address: 'Main Road',
      city: 'Miragpur',
      consumerNumber: '0001122',
      lastRefillDate: '2026-01-15',
      searchTokens: buildCustomerSearchTokens({
        firstName: 'Sita',
        lastName: 'Devi',
        address: 'Main Road',
        city: 'Miragpur',
        consumerNumber: '0001122',
      }),
      createdBy: 'admin',
      updatedBy: 'admin',
    })
    expect(customer).not.toBeNull()
    expect(customerMatchesSearch(customer!, 'sita')).toBe(true)
    expect(customerMatchesSearch(customer!, 'Devi')).toBe(true)
    expect(customerMatchesSearch(customer!, 'sita devi')).toBe(true)
    expect(customerMatchesSearch(customer!, 'sit')).toBe(true)
    expect(customerMatchesSearch(customer!, '00011')).toBe(true)
    expect(customerMatchesSearch(customer!, '999')).toBe(false)
  })

  it('rejects invalid create payloads and accepts normalized fields', () => {
    expect(createCustomerSchema.safeParse({ firstName: '', lastName: 'A', consumerNumber: '1' }).success).toBe(false)
    const parsed = createCustomerSchema.safeParse({
      firstName: '  Ram  ',
      lastName: '  Singh ',
      address: '  Lane 1 ',
      city: ' Miragpur ',
      consumerNumber: ' 00055 ',
      lastRefillDate: null,
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const fields = customerWriteFields(parsed.data)
    expect(fields.firstName).toBe('Ram')
    expect(fields.consumerNumber).toBe('00055')
    expect(fields.consumerNumberLower).toBe('00055')
    expect(fields.searchTokens.length).toBeGreaterThan(0)
  })

  it('parses customers with an empty last name and keeps the full display name', () => {
    const customer = parseCustomer('c2', {
      firstName: 'Sita',
      lastName: '',
      displayName: 'Sita',
      address: '',
      city: '',
      consumerNumber: '9',
      createdBy: 'admin',
      updatedBy: 'admin',
    })
    expect(customer).toMatchObject({ firstName: 'Sita', lastName: '', displayName: 'Sita' })
  })
})
