import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/app/providers/AuthProvider'
import { ErrorState } from '@/components/common/ErrorState'
import { PageContainer } from '@/components/common/PageContainer'
import { useTranslation } from 'react-i18next'

export function AdminRoute() {
  const { role, status } = useAuth()
  const { t } = useTranslation()

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />
  }

  if (role !== 'admin') {
    return (
      <PageContainer>
        <ErrorState title={t('errors.forbiddenTitle')} description={t('errors.forbiddenBody')} />
      </PageContainer>
    )
  }

  return <Outlet />
}
