import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export function FilterPanel({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-end">
      {children}
      {onClear ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t('common.clear')}
        </Button>
      ) : null}
    </div>
  )
}
