import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function DateRangePicker({
  from,
  to,
  onChange,
  disabled = false,
}: {
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="date-from">{t('common.from')}</Label>
        <Input id="date-from" type="date" value={from} disabled={disabled} onChange={(event) => onChange({ from: event.target.value, to })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="date-to">{t('common.to')}</Label>
        <Input id="date-to" type="date" value={to} disabled={disabled} onChange={(event) => onChange({ from, to: event.target.value })} />
      </div>
    </div>
  )
}
