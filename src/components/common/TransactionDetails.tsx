import { useTranslation } from 'react-i18next'

export function TransactionDetails({ rows }: { rows: { label: string; value: string }[] }) {
  const { t } = useTranslation()
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('transaction.empty')}</p>
  }
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-sm">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
