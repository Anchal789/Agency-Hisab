export type JournalDirection = 'debit' | 'credit'

export type JournalLine = {
  direction: JournalDirection
  amountPaise: number
}

export function journalBalances(lines: readonly JournalLine[]): boolean {
  let debit = 0
  let credit = 0
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountPaise) || line.amountPaise < 0) return false
    if (line.direction === 'debit') debit += line.amountPaise
    else if (line.direction === 'credit') credit += line.amountPaise
    else return false
  }
  return debit === credit
}
