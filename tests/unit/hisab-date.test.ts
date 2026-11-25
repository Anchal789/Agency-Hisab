import { describe, expect, it } from 'vitest'
import {
  resolveHisabBusinessDate,
  todayHisabBusinessDate,
  validateHisabBusinessDate,
} from '../../shared/rules/hisab-date'

describe('hisab business date clamp', () => {
  it('accepts dates from opening through today', () => {
    expect(
      validateHisabBusinessDate({
        selected: '2026-11-20',
        financialOpeningDate: '2026-11-19',
        today: '2026-11-23',
      }),
    ).toEqual({ ok: true })
  })

  it('rejects future and pre-opening dates', () => {
    expect(
      validateHisabBusinessDate({
        selected: '2026-11-24',
        financialOpeningDate: '2026-11-19',
        today: '2026-11-23',
      }),
    ).toEqual({ ok: false, code: 'future' })
    expect(
      validateHisabBusinessDate({
        selected: '2026-11-18',
        financialOpeningDate: '2026-11-19',
        today: '2026-11-23',
      }),
    ).toEqual({ ok: false, code: 'before_opening' })
  })

  it('resolve falls back to today when selected is invalid', () => {
    expect(
      resolveHisabBusinessDate({
        selected: '2026-12-01',
        financialOpeningDate: '2026-11-19',
        today: '2026-11-23',
      }),
    ).toBe('2026-11-23')
    expect(
      resolveHisabBusinessDate({
        selected: '2026-11-10',
        financialOpeningDate: '2026-11-19',
        today: '2026-11-23',
      }),
    ).toBe('2026-11-23')
  })

  it('todayHisabBusinessDate returns YYYY-MM-DD', () => {
    expect(todayHisabBusinessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
