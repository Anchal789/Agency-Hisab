import type { StaffPermission } from '@shared/rules/permissions'

const labels: Record<StaffPermission, string> = {
  'customers.view': 'permissions.customers.view',
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
