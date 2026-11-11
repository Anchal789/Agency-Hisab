import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import {
  returnRemainingOutstanding,
  saleEmptyCylinderBreakdown,
  type TransactionDoc,
} from '@shared/models/transaction'

/** Compact cylinder / return-relationship summary for the Godown register table. */
export function GodownCylindersCell({
  row,
  onViewReturnHistory,
}: {
  row: TransactionDoc
  onViewReturnHistory?: (sale: TransactionDoc) => void
}) {
  const { t, i18n } = useTranslation()

  if (row.type === 'godown_sale') {
    const breakdown = saleEmptyCylinderBreakdown(row.quantities)
    if (!breakdown) {
      return (
        <div className="text-sm">
          <p>
            {row.quantities.filledIssued} / {row.quantities.emptyReceived}
          </p>
        </div>
      )
    }
    const canOpenHistory = breakdown.subsequentlyReturned > 0 && Boolean(onViewReturnHistory)
    return (
      <div className="space-y-0.5 text-sm">
        <p>
          <span className="font-medium">{breakdown.filledIssued}</span>
          <span className="text-muted-foreground"> {t('godown.filledIssued').toLowerCase()}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium">{breakdown.emptyReceivedAtSale}</span>
          <span className="text-muted-foreground"> {t('godown.emptyReceived').toLowerCase()}</span>
        </p>
        {breakdown.originalDue > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('godown.dueCount', { count: breakdown.originalDue })}
            {canOpenHistory ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="cursor-pointer font-medium text-accent underline-offset-2 hover:underline"
                  aria-label={t('godown.viewReturnHistoryAria', {
                    count: breakdown.subsequentlyReturned,
                  })}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onViewReturnHistory?.(row)
                  }}
                >
                  {t('godown.returnedLaterLink', { returned: breakdown.subsequentlyReturned })}
                </button>
                <span>
                  {' · '}
                  {t('godown.remainingCount', { count: breakdown.remainingDue })}
                </span>
              </>
            ) : breakdown.subsequentlyReturned > 0 ? (
              ` · ${t('godown.returnedLaterHint', {
                returned: breakdown.subsequentlyReturned,
                remaining: breakdown.remainingDue,
              })}`
            ) : breakdown.remainingDue > 0 ? (
              ` · ${t('godown.remainingCount', { count: breakdown.remainingDue })}`
            ) : (
              ''
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('godown.remainingCount', { count: 0 })}</p>
        )}
      </div>
    )
  }

  const remaining = returnRemainingOutstanding(row)
  const againstDate = row.originBusinessDate
  return (
    <div className="space-y-0.5 text-sm">
      <p>
        <span className="font-medium">{row.quantities.emptyReceived}</span>
        <span className="text-muted-foreground"> {t('godown.emptyReturn').toLowerCase()}</span>
      </p>
      {againstDate || row.originTransactionId ? (
        <p className="text-xs text-muted-foreground">
          {row.originTransactionId ? (
            <Link
              className="text-accent underline-offset-2 hover:underline"
              to={`/godown/${row.originTransactionId}`}
            >
              {againstDate
                ? t('godown.againstSaleDated', { date: formatBusinessDate(againstDate, i18n.language) })
                : t('godown.againstSale')}
            </Link>
          ) : againstDate ? (
            t('godown.againstSaleDated', { date: formatBusinessDate(againstDate, i18n.language) })
          ) : null}
        </p>
      ) : null}
      {remaining !== null ? (
        <p className="text-xs text-muted-foreground">{t('godown.remainingCount', { count: remaining })}</p>
      ) : null}
    </div>
  )
}
