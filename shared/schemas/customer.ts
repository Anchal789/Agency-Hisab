import { z } from 'zod'
import {
  buildCustomerSearchTokens,
  buildDisplayName,
  isValidConsumerNumber,
  normalizeConsumerNumber,
  normalizeWhitespace,
} from '../models/customer'

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .nullable()
  .optional()

function requiredName(message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .max(80)
    .transform((value) => normalizeWhitespace(value))
}

export const customerFieldsSchema = z.object({
  firstName: requiredName('Enter the first name.'),
  // Empty last name is allowed (single-word full names from Excel Consumer Name).
  lastName: z
    .string()
    .trim()
    .max(80)
    .transform((value) => normalizeWhitespace(value)),
  address: z
    .string()
    .trim()
    .max(200)
    .transform((value) => normalizeWhitespace(value)),
  city: z
    .string()
    .trim()
    .max(80)
    .transform((value) => normalizeWhitespace(value)),
  consumerNumber: z
    .string()
    .trim()
    .min(1, 'Enter the consumer number.')
    .max(32)
    .transform((value) => normalizeConsumerNumber(value))
    .refine((value) => isValidConsumerNumber(value), 'Enter a valid consumer number.'),
  lastRefillDate: isoDateSchema,
})

export const createCustomerSchema = customerFieldsSchema

export const updateCustomerSchema = customerFieldsSchema.extend({
  id: z.string().trim().min(1),
})

export const checkConsumerNumbersSchema = z.object({
  consumerNumbers: z.array(z.string().trim().min(1).max(32)).max(2000),
})

export const commitCustomerImportSchema = z.object({
  batchId: z.string().trim().min(8).max(80),
  fileName: z.string().trim().min(1).max(200),
  records: z
    .array(
      customerFieldsSchema.extend({
        rowNumber: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(400),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
export type CommitCustomerImportInput = z.infer<typeof commitCustomerImportSchema>

export function customerWriteFields(input: CreateCustomerInput) {
  const firstName = input.firstName
  const lastName = input.lastName
  const address = input.address
  const city = input.city
  const consumerNumber = input.consumerNumber
  const lastRefillDate = input.lastRefillDate ?? null
  return {
    firstName,
    lastName,
    displayName: buildDisplayName(firstName, lastName),
    address,
    city,
    consumerNumber,
    consumerNumberLower: consumerNumber.toLowerCase(),
    lastRefillDate,
    status: 'active' as const,
    searchTokens: buildCustomerSearchTokens({ firstName, lastName, address, city, consumerNumber }),
  }
}
