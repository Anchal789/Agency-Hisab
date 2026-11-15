import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/utils/cn'
import type { LedgerDisplayRow } from './inventory-stock'
import { movementDirection } from './inventory-stock'

export const selectClass =
  'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground'

export function SignedQty({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('font-semibold tabular-nums', value > 0 ? 'text-success' : 'text-destructive')}>
      {value > 0 ? `+${value}` : value}
    </span>
  )
}

export function StockFigure({ value, missingLabel }: { value: number | null; missingLabel: string }) {
  if (value === null) return <span className="text-sm text-muted-foreground">{missingLabel}</span>
  return <span className="text-base font-semibold tabular-nums">{value}</span>
}

export function AlertList({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>
}

export function AlertBanner({
  tone = 'warning',
  children,
  action,
}: {
  tone?: 'warning' | 'info'
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-sky-200 bg-sky-50 text-sky-950',
      )}
    >
      <p>{children}</p>
      {action}
    </div>
  )
}

export function QtyPill({ label, value }: { label: string; value: number | null; }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value === null ? '—' : value}</p>
    </div>
  )
}

export function MovementDetailsDialog({
  row,
  locationName,
  productName,
  sourceName,
  destinationName,
  onOpenChange,
}: {
  row: LedgerDisplayRow | null
  locationName: (id: string | null) => string
  productName: (id: string) => string
  sourceName: string
  destinationName: string
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const direction = row ? movementDirection(row) : 'in'
  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent>
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>{t(`inventory.movement.${row.movementType}`)}</DialogTitle>
              <DialogDescription>
                {formatBusinessDate(row.businessDate, i18n.language)} · {t(`inventory.directionLabel.${direction}`)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('inventory.product')}</dt>
                <dd className="font-medium">{productName(row.productId)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.location')}</dt>
                <dd className="font-medium">{locationName(row.locationId)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.filled')}</dt>
                <dd><SignedQty value={row.filledDelta} /></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.empty')}</dt>
                <dd><SignedQty value={row.emptyDelta} /></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.damaged')}</dt>
                <dd><SignedQty value={row.damagedDelta} /></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.status')}</dt>
                <dd className="font-medium">{t('inventory.statusRecorded')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.source')}</dt>
                <dd className="font-medium">{sourceName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('inventory.destination')}</dt>
                <dd className="font-medium">{destinationName}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">{t('inventory.reference')}</dt>
                <dd className="font-mono text-xs break-all">{row.transactionId}</dd>
              </div>
              {row.note ? (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">{t('inventory.note')}</dt>
                  <dd>{row.note}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
