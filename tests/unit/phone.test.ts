import { describe, expect, it } from 'vitest'
import {
  AUTH_EMAIL_DOMAIN,
  normalizeIndianMobile,
  phoneToAuthEmail,
  PhoneValidationError,
  tryNormalizeIndianMobile,
} from '../../shared/auth/phone'

describe('Indian mobile normalization', () => {
  it('accepts a 10-digit national number', () => {
    expect(normalizeIndianMobile('9876543210')).toBe('+919876543210')
  })

  it('accepts +91 and 91 prefixes', () => {
    expect(normalizeIndianMobile('+919876543210')).toBe('+919876543210')
    expect(normalizeIndianMobile('919876543210')).toBe('+919876543210')
  })

  it('ignores spaces and dashes', () => {
    expect(normalizeIndianMobile('+91 98765-43210')).toBe('+919876543210')
  })

  it('rejects invalid and ambiguous numbers', () => {
    expect(() => normalizeIndianMobile('5876543210')).toThrow(PhoneValidationError)
    expect(() => normalizeIndianMobile('987654321')).toThrow(PhoneValidationError)
    expect(() => normalizeIndianMobile('+12025550123')).toThrow(PhoneValidationError)
    expect(() => normalizeIndianMobile('')).toThrow(PhoneValidationError)
    expect(tryNormalizeIndianMobile('not-a-phone')).toBeNull()
  })

  it('maps normalized phones to a reserved synthetic auth email', () => {
    expect(phoneToAuthEmail('+919876543210')).toBe(`919876543210@${AUTH_EMAIL_DOMAIN}`)
    expect(() => phoneToAuthEmail('9876543210')).toThrow(PhoneValidationError)
  })

  it('treats equivalent input formats as the same normalized identity', () => {
    const a = normalizeIndianMobile('9876543210')
    const b = normalizeIndianMobile('+91 9876543210')
    const c = normalizeIndianMobile('919876543210')
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(phoneToAuthEmail(a)).toBe(phoneToAuthEmail(c))
  })
})
