import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { formatPaise } from '@shared/models/money'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { callableErrorMessage } from '@/services/errors'
import { listHisabCashbook, type HisabLedgerEntry } from '@/services/api/finance-hisab'
import { cn } from '@/utils/cn'

function entryLabel(entry: HisabLedgerEntry, t: (key: string) => string): string {
  const key = `mainHisab.entryClass.${entry.entryClass}`
  const translated = t(key)
  return translated === key ? entry.entryClass.replaceAll('_', ' ') : translated
}

export function HisabCashbookPage() {
  const { accountId = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const { t, i18n } = useTranslation()
  const language = i18n.language === 'hi' ? 'hi' : 'en'
  const businessDate = search.get('date') ?? undefined

  const cashbookQuery = useQuery({
    queryKey: ['hisab-cashbook', accountId, businessDate],
    enabled: Boolean(accountId),
    queryFn: () =>
      listHisabCashbook({
        accountId,
        businessDate,
      }),
  })

  if (!accountId) {
    return (
      <PageContainer>
        <ErrorState title={t('mainHisab.cashbookMissing')} description={t('mainHisab.cashbookMissingBody')} />
      </PageContainer>
    )
  }

  if (cashbookQuery.isLoading) {
    return (
      <PageContainer>
        <LoadingState label={t('common.loading')} />
      </PageContainer>
    )
  }

  if (cashbookQuery.isError) {
    return (
      <PageContainer>
        <ErrorState
          title={t('mainHisab.cashbookError')}
          description={callableErrorMessage(cashbookQuery.error, t)}
        />
      </PageContainer>
    )
  }

  const data = cashbookQuery.data!

  return (
    <PageContainer>
      <PageHeader
        title={data.name}
        description={t('mainHisab.cashbookDescription')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={`/hisab${businessDate ? `?date=${encodeURIComponent(businessDate)}` : ''}`}>
              {t('mainHisab.backToHisab')}
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs text-muted-foreground">{t('mainHisab.balance')}</p>
          <p className="text-2xl font-semibold tabular-nums">{formatPaise(data.balancePaise, language)}</p>
          {data.needsReconciliation ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t('mainHisab.needsReconciliation')}
              {data.reconciliationReason ? ` · ${data.reconciliationReason}` : ''}
            </p>
          ) : null}
        </div>
        <div className="max-w-xs flex-1">
          <FormField label={t('mainHisab.businessDate')}>
            <Input
              type="date"
              value={businessDate ?? ''}
              onChange={(event) => {
                const next = new URLSearchParams(search)
                if (event.target.value) next.set('date', event.target.value)
                else next.delete('date')
                setSearch(next)
              }}
            />
          </FormField>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {t('mainHisab.openingEntries')}
        </h2>
        {data.openingEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mainHisab.noOpeningEntries')}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {data.openingEntries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} language={language} t={t} i18nLanguage={i18n.language} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {businessDate
            ? t('mainHisab.dayEntries', { date: formatBusinessDate(businessDate, i18n.language) })
            : t('mainHisab.operationalEntries')}
        </h2>
        {data.operationalEntries.length === 0 ? (
          <EmptyState title={t('mainHisab.noActivity')} description={t('mainHisab.noActivityBody')} />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {data.operationalEntries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} language={language} t={t} i18nLanguage={i18n.language} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('mainHisab.readOnlyHint')}</p>
      </section>
    </PageContainer>
  )
}

function LedgerRow({
  entry,
  language,
  t,
  i18nLanguage,
}: {
  entry: HisabLedgerEntry
  language: 'en' | 'hi'
  t: (key: string) => string
  i18nLanguage: string
}) {
  const signed = entry.direction === 'debit' ? -entry.amountPaise : entry.amountPaise
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{entryLabel(entry, t)}</p>
        <p className="text-xs text-muted-foreground">
          {entry.businessDate ? formatBusinessDate(entry.businessDate, i18nLanguage) : '—'}
          {entry.recordScope === 'opening' ? ` · ${t('mainHisab.scopeOpening')}` : ''}
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
    </li>
  )
}
