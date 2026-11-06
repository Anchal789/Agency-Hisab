export type CustomerStatus = 'active' | 'inactive'

export type CustomerDoc = {
  id: string
  firstName: string
  lastName: string
  displayName: string
  address: string
  city: string
  consumerNumber: string
  lastRefillDate: string | null
  status: CustomerStatus
  searchTokens: string[]
  importBatchId: string | null
  importSource: 'manual' | 'excel' | null
  createdBy: string
  updatedBy: string
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/** Consumer numbers stay strings; keep digits/letters, preserve leading zeros, strip spaces. */
export function normalizeConsumerNumber(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

export function isValidConsumerNumber(value: string): boolean {
  return /^[0-9A-Za-z-]{1,32}$/.test(value)
}

export function buildDisplayName(firstName: string, lastName: string): string {
  return normalizeWhitespace(`${firstName} ${lastName}`)
}

/** Split a full customer name: first word → firstName, remainder → lastName (may be empty). */
export function splitFullName(fullName: string): { firstName: string; lastName: string; displayName: string } {
  const displayName = normalizeWhitespace(fullName)
  if (!displayName) return { firstName: '', lastName: '', displayName: '' }
  const parts = displayName.split(' ')
  const firstName = parts[0] ?? ''
  const lastName = parts.slice(1).join(' ')
  return { firstName, lastName, displayName }
}

export function buildCustomerSearchTokens(input: {
  firstName: string
  lastName: string
  address: string
  city: string
  consumerNumber: string
}): string[] {
  const tokens = new Set<string>()
  const parts = [
    input.firstName,
    input.lastName,
    buildDisplayName(input.firstName, input.lastName),
    input.address,
    input.city,
    input.consumerNumber,
  ]
  for (const part of parts) {
    const normalized = normalizeWhitespace(part).toLowerCase()
    if (!normalized) continue
    tokens.add(normalized)
    const compact = normalized.replace(/\s+/g, '')
    tokens.add(compact)
    for (let length = 1; length <= Math.min(normalized.length, 24); length += 1) {
      tokens.add(normalized.slice(0, length))
    }
    for (let length = 1; length <= Math.min(compact.length, 24); length += 1) {
      tokens.add(compact.slice(0, length))
    }
  }
  return [...tokens]
}

export function parseCustomer(id: string, data: Record<string, unknown>): CustomerDoc | null {
  const firstName = typeof data.firstName === 'string' ? normalizeWhitespace(data.firstName) : ''
  const lastName = typeof data.lastName === 'string' ? normalizeWhitespace(data.lastName) : ''
  const address = typeof data.address === 'string' ? normalizeWhitespace(data.address) : ''
  const city = typeof data.city === 'string' ? normalizeWhitespace(data.city) : ''
  const consumerNumber = typeof data.consumerNumber === 'string' ? normalizeConsumerNumber(data.consumerNumber) : ''
  if (!firstName || !consumerNumber) return null
  const lastRefillDate =
    data.lastRefillDate === null
      ? null
      : typeof data.lastRefillDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.lastRefillDate)
        ? data.lastRefillDate
        : null
  const searchTokens = Array.isArray(data.searchTokens)
    ? data.searchTokens.filter((token): token is string => typeof token === 'string')
    : buildCustomerSearchTokens({ firstName, lastName, address, city, consumerNumber })

  return {
    id,
    firstName,
    lastName,
    displayName:
      typeof data.displayName === 'string' && data.displayName.trim()
        ? normalizeWhitespace(data.displayName)
        : buildDisplayName(firstName, lastName),
    address,
    city,
    consumerNumber,
    lastRefillDate,
    status: data.status === 'inactive' ? 'inactive' : 'active',
    searchTokens,
    importBatchId: typeof data.importBatchId === 'string' ? data.importBatchId : null,
    importSource: data.importSource === 'excel' || data.importSource === 'manual' ? data.importSource : null,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  }
}

export function customerMatchesSearch(customer: CustomerDoc, rawQuery: string): boolean {
  const query = normalizeWhitespace(rawQuery).toLowerCase()
  if (!query) return true
  const compactQuery = query.replace(/\s+/g, '')
  if (customer.searchTokens.some((token) => token.includes(query) || token.includes(compactQuery))) return true
  if (customer.displayName.toLowerCase().includes(query)) return true
  if (customer.firstName.toLowerCase().includes(query)) return true
  if (customer.lastName.toLowerCase().includes(query)) return true
  if (customer.consumerNumber.toLowerCase().includes(compactQuery)) return true
  return false
}
