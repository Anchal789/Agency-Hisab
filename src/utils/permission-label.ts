import type { StaffPermission } from '@shared/rules/permissions'

const labels: Record<StaffPermission, string> = {
  'customers.view': 'permissions.customers.view',
  'customers.create': 'permissions.customers.create',
  'customers.edit': 'permissions.customers.edit',
  'godown.create': 'permissions.godown.create',
  'payments.create': 'permissions.payments.create',
  'inventory.view': 'permissions.inventory.view',
  'vehicles.record': 'permissions.vehicles.record',
  'expenses.create': 'permissions.expenses.create',
  'reports.viewAssigned': 'permissions.reports.viewAssigned',
}

export function permissionLabelKey(permission: StaffPermission): string {
  return labels[permission]
}
