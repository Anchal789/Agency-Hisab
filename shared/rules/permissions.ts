export const STAFF_PERMISSION_KEYS = [
  'customers.view',
  'customers.create',
  'customers.edit',
  'godown.view',
  'godown.create',
  'godown.edit',
  'payments.create',
  'inventory.view',
  'vehicles.record',
  'expenses.create',
  'reports.viewAssigned',
] as const

export type StaffPermission = (typeof STAFF_PERMISSION_KEYS)[number]
export type AppRole = 'admin' | 'staff'
export type PermissionMap = Record<StaffPermission, boolean>

export const PASSWORD_MIN_LENGTH = 8

export function emptyPermissions(): PermissionMap {
  return {
    'customers.view': false,
    'customers.create': false,
    'customers.edit': false,
    'godown.view': false,
    'godown.create': false,
    'godown.edit': false,
    'payments.create': false,
    'inventory.view': false,
    'vehicles.record': false,
    'expenses.create': false,
    'reports.viewAssigned': false,
  }
}

export function normalizePermissions(input: unknown): PermissionMap {
  const permissions = emptyPermissions()
  if (!input || typeof input !== 'object') return permissions
  const record = input as Record<string, unknown>
  for (const key of STAFF_PERMISSION_KEYS) {
    permissions[key] = record[key] === true
  }
  return permissions
}

export function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'staff'
}

export function isAdminRole(value: unknown): value is 'admin' {
  return value === 'admin'
}

export function hasStaffPermission(permissions: PermissionMap, key: StaffPermission): boolean {
  return permissions[key] === true
}

export function hasAnyStaffPermission(permissions: PermissionMap): boolean {
  return STAFF_PERMISSION_KEYS.some((key) => permissions[key] === true)
}

/**
 * Phase 1+ navigation / route policy (documented):
 * - Admin: sees every nav entry. Implemented routes are links; unimplemented entries show as "Later".
 * - Settings and Users: administrator only (routes + nav).
 * - Dashboard (`/`): admin always; staff only when they have at least one staff permission.
 *   Zero-permission staff may still sign in for account/password flows, but not the dashboard.
 * - Staff module nav: show an entry when the matching permission is true.
 *   Unimplemented modules remain visible as non-link "Later" placeholders (no working route).
 * - Never expose a working route for an unimplemented module.
 */
export function canAccessDashboard(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasAnyStaffPermission(permissions)
}

export function canAccessSettings(role: AppRole): boolean {
  return role === 'admin'
}

export function canAccessUsers(role: AppRole): boolean {
  return role === 'admin'
}

export function canViewCustomers(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasStaffPermission(permissions, 'customers.view')
}

export function canCreateCustomers(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasStaffPermission(permissions, 'customers.create')
}

export function canEditCustomers(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasStaffPermission(permissions, 'customers.edit')
}

export function canViewGodown(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasStaffPermission(permissions, 'godown.view')
}

export function canCreateGodown(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasStaffPermission(permissions, 'godown.create')
}

export function canEditGodown(role: AppRole, permissions: PermissionMap): boolean {
  if (role === 'admin') return true
  return hasStaffPermission(permissions, 'godown.edit')
}

/** Physical delete is never allowed; admin may reverse today's godown entry only. */
export function canReverseGodown(role: AppRole): boolean {
  return role === 'admin'
}

export function defaultAuthenticatedPath(role: AppRole, permissions: PermissionMap): string {
  return canAccessDashboard(role, permissions) ? '/' : '/account'
}

export const NAV_MODULE_KEYS = [
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
] as const

export type NavModuleKey = (typeof NAV_MODULE_KEYS)[number]

/** Modules that currently have a working in-app route. */
export const IMPLEMENTED_NAV_MODULES: ReadonlySet<NavModuleKey> = new Set([
  'dashboard',
  'godown',
  'customers',
  'users',
  'settings',
])

/** Map staff permissions to nav module keys for visibility. */
export function staffPermissionForNavKey(navKey: string): StaffPermission | null {
  switch (navKey) {
    case 'customers':
      return 'customers.view'
    case 'godown':
      return 'godown.view'
    case 'inventory':
      return 'inventory.view'
    case 'dues':
      return 'payments.create'
    case 'reports':
      return 'reports.viewAssigned'
    case 'hisab':
      return 'reports.viewAssigned'
    default:
      return null
  }
}

export function isNavModuleImplemented(navKey: NavModuleKey): boolean {
  return IMPLEMENTED_NAV_MODULES.has(navKey)
}

/**
 * Whether a nav entry should appear for this role/permission set.
 * Visibility is separate from whether the module route is implemented.
 */
export function canViewNavModule(role: AppRole, permissions: PermissionMap, navKey: NavModuleKey): boolean {
  if (navKey === 'dashboard') return canAccessDashboard(role, permissions)
  if (navKey === 'users') return canAccessUsers(role)
  if (navKey === 'settings') return canAccessSettings(role)
  if (navKey === 'approvals') return role === 'admin'

  if (role === 'admin') return true

  const permission = staffPermissionForNavKey(navKey)
  if (!permission) return false
  return hasStaffPermission(permissions, permission)
}

/** Visible nav keys in sidebar order for the given actor. */
export function visibleNavModules(role: AppRole, permissions: PermissionMap): NavModuleKey[] {
  return NAV_MODULE_KEYS.filter((key) => canViewNavModule(role, permissions, key))
}
