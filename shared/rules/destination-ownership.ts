import type { DestinationOwnership } from '../models/finance'
import type { ReceivingAccount } from '../models/agency-config'

/**
 * Dynamic destination ownership for Phase 5.0+.
 *
 * Opening and financial posting validate against the Admin-configured
 * `settings/agency.receivingAccounts[]` set — not a fixed eight-name slot map.
 *
 * Rules:
 * - At least one active destination is required before financial opening.
 * - Every active destination must have explicit ownership.
 * - Ownership is never inferred from the destination name.
 * - Inactive destinations are ignored for opening and Godown destination lists.
 */

export type DestinationOwnershipMatch = {
  accountId: string
  accountName: string
  kind: ReceivingAccount['kind']
  ownership: DestinationOwnership
  compatiblePaymentMethodIds: string[]
}

export type OwnershipResolutionResult =
  | { ok: true; matches: DestinationOwnershipMatch[] }
  | {
      ok: false
      missingOwnershipAccountIds: string[]
      details: string[]
    }

/** Active destinations that participate in opening and live collections. */
export function activeReceivingAccounts(
  accounts: readonly ReceivingAccount[],
): ReceivingAccount[] {
  return accounts.filter((row) => row.active)
}

/**
 * Resolve ownership for every active configured destination.
 * Fails closed when none are configured or any active row lacks ownership.
 */
export function resolveDestinationOwnership(
  accounts: readonly ReceivingAccount[],
): OwnershipResolutionResult {
  const active = activeReceivingAccounts(accounts)
  const details: string[] = []
  const missingOwnershipAccountIds: string[] = []

  if (active.length === 0) {
    return {
      ok: false,
      missingOwnershipAccountIds: [],
      details: [
        'No payment destinations have been configured yet. Please add your payment destinations in Settings before continuing.',
      ],
    }
  }

  const matches: DestinationOwnershipMatch[] = []
  for (const account of active) {
    const ownership = account.ownership ?? null
    if (!ownership) {
      missingOwnershipAccountIds.push(account.id)
      details.push(`Ownership is not set for “${account.name}”.`)
      continue
    }
    matches.push({
      accountId: account.id,
      accountName: account.name,
      kind: account.kind,
      ownership,
      compatiblePaymentMethodIds: account.compatiblePaymentMethodIds ?? [],
    })
  }

  if (missingOwnershipAccountIds.length > 0) {
    return { ok: false, missingOwnershipAccountIds, details }
  }

  return { ok: true, matches }
}

/** True when every active destination has explicit ownership. */
export function isDestinationOwnershipReady(accounts: readonly ReceivingAccount[]): boolean {
  return resolveDestinationOwnership(accounts).ok
}

/**
 * Propose ownership values only when already known on the account.
 * Never invents ownership from names or slots.
 */
export function destinationsNeedingOwnership(
  accounts: readonly ReceivingAccount[],
): ReceivingAccount[] {
  return activeReceivingAccounts(accounts).filter((row) => row.ownership == null)
}
