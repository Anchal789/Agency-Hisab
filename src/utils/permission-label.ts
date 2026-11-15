import type { StaffPermission } from '@shared/rules/permissions'

const labels: Record<StaffPermission, string> = {
  'customers.view': 'permissions.customers.view',
  'customers.create': 'permissions.customers.create',
  'customers.edit': 'permissions.customers.edit',
  'godown.view': 'permissions.godown.view',
  'godown.create': 'permissions.godown.create',
  'godown.edit': 'permissions.godown.edit',
  'payments.create': 'permissions.payments.create',
  'inventory.view': 'permissions.inventory.view',
  'inventory.openingStock': 'permissions.inventory.openingStock',
  'inventory.transfer': 'permissions.inventory.transfer',
  'inventory.receive': 'permissions.inventory.receive',
  'inventory.reconcile': 'permissions.inventory.reconcile',
  'vehicles.record': 'permissions.vehicles.record',
  'expenses.create': 'permissions.expenses.create',
  'reports.viewAssigned': 'permissions.reports.viewAssigned',
}

export function permissionLabelKey(permission: StaffPermission): string {
  return labels[permission]
}
