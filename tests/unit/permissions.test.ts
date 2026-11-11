import { describe, expect, it } from 'vitest'
import {
  canAccessDashboard,
  canAccessSettings,
  canAccessUsers,
  defaultAuthenticatedPath,
  emptyPermissions,
  isAdminRole,
  normalizePermissions,
} from '../../shared/rules/permissions'
import { parseUserProfile } from '../../shared/models/user'

describe('permissions and profile parsing', () => {
  it('normalizes unknown permission maps safely', () => {
    expect(normalizePermissions({ 'customers.view': true, unknown: true })).toEqual({
      ...emptyPermissions(),
      'customers.view': true,
    })
  })

  it('enforces documented dashboard/settings/users access policy', () => {
    const none = emptyPermissions()
    const some = { ...emptyPermissions(), 'godown.view': true }

    expect(canAccessDashboard('admin', none)).toBe(true)
    expect(canAccessDashboard('staff', none)).toBe(false)
    expect(canAccessDashboard('staff', some)).toBe(true)

    expect(canAccessSettings('admin')).toBe(true)
    expect(canAccessSettings('staff')).toBe(false)
    expect(canAccessUsers('staff')).toBe(false)

    expect(defaultAuthenticatedPath('staff', none)).toBe('/account')
    expect(defaultAuthenticatedPath('staff', some)).toBe('/')
  })

  it('parses permission maps from Firestore-shaped objects without dropping granted keys', () => {
    const fromFirestore = normalizePermissions({
      'customers.view': true,
      'godown.view': true,
      'godown.create': false,
      'godown.edit': false,
      'payments.create': true,
      'inventory.view': false,
      'vehicles.record': false,
      'expenses.create': false,
      'reports.viewAssigned': false,
    })
    expect(fromFirestore['customers.view']).toBe(true)
    expect(fromFirestore['payments.create']).toBe(true)
    expect(fromFirestore['inventory.view']).toBe(false)
  })

  it('rejects users without a role claim or phone', () => {
    expect(parseUserProfile('u1', { phoneE164: '+919876543210', displayName: 'A', role: 'admin', status: 'active' }, undefined)).toBeNull()
    expect(parseUserProfile('u1', { displayName: 'A', role: 'admin', status: 'active' }, 'admin')).toBeNull()
  })

  it('parses an admin profile from claim + document', () => {
    const profile = parseUserProfile(
      'u1',
      {
        phoneE164: '+919876543210',
        displayName: 'Admin',
        role: 'staff',
        status: 'active',
        language: 'hi',
        permissions: {},
        mustChangePassword: true,
      },
      'admin',
    )
    expect(profile?.role).toBe('admin')
    expect(profile?.language).toBe('hi')
    expect(profile?.phoneE164).toBe('+919876543210')
    expect(profile?.mustChangePassword).toBe(true)
    expect(isAdminRole(profile?.role)).toBe(true)
  })
})
