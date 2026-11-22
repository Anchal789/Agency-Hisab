import { z } from 'zod'
import { saleIdentityHolds } from '../models/money'
import { emptyOutstandingFromIssue } from '../models/transaction'
import { normalizeWhitespace } from '../models/customer'

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

const uuidLikeSchema = z
  .string()
  .trim()
  .min(8)
  .max(80)

const nonNegInt = z.number().int().nonnegative().max(100_000)
const moneyPaise = z.number().int().nonnegative().max(1_000_000_000)

/**
 * Optional trimmed string that also accepts null.
 * Firebase httpsCallable JSON often turns omitted/undefined fields into null.
 */
function optionalNullableTrimmed(max: number) {
  return z
    .union([
      z
        .string()
        .trim()
        .max(max)
        .transform((value) => (value === '' ? value : normalizeWhitespace(value))),
      z.null(),
    ])
    .optional()
}

const saleFieldsBase = z.object({
  transactionId: uuidLikeSchema,
  idempotencyKey: uuidLikeSchema,
  businessDate: isoDateSchema,
  customerKind: z.enum(['registered', 'custom']),
  customerId: z.string().trim().min(1).max(80).nullable().optional(),
  customCustomerName: optionalNullableTrimmed(120),
  locationId: z.string().trim().min(1).max(80).nullable().optional(),
  productId: z.string().trim().min(1).max(80),
  filledIssued: nonNegInt,
  emptyReceived: nonNegInt,
  /** Calculated total: receivedPaise + duePaise. Persisted for ledger/reporting. */
  salePaise: moneyPaise,
  receivedPaise: moneyPaise,
  duePaise: moneyPaise,
  paymentMethodId: z.string().trim().min(1).max(80).nullable().optional(),
  receivingAccountId: z.string().trim().min(1).max(80).nullable().optional(),
  bookingStatus: z.enum(['yes', 'no']),
  /**
   * Optional date the manager received the customer's DAC (Delivery Authentication Code).
   * Stores only the date — never the six-digit code. Null/omitted when not recorded.
   */
  dacReceivedDate: z
    .union([
      isoDateSchema,
      z.null(),
      z.literal('').transform(() => null),
    ])
    .optional(),
  note: optionalNullableTrimmed(500),
})

/** Reject DAC dates after the sale business date. Future-vs-today is enforced in Cloud Functions. */
export function isDacReceivedDateAllowed(
  dacReceivedDate: string | null | undefined,
  businessDate: string,
  todayBusinessDate?: string,
): boolean {
  if (dacReceivedDate == null || dacReceivedDate === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dacReceivedDate)) return false
  if (dacReceivedDate > businessDate) return false
  if (todayBusinessDate && dacReceivedDate > todayBusinessDate) return false
  return true
}

function refineSaleFields(value: z.infer<typeof saleFieldsBase>, ctx: z.RefinementCtx) {
  if (value.customerKind === 'registered') {
    if (!value.customerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a registered customer.', path: ['customerId'] })
    }
  } else {
    if (!value.customCustomerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the custom customer name.',
        path: ['customCustomerName'],
      })
    }
    if (value.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom customers must not include a customer id.',
        path: ['customerId'],
      })
    }
  }

  if (value.filledIssued < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Issue at least one filled cylinder.',
      path: ['filledIssued'],
    })
  }

  const outstanding = emptyOutstandingFromIssue(value.filledIssued, value.emptyReceived)
  if (!Number.isSafeInteger(outstanding)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Empty cylinders received cannot exceed filled cylinders issued.',
      path: ['emptyReceived'],
    })
  }

  if (!saleIdentityHolds(value.salePaise, value.receivedPaise, value.duePaise)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Total sale must equal amount received plus amount due.',
      path: ['salePaise'],
    })
  }

  if (value.receivedPaise > 0) {
    if (!value.paymentMethodId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a payment method.',
        path: ['paymentMethodId'],
      })
    }
    if (!value.receivingAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a payment destination.',
        path: ['receivingAccountId'],
      })
    }
  }

  if (value.dacReceivedDate && !isDacReceivedDateAllowed(value.dacReceivedDate, value.businessDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'DAC received date cannot be after the transaction date.',
      path: ['dacReceivedDate'],
    })
  }
}

export const createGodownSaleSchema = saleFieldsBase.superRefine((value, ctx) => refineSaleFields(value, ctx))

export const updateGodownSaleSchema = saleFieldsBase
  .omit({ transactionId: true, idempotencyKey: true })
  .extend({
    transactionId: uuidLikeSchema,
  })
  .superRefine((value, ctx) =>
    refineSaleFields(
      {
        ...value,
        idempotencyKey: value.transactionId,
      },
      ctx,
    ),
  )

export const reverseGodownSaleSchema = z.object({
  transactionId: uuidLikeSchema,
  reason: z
    .string()
    .trim()
    .min(3, 'Enter a reason.')
    .max(500)
    .transform((value) => normalizeWhitespace(value)),
  confirmPhrase: z.literal('DELETE'),
})

export const recordEmptyReturnSchema = z.object({
  transactionId: uuidLikeSchema,
  idempotencyKey: uuidLikeSchema,
  originTransactionId: uuidLikeSchema,
  businessDate: isoDateSchema,
  emptyReturned: z.number().int().positive().max(100_000),
  /** Receiving location; defaults to the origin sale location when omitted. */
  locationId: z.string().trim().min(1).max(80).nullable().optional(),
  note: optionalNullableTrimmed(500),
})

export type CreateGodownSaleInput = z.infer<typeof createGodownSaleSchema>
export type UpdateGodownSaleInput = z.infer<typeof updateGodownSaleSchema>
export type ReverseGodownSaleInput = z.infer<typeof reverseGodownSaleSchema>
export type RecordEmptyReturnInput = z.infer<typeof recordEmptyReturnSchema>

/** Total sale is always received + due (integer paise). */
export function amountsFromReceivedAndDue(receivedPaise: number, duePaise: number) {
  return {
    receivedPaise,
    duePaise,
    salePaise: receivedPaise + duePaise,
  }
}

/** @deprecated Prefer amountsFromReceivedAndDue; kept for callers that already have sale + received. */
export function derivedSaleAmounts(salePaise: number, receivedPaise: number) {
  return {
    salePaise,
    receivedPaise,
    duePaise: salePaise - receivedPaise,
  }
}

export function derivedSaleQuantities(filledIssued: number, emptyReceived: number) {
  return {
    filledIssued,
    emptyReceived,
    emptyOutstanding: emptyOutstandingFromIssue(filledIssued, emptyReceived),
  }
}
