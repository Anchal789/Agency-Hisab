import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function QuantityInput({
  id = 'quantity',
  label,
  value,
  onChange,
}: {
  id?: string
  label?: string
  value: number | null
  onChange: (quantity: number | null) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label ?? t('common.quantity')}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value
          if (!next) {
            onChange(null)
            return
          }
          if (!/^\d+$/.test(next)) return
          onChange(Number(next))
        }}
      />
    </div>
  )
}
