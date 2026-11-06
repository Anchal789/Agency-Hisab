import { Navigate, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/app/providers/AuthProvider'
import { ErrorState } from '@/components/common/ErrorState'
import { PageContainer } from '@/components/common/PageContainer'

export function PermissionRoute({ allow }: { allow: boolean }) {
  const { status } = useAuth()
  const { t } = useTranslation()

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />
  }

  if (!allow) {
    return (
      <PageContainer>
        <ErrorState title={t('errors.forbiddenTitle')} description={t('errors.forbiddenBody')} />
      </PageContainer>
    )
  }

  return <Outlet />
}
