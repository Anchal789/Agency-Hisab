import { describe, expect, it } from 'vitest'
import { authErrorKey, isUserDisabledError } from '../../src/services/errors'

describe('auth error mapping', () => {
  it('detects USER_DISABLED from Firebase-style errors', () => {
    expect(isUserDisabledError({ code: 'auth/user-disabled' })).toBe(true)
    expect(isUserDisabledError({ code: 'auth/invalid-credential', message: 'USER_DISABLED' })).toBe(true)
    expect(isUserDisabledError({ code: 'auth/invalid-credential' })).toBe(false)
  })

  it('maps disabled accounts separately from invalid credentials', () => {
    expect(authErrorKey({ code: 'auth/user-disabled' })).toBe('errors.accountDisabled')
    expect(authErrorKey({ code: 'auth/invalid-credential' })).toBe('errors.invalidCredential')
    expect(authErrorKey({ code: 'auth/network-request-failed' })).toBe('errors.network')
  })
})
