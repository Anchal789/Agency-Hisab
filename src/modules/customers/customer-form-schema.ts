import { z } from 'zod'
import { isValidConsumerNumber, normalizeConsumerNumber, normalizeWhitespace } from '@shared/models/customer'

export function buildCustomerFormSchema(messages: {
  firstName: string
  lastName: string
  consumerNumber: string
  consumerInvalid: string
  dateInvalid: string
}) {
  return z.object({
    firstName: z
      .string()
      .trim()
      .min(1, messages.firstName)
      .max(80)
      .transform((value) => normalizeWhitespace(value)),
    lastName: z
      .string()
      .trim()
      .min(1, messages.lastName)
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
      .min(1, messages.consumerNumber)
      .max(32)
      .transform((value) => normalizeConsumerNumber(value))
      .refine((value) => isValidConsumerNumber(value), messages.consumerInvalid),
    lastRefillDate: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), messages.dateInvalid),
  })
}

export type CustomerFormInput = z.infer<ReturnType<typeof buildCustomerFormSchema>>
