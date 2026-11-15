import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  canApproveInventory,
  canCreateInventoryOpening,
  canCreateInventoryReceive,
  canCreateInventoryReconcile,
  canCreateInventoryTransfer,
} from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { PageContainer } from '@/components/common/PageContainer'
import { cn } from '@/utils/cn'
import { fetchPendingInventoryTransactions } from './inventory-query'

type NavItem = {
  id: string
  to: string
  label: string
  end?: boolean
  match: (pathname: string, search: string) => boolean
}

export function InventoryLayout() {
  const { t } = useTranslation()
  const { role, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const permissions = profile?.permissions
  const showPending = Boolean(role && canApproveInventory(role))
  const canOpen = Boolean(role && permissions && canCreateInventoryOpening(role, permissions))
  const canReceive = Boolean(role && permissions && canCreateInventoryReceive(role, permissions))
  const canTransfer = Boolean(role && permissions && canCreateInventoryTransfer(role, permissions))
  const canCount = Boolean(role && permissions && canCreateInventoryReconcile(role, permissions))

  const pendingQuery = useQuery({
    queryKey: ['inventory-pending'],
    queryFn: fetchPendingInventoryTransactions,
    enabled: showPending,
  })
  const pendingCount = pendingQuery.data?.length ?? 0

  const groups: Array<{ id: string; label: string; items: NavItem[] }> = [
    {
      id: 'overview',
      label: t('inventory.navGroup.overview'),
      items: [
        {
          id: 'dashboard',
          to: '/inventory',
          label: t('inventory.navDashboard'),
          end: true,
          match: (pathname: string) => pathname === '/inventory',
        },
        {
          id: 'locations',
          to: '/inventory/locations',
          label: t('inventory.navLocations'),
          match: (pathname: string) => pathname.startsWith('/inventory/locations'),
        },
      ],
    },
    {
      id: 'operations',
      label: t('inventory.navGroup.operations'),
      items: [
        ...(canOpen
          ? [{
              id: 'opening',
              to: '/inventory/opening',
              label: t('inventory.navOpening'),
              match: (pathname: string) => pathname.startsWith('/inventory/opening'),
            }]
          : []),
        ...(canReceive
          ? [{
              id: 'receive',
              to: '/inventory/receive',
              label: t('inventory.navReceive'),
              match: (pathname: string) => pathname.startsWith('/inventory/receive'),
            }]
          : []),
        ...(canTransfer
          ? [{
              id: 'transfer',
              to: '/inventory/transfer',
              label: t('inventory.navTransfer'),
              match: (pathname: string) => pathname.startsWith('/inventory/transfer'),
            }]
          : []),
        {
          id: 'agents',
          to: '/inventory/agents',
          label: t('inventory.navAgents'),
          match: (pathname: string) => pathname.startsWith('/inventory/agents'),
        },
      ],
    },
    {
      id: 'tracking',
      label: t('inventory.navGroup.tracking'),
      items: [
        {
          id: 'ledger',
          to: '/inventory/ledger',
          label: t('inventory.navLedger'),
          match: (pathname: string) => pathname.startsWith('/inventory/ledger'),
        },
        ...(canCount
          ? [{
              id: 'count',
              to: '/inventory/reconcile',
              label: t('inventory.navCount'),
              match: (pathname: string, search: string) =>
                pathname.startsWith('/inventory/reconcile') && !new URLSearchParams(search).get('tab'),
            },
            {
              id: 'reconciliation',
              to: '/inventory/reconcile?tab=history',
              label: t('inventory.navReconcile'),
              match: (pathname: string, search: string) =>
                pathname.startsWith('/inventory/reconcile') && new URLSearchParams(search).get('tab') === 'history',
            }]
          : []),
        ...(showPending
          ? [{
              id: 'pending',
              to: '/inventory/pending',
              label: pendingCount > 0 ? `${t('inventory.navPending')} (${pendingCount})` : t('inventory.navPending'),
              match: (pathname: string) => pathname.startsWith('/inventory/pending'),
            }]
          : []),
      ],
    },
    {
      id: 'reports',
      label: t('inventory.navGroup.reports'),
      items: [
        {
          id: 'reports',
          to: '/inventory/reports',
          label: t('inventory.navReports'),
          match: (pathname: string) => pathname.startsWith('/inventory/reports'),
        },
      ],
    },
  ]

  const flat = groups.flatMap((group) => group.items)
  const current = flat.find((item) => item.match(location.pathname, location.search)) ?? flat[0]

  return (
    <PageContainer className="pb-28 md:pb-7">
      <div className="lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className="mb-5 lg:sticky lg:top-4 lg:mb-0">
          <label className="block lg:hidden">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('inventory.section')}</span>
            <select
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
              aria-label={t('inventory.section')}
              value={current?.id ?? 'dashboard'}
              onChange={(event) => {
                const next = flat.find((item) => item.id === event.target.value)
                if (next) navigate(next.to)
              }}
            >
              {groups.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <nav className="hidden rounded-xl border border-border bg-card p-3 lg:block" aria-label={t('inventory.title')} data-testid="inventory-nav">
            {groups.map((group) => (
              <div key={group.id} className="mb-4 last:mb-0">
                <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</p>
                <div className="grid gap-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.id}
                      to={item.to}
                      end={item.end}
                      className={() =>
                        cn(
                          'rounded-md px-2 py-2 text-sm',
                          item.match(location.pathname, location.search)
                            ? 'bg-accent font-semibold text-accent-foreground'
                            : 'text-foreground hover:bg-muted',
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </PageContainer>
  )
}
