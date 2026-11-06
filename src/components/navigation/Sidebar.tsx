import {
  BookOpen,
  Boxes,
  ClipboardCheck,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  canViewNavModule,
  isNavModuleImplemented,
  type AppRole,
  type NavModuleKey,
  type PermissionMap,
} from '@shared/rules/permissions'
import { Mark } from '@/components/brand/Mark'
import { cn } from '@/utils/cn'

type NavItem = {
  key: NavModuleKey
  to?: string
  label: string
  icon: LucideIcon
}

export function Sidebar({
  collapsed,
  role,
  permissions,
  onNavigate,
}: {
  collapsed: boolean
  role: AppRole | null
  permissions: PermissionMap
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const effectiveRole: AppRole = role ?? 'staff'

  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: t('nav.operations'),
      items: [
        { key: 'dashboard', to: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
        { key: 'godown', label: t('nav.godown'), icon: Warehouse },
        { key: 'hisab', label: t('nav.hisab'), icon: BookOpen },
      ],
    },
    {
      title: t('nav.records'),
      items: [
        { key: 'customers', label: t('nav.customers'), icon: Users },
        { key: 'inventory', label: t('nav.inventory'), icon: Boxes },
        { key: 'dues', label: t('nav.dues'), icon: Receipt },
        { key: 'approvals', label: t('nav.approvals'), icon: ClipboardCheck },
        { key: 'reports', label: t('nav.reports'), icon: ClipboardCheck },
      ],
    },
    {
      title: t('nav.admin'),
      items: [
        { key: 'users', to: '/users', label: t('nav.users'), icon: Users },
        { key: 'settings', to: '/settings', label: t('nav.settings'), icon: Settings },
      ],
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center gap-3 px-4 py-4', collapsed && 'justify-center px-2')}>
        <Mark className="h-9 w-9 shrink-0" />
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{t('appName')}</p>
            <p className="truncate text-xs text-sidebar-muted">{t('agencyName')}</p>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4" aria-label="Primary">
        {sections.map((section) => {
          const items = section.items.filter((item) => canViewNavModule(effectiveRole, permissions, item.key))
          if (items.length === 0) return null
          return (
            <div key={section.title}>
              {collapsed ? null : (
                <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-sidebar-muted uppercase">{section.title}</p>
              )}
              <ul className="space-y-1">
                {items.map((item) => {
                  const implemented = isNavModuleImplemented(item.key) && Boolean(item.to)
                  return (
                    <li key={item.key}>
                      {implemented && item.to ? (
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={onNavigate}
                          title={item.label}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-white/10',
                              collapsed && 'justify-center px-2',
                              isActive && 'bg-accent text-white hover:bg-accent',
                            )
                          }
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {collapsed ? null : <span className="truncate">{item.label}</span>}
                        </NavLink>
                      ) : (
                        <div
                          title={t('nav.later')}
                          aria-disabled="true"
                          data-testid={`nav-later-${item.key}`}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-muted',
                            collapsed && 'justify-center px-2',
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {collapsed ? null : (
                            <>
                              <span className="truncate">{item.label}</span>
                              <span className="ml-auto text-[10px] tracking-wide uppercase">{t('nav.later')}</span>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
    </div>
  )
}
