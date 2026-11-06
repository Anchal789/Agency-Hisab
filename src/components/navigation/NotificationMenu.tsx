import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useNotificationStore } from '@/stores/notification-store'

export function NotificationMenu() {
  const { t } = useTranslation()
  const items = useNotificationStore((state) => state.items)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('status.notifications')}>
          <Bell className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <p className="text-sm font-semibold">{t('status.notifications')}</p>
        {items.length === 0 ? (
          <div className="mt-2">
            <p className="text-sm text-muted-foreground">{t('status.notificationsEmpty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('status.notificationsHint')}</p>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-md bg-muted px-2 py-2">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
