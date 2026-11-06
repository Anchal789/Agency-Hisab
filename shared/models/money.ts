export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyFormatError'
  }
}

const RUPEE_PATTERN = /^\d+(\.\d{1,2})?$/

export function rupeesToPaise(input: string): number {
  const trimmed = input.trim()
  if (!RUPEE_PATTERN.test(trimmed)) {
    throw new MoneyFormatError('Enter an amount in rupees with at most two decimal places.')
  }
  const [whole, fraction = ''] = trimmed.split('.')
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(paise)) {
    throw new MoneyFormatError('Amount is too large.')
  }
  return paise
}

export function formatPaise(paise: number, language: 'en' | 'hi' = 'en'): string {
  if (!Number.isSafeInteger(paise)) {
    throw new MoneyFormatError('Paise must be a safe integer.')
  }
  return new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100)
}

export function saleIdentityHolds(salePaise: number, receivedPaise: number, duePaise: number): boolean {
  const amounts = [salePaise, receivedPaise, duePaise]
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) return false
  return receivedPaise + duePaise === salePaise
}
