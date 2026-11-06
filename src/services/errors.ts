function firebaseCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error) return String(error.code)
  return ''
}

function firebaseMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return ''
}

export function isUserDisabledError(error: unknown): boolean {
  const code = firebaseCode(error).toLowerCase()
  const message = firebaseMessage(error).toUpperCase()
  return (
    code === 'auth/user-disabled' ||
    message.includes('USER_DISABLED') ||
    message.includes('AUTH/USER-DISABLED')
  )
}

export function authErrorKey(error: unknown): string {
  const code = firebaseCode(error)
  if (code === 'auth/invalid-phone') return 'validation.phoneInvalid'
  if (isUserDisabledError(error)) return 'errors.accountDisabled'
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-email'
  ) {
    return 'errors.invalidCredential'
  }
  if (code === 'auth/too-many-requests') return 'errors.tooManyRequests'
  if (code === 'auth/network-request-failed') return 'errors.network'
  return 'errors.generic'
}

export function callableErrorKey(error: unknown): string {
  const code = firebaseCode(error)
  const message = firebaseMessage(error).toLowerCase()
  if (code.includes('permission-denied')) return 'errors.permissionDenied'
  if (code.includes('already-exists')) {
    if (message.includes('consumer')) return 'customers.duplicateConsumer'
    return 'users.phoneInUse'
  }
  if (code.includes('invalid-argument')) return 'errors.invalidInput'
  if (code.includes('unavailable') || code.includes('internal') || code.includes('not-found')) return 'errors.backendUnavailable'
  return 'errors.generic'
}

/** Prefer the callable’s user-facing message when the backend provided one. */
export function callableErrorMessage(error: unknown, translate: (key: string) => string): string {
  const code = firebaseCode(error)
  const message = firebaseMessage(error).trim()
  if (
    message &&
    (code.includes('invalid-argument') ||
      code.includes('failed-precondition') ||
      code.includes('already-exists') ||
      code.includes('not-found'))
  ) {
    // Firebase may append "(functions/<name>)" — strip only that trailer.
    const cleaned = message
      .replace(/^Firebase:\s*/i, '')
      .replace(/\s*\(functions\/[^)]+\)\.?$/i, '')
      .trim()
    if (cleaned.length > 0 && cleaned !== 'Error') return cleaned
  }
  return translate(callableErrorKey(error))
}
