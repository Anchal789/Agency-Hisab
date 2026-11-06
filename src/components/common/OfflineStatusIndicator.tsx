import { Wifi, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function OfflineStatusIndicator({ online }: { online: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      title={online ? t('status.connectedHint') : t('status.offlineHint')}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? 'bg-emerald-50 text-success' : 'bg-amber-50 text-warning'}`}
    >
      {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {online ? t('status.connected') : t('status.offline')}
    </span>
  )
}
