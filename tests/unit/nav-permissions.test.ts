import { describe, expect, it } from 'vitest'
import {
  canViewNavModule,
  emptyPermissions,
  isNavModuleImplemented,
  visibleNavModules,
  type PermissionMap,
} from '../../shared/rules/permissions'

function withPerms(keys: Array<keyof PermissionMap>): PermissionMap {
  const permissions = emptyPermissions()
  for (const key of keys) permissions[key] = true
  return permissions
}

describe('navigation permission matrix', () => {
  it('shows admin every module; only dashboard/users/settings are implemented routes', () => {
    const keys = visibleNavModules('admin', emptyPermissions())
    expect(keys).toEqual([
      'dashboard',
      'godown',
      'hisab',
      'customers',
      'inventory',
      'dues',
      'approvals',
      'reports',
      'users',
      'settings',
    ])
    expect(isNavModuleImplemented('customers')).toBe(false)
    expect(isNavModuleImplemented('dashboard')).toBe(true)
    expect(isNavModuleImplemented('users')).toBe(true)
    expect(isNavModuleImplemented('settings')).toBe(true)
  })

  it('shows zero-permission staff no operational modules (account is outside this nav list)', () => {
    expect(visibleNavModules('staff', emptyPermissions())).toEqual([])
    expect(canViewNavModule('staff', emptyPermissions(), 'dashboard')).toBe(false)
    expect(canViewNavModule('staff', emptyPermissions(), 'customers')).toBe(false)
  })

  it('shows customers when only customers.view is granted', () => {
    const permissions = withPerms(['customers.view'])
    expect(visibleNavModules('staff', permissions)).toEqual(['dashboard', 'customers'])
    expect(canViewNavModule('staff', permissions, 'customers')).toBe(true)
    expect(canViewNavModule('staff', permissions, 'inventory')).toBe(false)
    expect(canViewNavModule('staff', permissions, 'settings')).toBe(false)
  })

  it('shows inventory when only inventory.view is granted', () => {
    const permissions = withPerms(['inventory.view'])
    expect(visibleNavModules('staff', permissions)).toEqual(['dashboard', 'inventory'])
  })

  it('shows exactly two modules when two permissions are granted', () => {
    const permissions = withPerms(['customers.view', 'godown.create'])
    expect(visibleNavModules('staff', permissions)).toEqual(['dashboard', 'godown', 'customers'])
  })

  it('shows all staff-authorized modules when all permissions are granted', () => {
    const permissions = withPerms([
      'customers.view',
      'godown.create',
      'payments.create',
      'inventory.view',
      'vehicles.record',
      'expenses.create',
      'reports.viewAssigned',
    ])
    expect(visibleNavModules('staff', permissions)).toEqual([
      'dashboard',
      'godown',
      'hisab',
      'customers',
      'inventory',
      'dues',
      'reports',
    ])
    expect(canViewNavModule('staff', permissions, 'users')).toBe(false)
    expect(canViewNavModule('staff', permissions, 'settings')).toBe(false)
    expect(canViewNavModule('staff', permissions, 'approvals')).toBe(false)
  })

  it('removes a module when its permission is revoked', () => {
    const before = withPerms(['customers.view', 'inventory.view'])
    const after = withPerms(['inventory.view'])
    expect(canViewNavModule('staff', before, 'customers')).toBe(true)
    expect(canViewNavModule('staff', after, 'customers')).toBe(false)
    expect(visibleNavModules('staff', after)).toEqual(['dashboard', 'inventory'])
  })
})
