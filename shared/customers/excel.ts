import {
  buildDisplayName,
  isValidConsumerNumber,
  normalizeConsumerNumber,
  normalizeWhitespace,
  splitFullName,
} from '../models/customer'

export type CustomerImportField =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'address'
  | 'city'
  | 'consumerNumber'
  | 'lastRefillDate'

export type CustomerColumnMapping = Partial<Record<CustomerImportField, string>>

export type ParsedImportRow = {
  rowNumber: number
  firstName: string
  lastName: string
  displayName: string
  address: string
  city: string
  consumerNumber: string
  lastRefillDate: string | null
  dateInvalid: boolean
  raw: Record<string, string>
}

export type ImportRowIssue = {
  rowNumber: number
  code: 'empty' | 'missing_required' | 'invalid_consumer' | 'invalid_date' | 'duplicate_in_file' | 'exists_in_db'
  message: string
  consumerNumber?: string
}

export type ClassifiedImportRow =
  | { status: 'valid'; row: ParsedImportRow }
  | { status: 'invalid'; row: ParsedImportRow | null; issues: ImportRowIssue[] }

const FIELD_ALIASES: Record<CustomerImportField, string[]> = {
  fullName: ['consumer name', 'customer name', 'full name', 'fullname', 'fullname of consumer', 'name of customer'],
  firstName: ['firstname', 'first name', 'first_name', 'fname', 'givenname', 'given name'],
  lastName: ['lastname', 'last name', 'last_name', 'lname', 'surname', 'family name'],
  address: ['address', 'addr', 'full address'],
  city: ['city', 'town', 'district'],
  consumerNumber: [
    'consumernumber',
    'consumer number',
    'consumer_no',
    'consumer no',
    'consumer#',
    'consumer id',
    'consumerid',
    'number',
  ],
  lastRefillDate: [
    'lastrefilldate',
    'last refill date',
    'last refill',
    'refill date',
    'lastrefill',
    'refilldate',
  ],
}

export function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_#]+/g, ' ').replace(/\s+/g, ' ')
}

export function suggestColumnMapping(headers: string[]): CustomerColumnMapping {
  const mapping: CustomerColumnMapping = {}
  const normalized = headers.map((header) => ({ header, key: normalizeHeader(header) }))
  const usedHeaders = new Set<string>()

  const assign = (field: CustomerImportField) => {
    const aliases = FIELD_ALIASES[field]
    const match = normalized.find((item) => !usedHeaders.has(item.header) && aliases.includes(item.key))
    if (!match) return
    mapping[field] = match.header
    usedHeaders.add(match.header)
  }

  // Prefer a single full-name column when present (Consumer Name / Customer Name / Name / Full Name).
  assign('fullName')
  if (!mapping.fullName) {
    assign('firstName')
    assign('lastName')
  }
  assign('consumerNumber')
  assign('address')
  assign('city')
  assign('lastRefillDate')
  return mapping
}

/** True when mapping has a usable name source and consumer number. */
export function hasRequiredImportMapping(mapping: CustomerColumnMapping): boolean {
  if (!mapping.consumerNumber) return false
  if (mapping.fullName) return true
  return Boolean(mapping.firstName)
}

/** Apply a field mapping change without letting one column serve conflicting name fields. */
export function applyColumnMappingChange(
  current: CustomerColumnMapping,
  field: CustomerImportField,
  header: string | undefined,
): CustomerColumnMapping {
  const next: CustomerColumnMapping = { ...current }
  if (!header) {
    delete next[field]
    return next
  }

  for (const key of Object.keys(next) as CustomerImportField[]) {
    if (key !== field && next[key] === header) delete next[key]
  }

  next[field] = header

  if (field === 'fullName') {
    delete next.firstName
    delete next.lastName
  }
  if (field === 'firstName' || field === 'lastName') {
    delete next.fullName
  }

  return next
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString().slice(0, 10)
}

export function parseFlexibleDate(value: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, iso: null }
  if (typeof value === 'number') {
    const iso = excelSerialToIso(value)
    return iso ? { ok: true, iso } : { ok: false }
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false }
    return { ok: true, iso: value.toISOString().slice(0, 10) }
  }
  const text = String(value).trim()
  if (!text) return { ok: true, iso: null }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: true, iso: text }

  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(text)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    let year = Number(dmy[3])
    if (year < 100) year += 2000
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false }
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const probe = new Date(`${iso}T00:00:00+05:30`)
    if (Number.isNaN(probe.getTime())) return { ok: false }
    return { ok: true, iso }
  }

  const parsed = Date.parse(text)
  if (!Number.isNaN(parsed)) {
    return { ok: true, iso: new Date(parsed).toISOString().slice(0, 10) }
  }
  return { ok: false }
}

export function mapSheetRows(
  rows: Array<Record<string, unknown>>,
  mapping: CustomerColumnMapping,
): ParsedImportRow[] {
  return rows.map((raw, index) => {
    const cell = (header: string | undefined): string => {
      if (!header) return ''
      const value = raw[header]
      if (value === null || value === undefined) return ''
      return String(value)
    }

    let firstName = ''
    let lastName = ''
    let displayName = ''

    if (mapping.fullName) {
      const split = splitFullName(cell(mapping.fullName))
      firstName = split.firstName
      lastName = split.lastName
      displayName = split.displayName
    } else {
      firstName = normalizeWhitespace(cell(mapping.firstName))
      lastName = normalizeWhitespace(cell(mapping.lastName))
      displayName = buildDisplayName(firstName, lastName)
    }

    const dateRaw = mapping.lastRefillDate ? raw[mapping.lastRefillDate] : ''
    const dateParsed = parseFlexibleDate(dateRaw)
    return {
      rowNumber: index + 2,
      firstName,
      lastName,
      displayName,
      address: normalizeWhitespace(cell(mapping.address)),
      city: normalizeWhitespace(cell(mapping.city)),
      consumerNumber: normalizeConsumerNumber(cell(mapping.consumerNumber)),
      lastRefillDate: dateParsed.ok ? dateParsed.iso : null,
      dateInvalid: !dateParsed.ok,
      raw: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value == null ? '' : String(value)])),
    }
  })
}

export function classifyImportRows(
  rows: ParsedImportRow[],
  existingConsumerNumbers: Set<string>,
): ClassifiedImportRow[] {
  const seenInFile = new Map<string, number>()
  return rows.map((row) => {
    const issues: ImportRowIssue[] = []
    const blank =
      !row.firstName &&
      !row.lastName &&
      !row.displayName &&
      !row.address &&
      !row.city &&
      !row.consumerNumber &&
      !row.lastRefillDate &&
      !row.dateInvalid
    if (blank) {
      issues.push({ rowNumber: row.rowNumber, code: 'empty', message: 'Empty row.' })
      return { status: 'invalid', row, issues }
    }

    if (!row.firstName || !row.consumerNumber) {
      issues.push({
        rowNumber: row.rowNumber,
        code: 'missing_required',
        message: 'Customer name and consumer number are required.',
        consumerNumber: row.consumerNumber || undefined,
      })
    }

    if (row.consumerNumber && !isValidConsumerNumber(row.consumerNumber)) {
      issues.push({
        rowNumber: row.rowNumber,
        code: 'invalid_consumer',
        message: 'Consumer number format is invalid.',
        consumerNumber: row.consumerNumber,
      })
    }

    if (row.dateInvalid) {
      issues.push({
        rowNumber: row.rowNumber,
        code: 'invalid_date',
        message: 'Last refill date is invalid.',
        consumerNumber: row.consumerNumber || undefined,
      })
    }

    if (row.consumerNumber) {
      const key = row.consumerNumber.toLowerCase()
      const prior = seenInFile.get(key)
      if (prior) {
        issues.push({
          rowNumber: row.rowNumber,
          code: 'duplicate_in_file',
          message: `Duplicate consumer number in file (also row ${prior}).`,
          consumerNumber: row.consumerNumber,
        })
      } else {
        seenInFile.set(key, row.rowNumber)
      }

      if (existingConsumerNumbers.has(key)) {
        issues.push({
          rowNumber: row.rowNumber,
          code: 'exists_in_db',
          message: 'Consumer number already exists in the customer master.',
          consumerNumber: row.consumerNumber,
        })
      }
    }

    if (issues.length > 0) return { status: 'invalid', row, issues }
    return { status: 'valid', row }
  })
}
