import type { PaymentMethod, ReceivingAccount } from '../models/agency-config'

/**
 * Destinations shown for a payment method:
 * 1. If the destination lists `compatiblePaymentMethodIds`, the method id must be included.
 * 2. Otherwise (legacy rows), match by canonical category `kind`.
 */
export function destinationsForPaymentMethod(
  method: PaymentMethod | null | undefined,
  accounts: readonly ReceivingAccount[],
): ReceivingAccount[] {
  if (!method || !method.active) return []
  return accounts.filter((account) => isDestinationCompatibleWithPaymentMethod(method, account))
}

export function isDestinationCompatibleWithPaymentMethod(
  method: PaymentMethod | null | undefined,
  account: ReceivingAccount | null | undefined,
): boolean {
  if (!method || !method.active || !account || !account.active) return false
  const compatibleIds = account.compatiblePaymentMethodIds
  if (compatibleIds && compatibleIds.length > 0) {
    return compatibleIds.includes(method.id)
  }
  return account.kind === method.kind
}
