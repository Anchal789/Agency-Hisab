import { z } from 'zod'

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

/** Transaction / session ids are UUID-like; reject human-readable notes (e.g. spaces). */
const uuidLikeSchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/, 'Select a stock receipt from the list (transaction id required).')

const moneyPaise = z.number().int().nonnegative().max(1_000_000_000)

function optionalNullableTrimmed(max: number) {
  return z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined ? undefined : value))
}

export const beginFinancialOpeningSealSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  openingDate: isoDateSchema,
  anchorTransactionId: uuidLikeSchema,
  anchorDateMismatchReason: optionalNullableTrimmed(500),
})

export const saveOpeningBalanceSheetSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
  balances: z
    .array(
      z.object({
        accountId: z.string().trim().min(1).max(80),
        amountPaise: moneyPaise,
      }),
    )
    .min(1)
    .max(40),
  ownerLoanOutstandingPaise: moneyPaise,
  ownerLoanVerified: z.literal(true),
})

export const planFinancialOpeningSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
})

export const prepareOpeningChunkSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
  chunkId: z.string().trim().min(1).max(200),
})

export const verifyOpeningReceivableSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
  saleId: uuidLikeSchema,
  decision: z.enum(['include', 'exclude']),
  approvedAmountPaise: moneyPaise,
  reason: optionalNullableTrimmed(500),
})

export const materializeOpeningReceivablesSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
  saleIds: z.array(uuidLikeSchema).min(1).max(40),
})

export const buildOpeningRollupSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
})

export const markOpeningReadySchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
})

export const publishFinancialOpeningSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  generationId: uuidLikeSchema,
})

export const abandonFinancialOpeningSealSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  sessionId: uuidLikeSchema,
  fence: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
})

export const listOpeningReviewsSchema = z.object({
  sessionId: uuidLikeSchema,
  generationId: uuidLikeSchema,
  cursor: z.string().trim().max(80).optional(),
  limit: z.number().int().positive().max(100).optional(),
})

export const releaseFutureDatedTransactionSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  saleId: uuidLikeSchema,
  earlyReleaseReason: optionalNullableTrimmed(500),
})

export const createManualOpeningReceivableSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  customerId: z.string().trim().min(1).max(80),
  amountPaise: moneyPaise.refine((value) => value > 0, 'Amount must be greater than zero.'),
  reason: z.string().trim().min(3).max(500),
  businessDate: isoDateSchema,
})

export const linkOpeningReceivableSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  saleId: uuidLikeSchema,
  obligationId: uuidLikeSchema,
})

export const createOpeningReceivableAdjustmentSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  saleId: uuidLikeSchema,
  newOutstandingPaise: moneyPaise,
  reason: z.string().trim().min(3).max(500),
})

export const resolveHistoricalGodownSaleFinanceSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  saleId: uuidLikeSchema,
  resolution: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('create_opening_receivable'),
      approvedAmountPaise: moneyPaise,
      reason: z.string().trim().min(3).max(500),
    }),
    z.object({
      kind: z.literal('link_existing_receivable'),
      obligationId: uuidLikeSchema,
      reason: z.string().trim().min(3).max(500),
    }),
    z.object({
      kind: z.literal('no_receivable'),
      reason: z.string().trim().min(3).max(500),
    }),
    z.object({
      kind: z.literal('block_pending_reconciliation'),
      reason: z.string().trim().min(3).max(500),
    }),
  ]),
  historicalCollection: z.discriminatedUnion('status', [
    z.object({ status: z.literal('none') }),
    z.object({ status: z.literal('verified_not_in_current_cash'), note: z.string().trim().min(1).max(500) }),
    z.object({ status: z.literal('incomplete') }),
  ]),
})

export type BeginFinancialOpeningSealInput = z.infer<typeof beginFinancialOpeningSealSchema>
export type SaveOpeningBalanceSheetInput = z.infer<typeof saveOpeningBalanceSheetSchema>
export type ResolveHistoricalGodownSaleFinanceInput = z.infer<
  typeof resolveHistoricalGodownSaleFinanceSchema
>
