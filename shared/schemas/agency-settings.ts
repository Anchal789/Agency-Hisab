import { z } from 'zod'
import { AGENCY_CURRENCIES, AGENCY_TIMEZONES } from '../models/agency-config'

/** Callable JSON often turns missing ids into null; treat null/empty as “create”. */
const optionalDocIdSchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return undefined
  return value
}, z.string().trim().min(1).max(80).optional())

const namedItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  active: z.boolean(),
})

const receivingAccountSchema = namedItemSchema.extend({
  kind: z.enum(['cash', 'upi', 'bank', 'portal', 'other']),
})

function noDuplicateNames<T extends { name: string; id: string }>(items: T[], ctx: z.RefinementCtx, path: string) {
  const seen = new Map<string, string>()
  for (const item of items) {
    const key = item.name.trim().toLowerCase()
    const previous = seen.get(key)
    if (previous && previous !== item.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate names are not allowed.', path: [path] })
      return
    }
    seen.set(key, item.id)
  }
}

export const updateAgencyProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.enum(AGENCY_TIMEZONES),
  currency: z.enum(AGENCY_CURRENCIES),
})

export const setPaymentMethodsSchema = z
  .object({
    items: z.array(namedItemSchema).max(40),
  })
  .superRefine((value, ctx) => noDuplicateNames(value.items, ctx, 'items'))

export const setReceivingAccountsSchema = z
  .object({
    items: z.array(receivingAccountSchema).max(40),
  })
  .superRefine((value, ctx) => noDuplicateNames(value.items, ctx, 'items'))

export const upsertLocationSchema = z.object({
  id: optionalDocIdSchema,
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['godown', 'other']),
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
