import { describe, expect, it } from 'vitest'
import { businessDateInTimeZone, formatBusinessDate } from '../../shared/calculations/business-date'

describe('business date', () => {
  it('formats Asia/Kolkata calendar dates as YYYY-MM-DD', () => {
    // 2026-11-04 20:30 UTC is 2026-11-05 02:00 IST
    const date = new Date('2026-11-04T20:30:00.000Z')
    expect(businessDateInTimeZone(date, 'Asia/Kolkata')).toBe('2026-11-05')
  })

  it('formats business dates for display', () => {
    expect(formatBusinessDate('2026-11-05', 'en')).toMatch(/2026/)
  })
})
