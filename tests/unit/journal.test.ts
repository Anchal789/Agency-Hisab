import { describe, expect, it } from 'vitest'
import { journalBalances } from '../../shared/calculations/journal'

describe('journalBalances', () => {
  it('accepts balanced journals', () => {
    expect(
      journalBalances([
        { direction: 'debit', amountPaise: 10000 },
        { direction: 'credit', amountPaise: 6000 },
        { direction: 'credit', amountPaise: 4000 },
      ]),
    ).toBe(true)
  })

  it('rejects unbalanced or invalid lines', () => {
    expect(journalBalances([{ direction: 'debit', amountPaise: 100 }, { direction: 'credit', amountPaise: 50 }])).toBe(false)
    expect(journalBalances([{ direction: 'debit', amountPaise: -1 }])).toBe(false)
  })
})
