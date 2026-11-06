import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function ForgotPasswordPage() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold">{t('auth.forgotTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('auth.forgotBodyAdmin')}</p>
      <p className="mt-4 text-sm text-muted-foreground">{t('auth.forgotBodyAdminHint')}</p>
      <Link to="/login" className="mt-6 inline-flex h-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold">
        {t('auth.backToSignIn')}
      </Link>
    </div>
  )
}
