import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { formatPhoneForDisplay } from '@shared/auth/phone'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/app/providers/AuthProvider'

export function ProfileMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { profile, signOutUser } = useAuth()
  const initials = (profile?.displayName || profile?.phoneE164 || '?').slice(0, 1).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label={t('common.profile')}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{initials}</span>
          <span className="hidden max-w-32 truncate sm:inline">{profile?.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-foreground">{profile?.displayName}</span>
          <span className="block text-xs">{profile ? formatPhoneForDisplay(profile.phoneE164) : ''}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate('/account')}>{t('nav.account')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOutUser()}>{t('auth.signOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
