import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '../calculations/business-date'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoBusinessDate(value: string): boolean {
  return ISO_DATE.test(value)
}

/** Current agency business date (Asia/Kolkata). */
export function todayHisabBusinessDate(now = new Date()): string {
  return businessDateInTimeZone(now, AGENCY_TIME_ZONE)
}

/**
 * Clamp a selected Hisab business date to [financialOpeningDate, today].
 * Future dates and pre-opening dates are rejected (not silently coerced) for writes;
 * for UI selection, callers may use `resolveHisabBusinessDate` which falls back to today.
 */
export function validateHisabBusinessDate(input: {
  selected: string
  financialOpeningDate: string
  today: string
}): { ok: true } | { ok: false; code: 'invalid' | 'before_opening' | 'future' } {
  if (!isIsoBusinessDate(input.selected) || !isIsoBusinessDate(input.financialOpeningDate) || !isIsoBusinessDate(input.today)) {
    return { ok: false, code: 'invalid' }
  }
  if (input.selected < input.financialOpeningDate) return { ok: false, code: 'before_opening' }
  if (input.selected > input.today) return { ok: false, code: 'future' }
  return { ok: true }
}

/** Prefer selected when valid; otherwise today (clamped to opening). */
export function resolveHisabBusinessDate(input: {
  selected: string | null | undefined
  financialOpeningDate: string
  today?: string
}): string {
  const today = input.today ?? todayHisabBusinessDate()
  const opening = input.financialOpeningDate
  if (!isIsoBusinessDate(opening) || !isIsoBusinessDate(today)) {
    return today
  }
  const selected = typeof input.selected === 'string' ? input.selected : today
  const validated = validateHisabBusinessDate({ selected, financialOpeningDate: opening, today })
  if (validated.ok) return selected
  if (today < opening) return opening
  return today
}
