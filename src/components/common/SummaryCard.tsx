import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function SummaryCard({
  title,
  icon,
  value,
  hint,
  unavailable = false,
}: {
  title: string
  icon?: ReactNode
  value?: string
  hint?: string
  unavailable?: boolean
}) {
  const { t } = useTranslation()
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {icon ? <span className="text-primary">{icon}</span> : null}
      </div>
      <p className={`mt-3 text-2xl font-semibold tabular-nums ${unavailable ? 'text-muted-foreground' : 'text-foreground'}`}>
        {unavailable ? t('summary.unavailable') : value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{unavailable ? t('summary.unavailableHint') : hint}</p>
    </article>
  )
}
