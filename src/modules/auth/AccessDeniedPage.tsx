import { useTranslation } from 'react-i18next'
import { useAuth } from '@/app/providers/AuthProvider'
import { Mark } from '@/components/brand/Mark'
import { Button } from '@/components/ui/button'

export function AccessDeniedPage() {
  const { t } = useTranslation()
  const { status, signOutUser } = useAuth()

  const title = status === 'disabled' ? t('account.disabled') : t('auth.provisionTitle')
  const body = status === 'disabled' ? t('users.disableBody') : t('auth.provisionBody')

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-5">
      <Mark className="h-10 w-10" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Button
        onClick={() => {
          void signOutUser()
        }}
      >
        {t('auth.signOut')}
      </Button>
    </div>
  )
}
