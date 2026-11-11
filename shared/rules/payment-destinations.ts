import type { PaymentMethod, ReceivingAccount } from '../models/agency-config'

/**
 * Destinations shown for a payment method are those with the same canonical category kind.
 * Method and destination kinds come from Settings (cash / upi / bank / indane_portal / other).
 */
export function destinationsForPaymentMethod(
  method: PaymentMethod | null | undefined,
  accounts: readonly ReceivingAccount[],
): ReceivingAccount[] {
  if (!method) return []
  return accounts.filter((account) => account.active && account.kind === method.kind)
}

export function isDestinationCompatibleWithPaymentMethod(
  method: PaymentMethod | null | undefined,
  account: ReceivingAccount | null | undefined,
): boolean {
  if (!method || !account || !account.active) return false
  return account.kind === method.kind
}
