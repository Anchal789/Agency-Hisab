import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { emptyPermissions } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { OfflineStatusIndicator } from '@/components/common/OfflineStatusIndicator'
import { SyncStatusIndicator } from '@/components/common/SyncStatusIndicator'
import { MobileNavigation } from '@/components/navigation/MobileNavigation'
import { NotificationMenu } from '@/components/navigation/NotificationMenu'
import { ProfileMenu } from '@/components/navigation/ProfileMenu'
import { Sidebar } from '@/components/navigation/Sidebar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { setDocumentLanguage } from '@/i18n'
import i18n from '@/i18n'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getFirebase } from '@/services/firebase/client'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/utils/cn'

export function AppShell() {
  const { t } = useTranslation()
  const { role, profile } = useAuth()
  const online = useOnlineStatus()
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const mobileOpen = useUiStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const permissions = profile?.permissions ?? emptyPermissions()

  async function switchLanguage(language: 'en' | 'hi') {
    await i18n.changeLanguage(language)
    setDocumentLanguage(language)
    if (!profile) return
    await updateDoc(doc(getFirebase().db, 'users', profile.uid), {
      language,
      updatedAt: serverTimestamp(),
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden bg-sidebar text-sidebar-foreground md:block', collapsed ? 'w-[4.5rem]' : 'w-64')}>
        <Sidebar collapsed={collapsed} role={role} permissions={permissions} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent aria-describedby={undefined}>
          <Sidebar role={role} permissions={permissions} collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className={cn('flex min-h-screen flex-col pb-16 md:pb-0', collapsed ? 'md:pl-[4.5rem]' : 'md:pl-64')}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-[calc(1.25rem*1.25)] backdrop-blur md:px-[calc(1.75rem*1.25)]">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('common.openMenu')} onClick={() => setMobileNavOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={collapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center rounded-md border border-border p-0.5 sm:flex">
              {(['en', 'hi'] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  className={cn('rounded px-2 py-1 text-xs font-semibold', i18n.language === language ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                  onClick={() => void switchLanguage(language)}
                >
                  {language === 'en' ? 'EN' : 'हि'}
                </button>
              ))}
            </div>
            <OfflineStatusIndicator online={online} />
            <SyncStatusIndicator online={online} />
            <NotificationMenu />
            <ProfileMenu />
          </div>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
      <MobileNavigation onOpenMenu={() => setMobileNavOpen(true)} />
    </div>
  )
}
