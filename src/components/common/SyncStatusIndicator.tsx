import { Cloud, CloudOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function SyncStatusIndicator({ online }: { online: boolean }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={online ? t('status.connectedHint') : t('status.offlineHint')}>
      {online ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
      <span className="hidden lg:inline">{online ? t('status.connected') : t('status.offline')}</span>
    </span>
  )
}
