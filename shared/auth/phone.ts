export class PhoneValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhoneValidationError'
  }
}

/** Reserved internal domain for Firebase Email/Password mapping. Never show in the UI. */
export const AUTH_EMAIL_DOMAIN = 'users.hisab.internal'

const E164_INDIAN_MOBILE = /^\+91[6-9]\d{9}$/

/**
 * Normalizes accepted Indian mobile inputs to E.164 (+91XXXXXXXXXX).
 * Accepts: 9876543210, 919876543210, +919876543210 (spaces/dashes ignored).
 */
export function normalizeIndianMobile(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new PhoneValidationError('Enter a mobile number.')
  }

  const compact = trimmed.replace(/[\s\-()]/g, '')
  let digits = compact.startsWith('+') ? compact.slice(1) : compact
  if (!/^\d+$/.test(digits)) {
    throw new PhoneValidationError('Enter a valid Indian mobile number.')
  }

  if (digits.length === 10) {
    // national format
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2)
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1)
  } else {
    throw new PhoneValidationError('Enter a valid Indian mobile number.')
  }

  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw new PhoneValidationError('Enter a valid Indian mobile number.')
  }

  return `+91${digits}`
}

export function isIndianMobileE164(value: string): boolean {
  return E164_INDIAN_MOBILE.test(value)
}

/** Deterministic Firebase Auth email for a normalized E.164 Indian mobile. */
export function phoneToAuthEmail(phoneE164: string): string {
  if (!isIndianMobileE164(phoneE164)) {
    throw new PhoneValidationError('Phone number must be normalized E.164 before mapping.')
  }
  const digits = phoneE164.slice(1) // 91XXXXXXXXXX
  return `${digits}@${AUTH_EMAIL_DOMAIN}`
}

export function tryNormalizeIndianMobile(input: string): string | null {
  try {
    return normalizeIndianMobile(input)
  } catch {
    return null
  }
}

export function formatPhoneForDisplay(phoneE164: string): string {
  if (!isIndianMobileE164(phoneE164)) return phoneE164
  return `+91 ${phoneE164.slice(3, 8)} ${phoneE164.slice(8)}`
}
