import { LayoutDashboard, Menu, Settings, UserRound } from 'lucide-react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { canAccessDashboard, canAccessSettings } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { cn } from '@/utils/cn'

export function MobileNavigation({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useTranslation()
  const { role, profile } = useAuth()
  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn('flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted-foreground')

  const showDashboard = Boolean(role && profile && canAccessDashboard(role, profile.permissions))
  const showSettings = canAccessSettings(role ?? 'staff')

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile"
    >
      <div className="flex">
        {showDashboard ? (
          <NavLink to="/" end className={itemClass}>
            <LayoutDashboard className="h-5 w-5" />
            {t('nav.dashboard')}
          </NavLink>
        ) : (
          <NavLink to="/account" className={itemClass}>
            <UserRound className="h-5 w-5" />
            {t('nav.account')}
          </NavLink>
        )}
        <button type="button" className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground" onClick={onOpenMenu}>
          <Menu className="h-5 w-5" />
          {t('nav.menu')}
        </button>
        {showSettings ? (
          <NavLink to="/settings" className={itemClass}>
            <Settings className="h-5 w-5" />
            {t('nav.settings')}
          </NavLink>
        ) : showDashboard ? (
          <NavLink to="/account" className={itemClass}>
            <UserRound className="h-5 w-5" />
            {t('nav.account')}
          </NavLink>
        ) : (
          <span className="flex-1" aria-hidden="true" />
        )}
      </div>
    </nav>
  )
}
