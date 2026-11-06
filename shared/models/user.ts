import { isAppRole, normalizePermissions, type AppRole, type PermissionMap } from '../rules/permissions'

export type UserProfile = {
  uid: string
  phoneE164: string
  displayName: string
  role: AppRole
  status: 'active' | 'disabled'
  permissions: PermissionMap
  language: 'en' | 'hi'
  mustChangePassword: boolean
}

export function parseUserProfile(uid: string, data: Record<string, unknown>, claimRole: unknown): UserProfile | null {
  if (!isAppRole(claimRole)) return null
  const phoneE164 = typeof data.phoneE164 === 'string' ? data.phoneE164 : ''
  if (!phoneE164) return null
  return {
    uid,
    phoneE164,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    role: claimRole,
    status: data.status === 'disabled' ? 'disabled' : 'active',
    permissions: normalizePermissions(data.permissions),
    language: data.language === 'hi' ? 'hi' : 'en',
    mustChangePassword: data.mustChangePassword === true,
  }
}
