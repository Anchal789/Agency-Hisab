import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  )
}
