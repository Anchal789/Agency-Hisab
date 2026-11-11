import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AGENCY_TIME_ZONE, formatBusinessDate } from '@shared/calculations/business-date'
import {
  saleEmptyCylinderBreakdown,
  summarizeSaleReturnHistory,
  type TransactionDoc,
} from '@shared/models/transaction'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  fetchEmptyReturnsForSale,
  fetchLocationName,
  fetchUserDisplayName,
} from './godown-query'

function formatCreatedAt(ms: number | null, language: string): string {
  if (ms == null) return '—'
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: AGENCY_TIME_ZONE,
  }).format(new Date(ms))
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

export function EmptyReturnHistoryDialog({
  open,
  sale,
  onOpenChange,
}: {
  open: boolean
  sale: TransactionDoc | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language.startsWith('hi') ? 'hi' : 'en'
  const saleId = sale?.id ?? ''

  const returnsQuery = useQuery({
    queryKey: ['godown-returns', saleId],
    queryFn: () => fetchEmptyReturnsForSale(saleId),
    enabled: open && Boolean(saleId) && sale?.type === 'godown_sale',
  })

  const returns = returnsQuery.data ?? []
  const summary = sale ? summarizeSaleReturnHistory(sale, returns) : null
  const breakdown = sale ? saleEmptyCylinderBreakdown(sale.quantities) : null

  const metaQuery = useQuery({
    queryKey: [
      'godown-return-history-meta',
      saleId,
      returns.map((row) => `${row.id}:${row.createdBy}:${row.locationId ?? ''}`).join('|'),
    ],
    queryFn: async () => {
      const staffIds = [...new Set(returns.map((row) => row.createdBy).filter(Boolean))]
      const locationIds = [
        ...new Set(
          [sale?.locationId, ...returns.map((row) => row.locationId)]
            .filter((id): id is string => Boolean(id)),
        ),
      ]
      const [staffEntries, locationEntries] = await Promise.all([
        Promise.all(staffIds.map(async (uid) => [uid, await fetchUserDisplayName(uid)] as const)),
        Promise.all(locationIds.map(async (id) => [id, await fetchLocationName(id)] as const)),
      ])
      return {
        staffNames: Object.fromEntries(staffEntries),
        locationNames: Object.fromEntries(locationEntries),
      }
    },
    enabled: open && returns.length > 0,
  })

  const staffNames = metaQuery.data?.staffNames ?? {}
  const locationNames = metaQuery.data?.locationNames ?? {}

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100%-1.5rem,36rem)]">
        <DialogHeader>
          <DialogTitle>{t('godown.returnHistoryTitle')}</DialogTitle>
          <DialogDescription>{t('godown.returnHistoryBody')}</DialogDescription>
        </DialogHeader>

        {sale && breakdown ? (
          <div className="mb-4 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div>
              <p className="font-medium">{sale.customerSnapshot.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {sale.customerSnapshot.consumerNumber ?? t('godown.customCustomer')}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('godown.originalSaleDate')}: {formatBusinessDate(sale.businessDate, i18n.language)}
              {' · '}
              <Link className="text-accent underline-offset-2 hover:underline" to={`/godown/${sale.id}`}>
                {t('godown.saleReference', { id: shortId(sale.id) })}
              </Link>
            </p>
            {sale.locationId && locationNames[sale.locationId] ? (
              <p className="text-xs text-muted-foreground">
                {t('godown.location')}: {locationNames[sale.locationId]}
              </p>
            ) : null}
            <p className="text-sm">
              {t('godown.dueCount', { count: breakdown.originalDue })}
              {' · '}
              {t('godown.returnedCount', { count: breakdown.subsequentlyReturned })}
              {' · '}
              {t('godown.remainingCount', { count: breakdown.remainingDue })}
            </p>
            {summary && summary.returnCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('godown.returnRecordCount', { count: summary.returnCount })}
              </p>
            ) : null}
          </div>
        ) : null}

        {returnsQuery.isLoading ? (
          <LoadingState />
        ) : returnsQuery.isError ? (
          <ErrorState
            title={t('errors.generic')}
            action={
              <Button type="button" variant="outline" onClick={() => void returnsQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : returns.length === 0 ? (
          <EmptyState title={t('godown.noReturnsTitle')} description={t('godown.noReturnsBody')} />
        ) : (
          <ul className="max-h-[min(50vh,24rem)] space-y-3 overflow-y-auto pr-1">
            {returns.map((row) => (
              <li key={row.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {formatBusinessDate(row.businessDate, i18n.language)}
                      <span className="text-muted-foreground">
                        {' · '}
                        {t('godown.returnedCount', { count: row.quantities.emptyReceived })}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('godown.againstSaleDated', {
                        date: formatBusinessDate(
                          row.originBusinessDate ?? sale?.businessDate ?? row.businessDate,
                          i18n.language,
                        ),
                      })}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/godown/${row.id}`}>{t('godown.view')}</Link>
                  </Button>
                </div>
                <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt className="inline">{t('godown.customer')}: </dt>
                    <dd className="inline text-foreground">{row.customerSnapshot.name}</dd>
                  </div>
                  <div>
                    <dt className="inline">{t('customers.consumerNumber')}: </dt>
                    <dd className="inline font-mono text-foreground">
                      {row.customerSnapshot.consumerNumber ?? '—'}
                    </dd>
                  </div>
                  {row.locationId && locationNames[row.locationId] ? (
                    <div>
                      <dt className="inline">{t('godown.location')}: </dt>
                      <dd className="inline text-foreground">{locationNames[row.locationId]}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline">{t('godown.recordedAt')}: </dt>
                    <dd className="inline text-foreground">{formatCreatedAt(row.createdAtMs, language)}</dd>
                  </div>
                  <div>
                    <dt className="inline">{t('godown.recordedBy')}: </dt>
                    <dd className="inline text-foreground">
                      {staffNames[row.createdBy] ?? shortId(row.createdBy)}
                    </dd>
                  </div>
                  {typeof row.remainingOutstandingAfter === 'number' ? (
                    <div>
                      <dt className="inline">{t('godown.remainingEmptyDue')}: </dt>
                      <dd className="inline text-foreground">{row.remainingOutstandingAfter}</dd>
                    </div>
                  ) : null}
                  {row.note ? (
                    <div className="sm:col-span-2">
                      <dt className="inline">{t('godown.note')}: </dt>
                      <dd className="inline text-foreground">{row.note}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
