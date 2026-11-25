import type { ReceivingAccount } from '../models/agency-config'

export type FundTransferAccountCheck =
  | { ok: true; source: ReceivingAccount; destination: ReceivingAccount }
  | {
      ok: false
      code:
        | 'same_account'
        | 'source_missing'
        | 'destination_missing'
        | 'source_inactive'
        | 'destination_inactive'
        | 'source_portal'
        | 'destination_portal'
        | 'source_ownership'
        | 'destination_ownership'
    }

/**
 * Ordinary fund transfers move money between non-portal receiving destinations.
 * Portal funding/settlement use dedicated Phase 5F.4 Functions.
 */
export function validateFundTransferAccounts(input: {
  sourceAccountId: string
  destinationAccountId: string
  accounts: ReceivingAccount[]
}): FundTransferAccountCheck {
  if (input.sourceAccountId === input.destinationAccountId) {
    return { ok: false, code: 'same_account' }
  }
  const source = input.accounts.find((row) => row.id === input.sourceAccountId)
  const destination = input.accounts.find((row) => row.id === input.destinationAccountId)
  if (!source) return { ok: false, code: 'source_missing' }
  if (!destination) return { ok: false, code: 'destination_missing' }
  if (source.active === false) return { ok: false, code: 'source_inactive' }
  if (destination.active === false) return { ok: false, code: 'destination_inactive' }
  if (!source.ownership) return { ok: false, code: 'source_ownership' }
  if (!destination.ownership) return { ok: false, code: 'destination_ownership' }
  if (source.ownership === 'portal') return { ok: false, code: 'source_portal' }
  if (destination.ownership === 'portal') return { ok: false, code: 'destination_portal' }
  return { ok: true, source, destination }
}

export function fundTransferAccountErrorMessage(code: Exclude<FundTransferAccountCheck, { ok: true }>['code']): string {
  switch (code) {
    case 'same_account':
      return 'Source and destination must be different accounts.'
    case 'source_missing':
      return 'Source destination was not found.'
    case 'destination_missing':
      return 'Destination account was not found.'
    case 'source_inactive':
      return 'Source destination is inactive.'
    case 'destination_inactive':
      return 'Destination account is inactive.'
    case 'source_portal':
    case 'destination_portal':
      return 'Use portal funding or settlement for Indane Portal balances.'
    case 'source_ownership':
      return 'Source destination is missing ownership configuration.'
    case 'destination_ownership':
      return 'Destination account is missing ownership configuration.'
  }
}
