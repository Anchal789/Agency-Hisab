import { useTranslation } from 'react-i18next'
import { ErrorState } from '@/components/common/ErrorState'

export function MissingConfigPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <ErrorState title={t('errors.missingConfigTitle')} description={t('errors.missingConfigBody')} />
    </div>
  )
}
