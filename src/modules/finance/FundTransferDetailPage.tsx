import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { formatPaise } from '@shared/models/money'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { callableErrorMessage } from '@/services/errors'
import { getFundTransfer } from '@/services/api/finance-hisab'

export function FundTransferDetailPage() {
  const { transactionId = '' } = useParams()
  const { t, i18n } = useTranslation()
  const language = i18n.language === 'hi' ? 'hi' : 'en'

  const query = useQuery({
    queryKey: ['fund-transfer', transactionId],
    enabled: Boolean(transactionId),
    queryFn: () => getFundTransfer({ transactionId }),
  })

  if (!transactionId) {
    return (
      <PageContainer>
        <ErrorState title={t('fundTransfer.missing')} description={t('fundTransfer.missingBody')} />
      </PageContainer>
    )
  }

  if (query.isLoading) {
    return (
      <PageContainer>
        <LoadingState label={t('common.loading')} />
      </PageContainer>
    )
  }

  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <ErrorState title={t('fundTransfer.loadError')} description={callableErrorMessage(query.error, t)} />
      </PageContainer>
    )
  }

  const row = query.data

  return (
    <PageContainer>
      <PageHeader
        title={t('fundTransfer.detailTitle')}
        description={t('fundTransfer.detailBody')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/hisab">{t('mainHisab.backToHisab')}</Link>
            </Button>
            {row.sourceAccountId ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/hisab/cashbook/${row.sourceAccountId}${row.businessDate ? `?date=${encodeURIComponent(row.businessDate)}` : ''}`}
                >
                  {t('fundTransfer.viewSourceCashbook')}
                </Link>
              </Button>
            ) : null}
            {row.destinationAccountId ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  to={`/hisab/cashbook/${row.destinationAccountId}${row.businessDate ? `?date=${encodeURIComponent(row.businessDate)}` : ''}`}
                >
                  {t('fundTransfer.viewDestinationCashbook')}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <dl className="mx-auto max-w-lg space-y-3 rounded-xl border border-border bg-card px-4 py-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('fundTransfer.amount')}</dt>
          <dd className="font-semibold tabular-nums">{formatPaise(row.amountPaise, language)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('mainHisab.businessDate')}</dt>
          <dd>{row.businessDate ? formatBusinessDate(row.businessDate, i18n.language) : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('fundTransfer.source')}</dt>
          <dd className="text-right">{row.sourceName ?? row.sourceAccountId ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('fundTransfer.destination')}</dt>
          <dd className="text-right">{row.destinationName ?? row.destinationAccountId ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('fundTransfer.note')}</dt>
          <dd className="text-right">{row.note || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('fundTransfer.status')}</dt>
          <dd>{row.status ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('fundTransfer.transactionId')}</dt>
          <dd className="break-all text-right text-xs">{row.id}</dd>
        </div>
      </dl>
      <p className="mx-auto mt-4 max-w-lg text-xs text-muted-foreground">{t('fundTransfer.ledgerHint')}</p>
    </PageContainer>
  )
}
