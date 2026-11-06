import { z } from 'zod'
import { normalizeIndianMobile, PhoneValidationError } from '../auth/phone'
import { PASSWORD_MIN_LENGTH, STAFF_PERMISSION_KEYS, emptyPermissions } from '../rules/permissions'

const permissionShape = STAFF_PERMISSION_KEYS.reduce(
  (shape, key) => {
    shape[key] = z.boolean()
    return shape
  },
  {} as Record<(typeof STAFF_PERMISSION_KEYS)[number], z.ZodBoolean>,
)

export const permissionMapSchema = z.object(permissionShape).transform((value) => ({
  ...emptyPermissions(),
  ...value,
}))

export const phoneInputSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    try {
      return normalizeIndianMobile(value)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof PhoneValidationError ? error.message : 'Enter a valid Indian mobile number.',
      })
      return z.NEVER
    }
  })

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200)

export const createStaffSchema = z.object({
  phone: phoneInputSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(80),
  permissions: permissionMapSchema,
})

export const updateStaffAccessSchema = z
  .object({
    uid: z.string().min(1),
    status: z.enum(['active', 'disabled']).optional(),
    permissions: permissionMapSchema.optional(),
  })
  .refine((value) => value.status !== undefined || value.permissions !== undefined, {
    message: 'No changes were provided.',
  })

export const resetStaffPasswordSchema = z.object({
  uid: z.string().min(1),
  temporaryPassword: passwordSchema,
})

export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
})

export type CreateStaffInput = z.infer<typeof createStaffSchema>
export type UpdateStaffAccessInput = z.infer<typeof updateStaffAccessSchema>
export type ResetStaffPasswordInput = z.infer<typeof resetStaffPasswordSchema>
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>
