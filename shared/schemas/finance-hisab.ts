import { z } from 'zod'

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

const uuidLikeSchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id.')

const moneyPaisePositive = z.number().int().positive().max(1_000_000_000)

export const getMainHisabDashboardSchema = z.object({
  businessDate: isoDateSchema.optional(),
})

export const listHisabDayLedgerSchema = z.object({
  businessDate: isoDateSchema,
  limit: z.number().int().positive().max(200).optional(),
  cursor: z.string().trim().max(200).optional(),
})

export const listHisabCashbookSchema = z.object({
  accountId: z.string().trim().min(1).max(80),
  businessDate: isoDateSchema.optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
  cursor: z.string().trim().max(200).optional(),
})

export const createFundTransferSchema = z.object({
  idempotencyKey: uuidLikeSchema,
  transactionId: uuidLikeSchema,
  sourceAccountId: z.string().trim().min(1).max(80),
  destinationAccountId: z.string().trim().min(1).max(80),
  amountPaise: moneyPaisePositive,
  businessDate: isoDateSchema,
  note: z
    .union([z.string().trim().max(500), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined || value === '' ? undefined : value)),
})

export const getFundTransferSchema = z.object({
  transactionId: uuidLikeSchema,
})
