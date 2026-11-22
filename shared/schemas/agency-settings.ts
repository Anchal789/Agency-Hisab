import { z } from 'zod'
import {
  AGENCY_CURRENCIES,
  AGENCY_TIMEZONES,
  LOCATION_KINDS,
  normalizePaymentCategory,
  PAYMENT_CATEGORIES,
} from '../models/agency-config'
import {
  findDuplicateConfigKeyInList,
  paymentMethodUniquenessKey,
  receivingAccountUniquenessKey,
} from '../rules/settings-uniqueness'

/** Callable JSON often turns missing ids into null; treat null/empty as “create”. */
const optionalDocIdSchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return undefined
  return value
}, z.string().trim().min(1).max(80).optional())

const paymentCategorySchema = z.preprocess((value) => {
  const normalized = normalizePaymentCategory(value)
  return normalized ?? value
}, z.enum(PAYMENT_CATEGORIES))

const namedItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  active: z.boolean(),
})

const paymentMethodSchema = namedItemSchema.extend({
  kind: paymentCategorySchema,
})

const ownershipSchema = z.enum(['agency', 'third_party_held', 'portal'])

const receivingAccountSchema = namedItemSchema.extend({
  kind: paymentCategorySchema,
  ownership: ownershipSchema.optional(),
  compatiblePaymentMethodIds: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
})

function noDuplicateNameCategoryKeys<T extends { id: string; name: string; kind: string }>(
  items: T[],
  ctx: z.RefinementCtx,
  path: string,
  keyFor: (item: T) => string,
  message: string,
) {
  const duplicate = findDuplicateConfigKeyInList(items, keyFor)
  if (duplicate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] })
  }
}

export const updateAgencyProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.enum(AGENCY_TIMEZONES),
  currency: z.enum(AGENCY_CURRENCIES),
  inventoryCutoverDate: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
      z.null(),
    ])
    .optional(),
})

export const setPaymentMethodsSchema = z
  .object({
    items: z.array(paymentMethodSchema).max(40),
  })
  .superRefine((value, ctx) =>
    noDuplicateNameCategoryKeys(
      value.items,
      ctx,
      'items',
      paymentMethodUniquenessKey,
      'Duplicate payment method names are not allowed within the same category.',
    ),
  )

export const setReceivingAccountsSchema = z
  .object({
    items: z.array(receivingAccountSchema).max(40),
  })
  .superRefine((value, ctx) =>
    noDuplicateNameCategoryKeys(
      value.items,
      ctx,
      'items',
      receivingAccountUniquenessKey,
      'Duplicate destination names are not allowed within the same category.',
    ),
  )

export const upsertLocationSchema = z.object({
  id: optionalDocIdSchema,
  name: z.string().trim().min(2).max(80),
  kind: z.enum(LOCATION_KINDS),
  active: z.boolean(),
})

export const deleteByIdSchema = z.object({
  id: z.string().trim().min(1).max(80),
})

export const upsertProductSchema = z.object({
  id: optionalDocIdSchema,
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(1).max(40),
  kind: z.enum(['cylinder', 'accessory', 'other']),
  unit: z.string().trim().min(1).max(40),
  active: z.boolean(),
})

export const upsertPriceRuleSchema = z.object({
  id: optionalDocIdSchema,
  productId: z.string().trim().min(1).max(80),
  label: z.string().trim().min(2).max(80),
  amountPaise: z.number().int().nonnegative().max(1_000_000_000),
  active: z.boolean(),
})

export const manageAgencyConfigSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('updateProfile'), payload: updateAgencyProfileSchema }),
  z.object({ action: z.literal('setPaymentMethods'), payload: setPaymentMethodsSchema }),
  z.object({ action: z.literal('setReceivingAccounts'), payload: setReceivingAccountsSchema }),
  z.object({ action: z.literal('upsertLocation'), payload: upsertLocationSchema }),
  z.object({ action: z.literal('deleteLocation'), payload: deleteByIdSchema }),
  z.object({ action: z.literal('upsertProduct'), payload: upsertProductSchema }),
  z.object({ action: z.literal('deleteProduct'), payload: deleteByIdSchema }),
  z.object({ action: z.literal('upsertPriceRule'), payload: upsertPriceRuleSchema }),
  z.object({ action: z.literal('deletePriceRule'), payload: deleteByIdSchema }),
])

export type ManageAgencyConfigInput = z.infer<typeof manageAgencyConfigSchema>
