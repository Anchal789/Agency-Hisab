import { describe, expect, it } from 'vitest'
import { emptyPermissions } from '../../shared/rules/permissions'
import {
  changeOwnPasswordSchema,
  createStaffSchema,
  resetStaffPasswordSchema,
  updateStaffAccessSchema,
} from '../../shared/schemas/staff'

describe('staff schemas', () => {
  it('rejects empty required create fields and invalid phones', () => {
    expect(createStaffSchema.safeParse({ displayName: '', phone: '', password: 'short', permissions: emptyPermissions() }).success).toBe(
      false,
    )
    expect(
      createStaffSchema.safeParse({
        displayName: 'A',
        phone: '123',
        password: 'longenough',
        permissions: emptyPermissions(),
      }).success,
    ).toBe(false)
  })

  it('normalizes valid Indian phones and accepts create payloads', () => {
    const parsed = createStaffSchema.safeParse({
      displayName: 'Staff One',
      phone: '9876543210',
      password: 'longenough',
      permissions: { ...emptyPermissions(), 'customers.view': true },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.phone).toBe('+919876543210')
  })

  it('requires status or permissions for access updates', () => {
    expect(updateStaffAccessSchema.safeParse({ uid: 'staff1' }).success).toBe(false)
    expect(
      updateStaffAccessSchema.safeParse({
        uid: 'staff1',
        permissions: { ...emptyPermissions(), 'inventory.view': true },
      }).success,
    ).toBe(true)
  })

  it('rejects mismatched or short passwords on change/reset', () => {
    expect(changeOwnPasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success).toBe(false)
    expect(changeOwnPasswordSchema.safeParse({ currentPassword: 'oldpass12', newPassword: 'newpass12' }).success).toBe(true)
    expect(resetStaffPasswordSchema.safeParse({ uid: 'staff1', temporaryPassword: 'short' }).success).toBe(false)
  })
})
