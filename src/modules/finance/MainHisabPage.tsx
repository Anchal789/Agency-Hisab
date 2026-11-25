import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { formatPaise } from '@shared/models/money'
import { canCreateFundTransfer, canManageFinancialOpening } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { callableErrorMessage } from '@/services/errors'
import { getMainHisabDashboard, type HisabLedgerEntry } from '@/services/api/finance-hisab'
import { cn } from '@/utils/cn'

function entryLabel(entry: HisabLedgerEntry, t: (key: string) => string): string {
  const key = `mainHisab.entryClass.${entry.entryClass}`
  const translated = t(key)
  return translated === key ? entry.entryClass.replaceAll('_', ' ') : translated
}

export function MainHisabPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.language === 'hi' ? 'hi' : 'en'
  const { role, profile } = useAuth()
  const canOpen = Boolean(role && canManageFinancialOpening(role))
  const canTransfer = Boolean(role && profile && canCreateFundTransfer(role, profile.permissions))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const dashboardQuery = useQuery({
    queryKey: ['main-hisab-dashboard', selectedDate],
    queryFn: () => getMainHisabDashboard(selectedDate ? { businessDate: selectedDate } : undefined),
  })

  const data = dashboardQuery.data
  const minDate = data?.financialOpeningDate ?? undefined
  const maxDate = data?.today ?? undefined
  const businessDate = data?.businessDate ?? selectedDate ?? ''

  const destinationNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of data?.destinations ?? []) map.set(row.accountId, row.name)
    return map
  }, [data?.destinations])

  if (dashboardQuery.isLoading) {
    return (
      <PageContainer>
        <LoadingState label={t('common.loading')} />
      </PageContainer>
    )
  }

  if (dashboardQuery.isError) {
    return (
      <PageContainer>
        <ErrorState
          title={t('mainHisab.loadError')}
          description={callableErrorMessage(dashboardQuery.error, t)}
        />
      </PageContainer>
    )
  }

  if (data?.needsOpening) {
    if (canOpen) return <Navigate to="/hisab/opening" replace />
    return (
      <PageContainer>
        <PageHeader title={t('mainHisab.title')} description={t('mainHisab.notPublishedBody')} />
        <EmptyState title={t('mainHisab.notPublishedTitle')} description={t('mainHisab.notPublishedBody')} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('mainHisab.title')}
        description={t('mainHisab.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            {canTransfer ? (
              <Button asChild size="sm">
                <Link to={`/hisab/transfer?date=${encodeURIComponent(businessDate || '')}`}>
                  {t('mainHisab.transferLink')}
                </Link>
              </Button>
            ) : null}
            {canOpen ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/hisab/opening">{t('mainHisab.openingLink')}</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 max-w-xs">
        <FormField label={t('mainHisab.businessDate')}>
          <Input
            type="date"
            value={businessDate}
            min={minDate}
            max={maxDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </FormField>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('mainHisab.dateHint', {
            opening: minDate ? formatBusinessDate(minDate, i18n.language) : '—',
            today: maxDate ? formatBusinessDate(maxDate, i18n.language) : '—',
          })}
        </p>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {t('mainHisab.destinations')}
        </h2>
        {(data?.destinations.length ?? 0) === 0 ? (
          <EmptyState title={t('mainHisab.noDestinations')} description={t('mainHisab.noDestinationsBody')} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data?.destinations.map((row) => (
              <li key={row.accountId}>
                <Link
                  to={`/hisab/cashbook/${row.accountId}?date=${encodeURIComponent(businessDate)}`}
                  className={cn(
                    'block rounded-xl border border-border bg-card px-4 py-3 transition hover:border-accent',
                    row.needsReconciliation && 'border-amber-500/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[row.kind, row.ownership].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-semibold tabular-nums">
                      {formatPaise(row.balancePaise, language)}
                    </p>
                  </div>
                  {row.needsReconciliation ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      {t('mainHisab.needsReconciliation')}
                      {row.reconciliationReason ? ` · ${row.reconciliationReason}` : ''}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {t('mainHisab.dayActivity', {
            date: businessDate ? formatBusinessDate(businessDate, i18n.language) : '—',
          })}
        </h2>
        {(data?.dayActivity.length ?? 0) === 0 ? (
          <EmptyState title={t('mainHisab.noActivity')} description={t('mainHisab.noActivityBody')} />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {data?.dayActivity.map((entry) => {
              const signed =
                entry.direction === 'debit' ? -entry.amountPaise : entry.amountPaise
              const isTransfer =
                entry.entryClass === 'fund_transfer_out' || entry.entryClass === 'fund_transfer_in'
              const body = (
                <>
                  <div className="min-w-0">
                    <p className="font-medium">{entryLabel(entry, t)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {destinationNames.get(entry.accountId) ?? entry.accountId}
                      {entry.transactionId ? ` · ${entry.transactionId.slice(0, 8)}…` : ''}
                    </p>
                  </div>
                  <p
                    className={cn(
                      'shrink-0 font-semibold tabular-nums',
                      signed < 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    {formatPaise(signed, language)}
                  </p>
                </>
              )
              return (
                <li key={entry.id} className="text-sm">
                  {isTransfer && entry.transactionId ? (
                    <Link
                      to={`/hisab/transfers/${entry.transactionId}`}
                      className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start justify-between gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('mainHisab.readOnlyHint')}</p>
      </section>
    </PageContainer>
  )
}
