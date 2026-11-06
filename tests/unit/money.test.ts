import { describe, expect, it } from 'vitest'
import { formatPaise, MoneyFormatError, rupeesToPaise, saleIdentityHolds } from '../../shared/models/money'

describe('money helpers', () => {
  it('converts rupees to integer paise', () => {
    expect(rupeesToPaise('10')).toBe(1000)
    expect(rupeesToPaise('10.5')).toBe(1050)
    expect(rupeesToPaise('10.50')).toBe(1050)
  })

  it('rejects invalid money formats', () => {
    expect(() => rupeesToPaise('10.123')).toThrow(MoneyFormatError)
    expect(() => rupeesToPaise('-1')).toThrow(MoneyFormatError)
  })

  it('formats paise for display', () => {
    expect(formatPaise(100050)).toContain('1,000.50')
  })

  it('checks sale identity without floats', () => {
    expect(saleIdentityHolds(100000, 60000, 40000)).toBe(true)
    expect(saleIdentityHolds(100000, 60000, 39000)).toBe(false)
    expect(saleIdentityHolds(100000, -1, 100001)).toBe(false)
  })
})
