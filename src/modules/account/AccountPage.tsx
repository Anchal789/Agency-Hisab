import { useTranslation } from 'react-i18next'
import { formatPhoneForDisplay } from '@shared/auth/phone'
import { useAuth } from '@/app/providers/AuthProvider'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { FormSection } from '@/components/forms/FormSection'
import { Button } from '@/components/ui/button'

export function AccountPage() {
  const { t } = useTranslation()
  const { profile, signOutUser } = useAuth()
  if (!profile) return null

  return (
    <PageContainer>
      <PageHeader
        title={t('account.title')}
        actions={
          <Button variant="outline" onClick={() => void signOutUser()} data-testid="account-sign-out">
            {t('auth.signOut')}
          </Button>
        }
      />
      <FormSection title={t('account.profileTitle')} description={t('account.profileBody')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('account.name')}</dt>
            <dd className="mt-1 text-sm font-medium" data-testid="account-name">
              {profile.displayName || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('auth.phone')}</dt>
            <dd className="mt-1 text-sm font-medium" data-testid="account-phone">
              {profile.phoneE164 ? formatPhoneForDisplay(profile.phoneE164) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('account.role')}</dt>
            <dd className="mt-1">
              <StatusBadge tone="info">{profile.role === 'admin' ? t('account.admin') : t('account.staff')}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('account.status')}</dt>
            <dd className="mt-1">
              <StatusBadge tone={profile.status === 'active' ? 'success' : 'danger'}>
                {profile.status === 'active' ? t('account.active') : t('account.disabled')}
              </StatusBadge>
            </dd>
          </div>
        </dl>
      </FormSection>
    </PageContainer>
  )
}
