import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoneyFormatError, rupeesToPaise } from '@shared/models/money'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AmountInput({
  id = 'amount',
  label,
  onPaiseChange,
}: {
  id?: string
  label?: string
  onPaiseChange: (paise: number | null) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label ?? t('common.amount')}</Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (!next.trim()) {
            setError(null)
            onPaiseChange(null)
            return
          }
          try {
            onPaiseChange(rupeesToPaise(next))
            setError(null)
          } catch (caught) {
            onPaiseChange(null)
            setError(caught instanceof MoneyFormatError ? caught.message : t('errors.invalidInput'))
          }
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
