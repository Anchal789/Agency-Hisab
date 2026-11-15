import { z } from 'zod'
import { INVENTORY_STATES, INVENTORY_TRANSACTION_TYPES } from '../models/inventory'

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')

const uuidLikeSchema = z.string().trim().min(8).max(80)
const nonNegInt = z.number().int().nonnegative().max(100_000)

function optionalNullableTrimmed(max: number) {
  return z
    .union([
      z
        .string()
        .trim()
        .max(max)
        .transform((value) => value),
      z.null(),
    ])
    .optional()
}

const inventoryTxIds = z.object({
  transactionId: uuidLikeSchema,
  idempotencyKey: uuidLikeSchema,
})

export const createStockOpeningSchema = inventoryTxIds.extend({
  businessDate: isoDateSchema,
  locationId: z.string().trim().min(1).max(80),
  productId: z.string().trim().min(1).max(80),
  filledQuantity: nonNegInt,
  emptyQuantity: nonNegInt,
  damagedQuantity: nonNegInt,
  note: optionalNullableTrimmed(500),
}).superRefine((value, ctx) => {
  if (value.filledQuantity + value.emptyQuantity + value.damagedQuantity < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Enter at least one cylinder quantity for opening stock.',
      path: ['filledQuantity'],
    })
  }
})

export const createStockReceiptSchema = inventoryTxIds.extend({
  businessDate: isoDateSchema,
  locationId: z.string().trim().min(1).max(80),
  productId: z.string().trim().min(1).max(80),
  filledQuantity: nonNegInt,
  emptyQuantity: nonNegInt,
  damagedQuantity: nonNegInt,
  note: optionalNullableTrimmed(500),
}).superRefine((value, ctx) => {
  if (value.filledQuantity + value.emptyQuantity + value.damagedQuantity < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Enter at least one cylinder quantity.',
      path: ['filledQuantity'],
    })
  }
})

export const createStockReturnToDistributorSchema = createStockReceiptSchema

export const createStockTransferSchema = inventoryTxIds.extend({
  businessDate: isoDateSchema,
  sourceLocationId: z.string().trim().min(1).max(80),
  destinationLocationId: z.string().trim().min(1).max(80),
  productId: z.string().trim().min(1).max(80),
  state: z.enum(INVENTORY_STATES),
  quantity: z.number().int().positive().max(100_000),
  note: optionalNullableTrimmed(500),
}).superRefine((value, ctx) => {
  if (value.sourceLocationId === value.destinationLocationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Source and destination locations must be different.',
      path: ['destinationLocationId'],
    })
  }
})

export const createStockReconciliationSchema = inventoryTxIds.extend({
  businessDate: isoDateSchema,
  locationId: z.string().trim().min(1).max(80),
  productId: z.string().trim().min(1).max(80),
  actualFilled: nonNegInt,
  actualEmpty: nonNegInt,
  actualDamaged: nonNegInt,
  reason: z
    .string()
    .trim()
    .min(3, 'Enter a reason for the adjustment.')
    .max(500),
  note: optionalNullableTrimmed(500),
})

export const approveInventoryTransactionSchema = z.object({
  transactionId: uuidLikeSchema,
})

export const rejectInventoryTransactionSchema = z.object({
  transactionId: uuidLikeSchema,
  reason: z
    .string()
    .trim()
    .min(3, 'Enter a rejection reason.')
    .max(500),
})

export const setInventoryCutoverDateSchema = z.object({
  inventoryCutoverDate: isoDateSchema.nullable(),
})

export const inventoryTransactionTypeSchema = z.enum(INVENTORY_TRANSACTION_TYPES)

export type CreateStockOpeningInput = z.infer<typeof createStockOpeningSchema>
export type CreateStockReceiptInput = z.infer<typeof createStockReceiptSchema>
export type CreateStockReturnToDistributorInput = z.infer<typeof createStockReturnToDistributorSchema>
export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>
export type CreateStockReconciliationInput = z.infer<typeof createStockReconciliationSchema>
export type ApproveInventoryTransactionInput = z.infer<typeof approveInventoryTransactionSchema>
export type RejectInventoryTransactionInput = z.infer<typeof rejectInventoryTransactionSchema>
