export type SearchableUser = {
  displayName: string
  phoneE164: string
  status: 'active' | 'disabled'
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Case-insensitive name match and digit-tolerant phone match.
 * Accepts partial names and partial phone numbers in national or E.164-like forms.
 */
export function userMatchesSearch(user: SearchableUser, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const name = user.displayName.trim().toLowerCase()
  if (name.includes(query)) return true

  const queryDigits = digitsOnly(query)
  if (!queryDigits) return false

  const phoneDigits = digitsOnly(user.phoneE164)
  if (!phoneDigits) return false
  if (phoneDigits.includes(queryDigits)) return true

  // National 10-digit forms should still match stored +91XXXXXXXXXX values.
  const national = phoneDigits.startsWith('91') && phoneDigits.length >= 12 ? phoneDigits.slice(-10) : phoneDigits
  return national.includes(queryDigits) || queryDigits.includes(national)
}

export function filterUsers<T extends SearchableUser>(
  users: T[],
  options: { search: string; status: 'all' | 'active' | 'disabled' },
): T[] {
  return users.filter((user) => {
    if (options.status !== 'all' && user.status !== options.status) return false
    return userMatchesSearch(user, options.search)
  })
}
