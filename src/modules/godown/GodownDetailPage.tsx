import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AGENCY_TIME_ZONE, businessDateInTimeZone, formatBusinessDate } from '@shared/calculations/business-date'
import { formatPaise } from '@shared/models/money'
import { saleEmptyCylinderBreakdown } from '@shared/models/transaction'
import { canEditGodown, canReverseGodown, canCreateGodown } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { newTransactionId, recordEmptyReturn, reverseGodownSale } from '@/services/api/godown'
import { callableErrorMessage } from '@/services/errors'
import { EmptyReturnDialog } from './EmptyReturnDialog'
import { fetchEmptyReturnsForSale, fetchGodownTransaction } from './godown-query'

export function GodownDetailPage() {
  const { t, i18n } = useTranslation()
  const { transactionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { role, profile } = useAuth()
  const language = i18n.language.startsWith('hi') ? 'hi' : 'en'
  const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)
  const submittingRef = useRef(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [returnOpen, setReturnOpen] = useState(false)

  const canEdit = Boolean(role && profile && canEditGodown(role, profile.permissions))
  const canCreate = Boolean(role && profile && canCreateGodown(role, profile.permissions))
  const canReverse = Boolean(role && canReverseGodown(role))

  const txQuery = useQuery({
    queryKey: ['godown-transaction', transactionId],
    queryFn: () => fetchGodownTransaction(transactionId),
    enabled: Boolean(transactionId),
  })

  const returnsQuery = useQuery({
    queryKey: ['godown-returns', transactionId],
    queryFn: () => fetchEmptyReturnsForSale(transactionId),
    enabled: Boolean(transactionId) && txQuery.data?.type === 'godown_sale',
  })

  const reverseMutation = useMutation({
    mutationFn: reverseGodownSale,
    onSuccess: async () => {
      toast.success(t('godown.reversed'))
      setDeleteOpen(false)
      setDeleteConfirmOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['godown'] })
      await queryClient.invalidateQueries({ queryKey: ['godown-transaction', transactionId] })
      navigate('/godown')
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
    onSettled: () => {
      submittingRef.current = false
    },
  })

  const returnMutation = useMutation({
    mutationFn: recordEmptyReturn,
    onSuccess: async () => {
      toast.success(t('godown.returnRecorded'))
      setReturnOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['godown'] })
      await queryClient.invalidateQueries({ queryKey: ['godown-transaction', transactionId] })
      await queryClient.invalidateQueries({ queryKey: ['godown-returns', transactionId] })
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
    onSettled: () => {
      submittingRef.current = false
    },
  })

  const tx = txQuery.data
  const saleBreakdown = tx?.type === 'godown_sale' ? saleEmptyCylinderBreakdown(tx.quantities) : null
  const originSaleQuery = useQuery({
    queryKey: ['godown-transaction', tx?.originTransactionId],
    queryFn: () => fetchGodownTransaction(tx!.originTransactionId!),
    enabled: Boolean(tx?.type === 'empty_return' && tx.originTransactionId),
  })

  return (
    <PageContainer>
      <PageHeader
        title={t('godown.detailTitle')}
        description={t('godown.detailBody')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/godown">{t('godown.backToList')}</Link>
            </Button>
            {tx && canEdit && tx.type === 'godown_sale' && tx.status === 'posted' && tx.businessDate === today ? (
              <Button asChild variant="outline">
                <Link to={`/godown/${tx.id}/edit`}>{t('common.edit')}</Link>
              </Button>
            ) : null}
            {tx &&
            canCreate &&
            tx.type === 'godown_sale' &&
            tx.status === 'posted' &&
            (saleBreakdown?.remainingDue ?? 0) > 0 ? (
              <Button type="button" variant="outline" onClick={() => setReturnOpen(true)}>
                {t('godown.recordReturn')}
              </Button>
            ) : null}
            {tx && canReverse && tx.type === 'godown_sale' && tx.status === 'posted' && tx.businessDate === today ? (
              <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        }
      />

      {txQuery.isLoading ? (
        <LoadingState />
      ) : txQuery.isError || !tx ? (
        <ErrorState title={t('godown.notFoundTitle')} description={t('godown.notFoundBody')} />
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.customer')}</dt>
                <dd className="font-medium">{tx.customerSnapshot.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('customers.consumerNumber')}</dt>
                <dd className="font-mono text-sm">{tx.customerSnapshot.consumerNumber ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.booking')}</dt>
                <dd>{tx.bookingStatus === 'yes' ? t('godown.bookingYes') : t('godown.bookingNo')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.entryType')}</dt>
                <dd>{tx.type === 'godown_sale' ? t('godown.sale') : t('godown.emptyReturn')}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.product')}</dt>
                <dd>{tx.productName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.transactionDate')}</dt>
                <dd>{formatBusinessDate(tx.businessDate, i18n.language)}</dd>
              </div>
              {tx.type === 'godown_sale' && saleBreakdown ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.filledIssued')}</dt>
                    <dd>{saleBreakdown.filledIssued}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.emptyReceivedAtSale')}</dt>
                    <dd>{saleBreakdown.emptyReceivedAtSale}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.originalEmptyDue')}</dt>
                    <dd>{saleBreakdown.originalDue}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.subsequentlyReturned')}</dt>
                    <dd>{saleBreakdown.subsequentlyReturned}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.remainingEmptyDue')}</dt>
                    <dd className="font-medium">{saleBreakdown.remainingDue}</dd>
                  </div>
                </>
              ) : null}
              {tx.type === 'empty_return' ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.emptyReturnedNow')}</dt>
                    <dd>{tx.quantities.emptyReceived}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.againstSale')}</dt>
                    <dd>
                      {tx.originTransactionId ? (
                        <Link
                          className="text-accent underline-offset-2 hover:underline"
                          to={`/godown/${tx.originTransactionId}`}
                        >
                          {formatBusinessDate(
                            tx.originBusinessDate ?? originSaleQuery.data?.businessDate ?? tx.businessDate,
                            i18n.language,
                          )}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  {typeof tx.remainingOutstandingAfter === 'number' ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('godown.remainingEmptyDue')}</dt>
                      <dd>{tx.remainingOutstandingAfter}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {tx.type === 'godown_sale' ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.amountReceived')}</dt>
                    <dd>{formatPaise(tx.amountsPaise.receivedPaise, language)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.amountDue')}</dt>
                    <dd>{formatPaise(tx.amountsPaise.duePaise, language)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.totalSaleAmount')}</dt>
                    <dd>{formatPaise(tx.amountsPaise.salePaise, language)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('godown.payment')}</dt>
                    <dd>
                      {[tx.paymentMethodName, tx.receivingAccountName].filter(Boolean).join(' → ') || '—'}
                    </dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground">{t('approval.not_required')}</dt>
                <dd>{t(`approval.${tx.approval}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.status')}</dt>
                <dd>{tx.status}</dd>
              </div>
              {tx.note ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('godown.note')}</dt>
                  <dd>{tx.note}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {tx.type === 'godown_sale' ? (
            <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">{t('godown.returnsTitle')}</h2>
              {returnsQuery.isLoading ? (
                <LoadingState />
              ) : (returnsQuery.data?.length ?? 0) === 0 ? (
                <EmptyState title={t('godown.noReturnsTitle')} description={t('godown.noReturnsBody')} />
              ) : (
                <ul className="mt-3 space-y-2">
                  {returnsQuery.data?.map((row) => (
                    <li key={row.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/godown/${row.id}`}>
                        {formatBusinessDate(row.businessDate, i18n.language)}
                      </Link>
                      <span className="text-muted-foreground">
                        {' '}
                        · {t('godown.returnedCount', { count: row.quantities.emptyReceived })}
                        {typeof row.remainingOutstandingAfter === 'number'
                          ? ` · ${t('godown.remainingCount', { count: row.remainingOutstandingAfter })}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      )}

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('godown.deleteTitle')}
        description={t('godown.deleteBody')}
        destructive
        confirmLabel={t('godown.deleteContinue')}
        onConfirm={() => {
          setDeleteOpen(false)
          setDeleteConfirmOpen(true)
        }}
      />

      <ConfirmationDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          setDeleteConfirmOpen(open)
          if (!open) setReason('')
        }}
        title={t('godown.deleteConfirmTitle')}
        description={t('godown.deleteConfirmBody')}
        destructive
        pending={reverseMutation.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (submittingRef.current || reverseMutation.isPending) return
          if (!reason.trim()) {
            toast.error(t('godown.deleteConfirmHint'))
            return
          }
          submittingRef.current = true
          reverseMutation.mutate({
            transactionId,
            reason: reason.trim(),
            confirmPhrase: 'DELETE',
          })
        }}
      >
        <FormField label={t('godown.deleteReason')}>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoComplete="off"
            disabled={reverseMutation.isPending}
            autoFocus
          />
        </FormField>
        <p className="text-xs text-muted-foreground">{t('godown.deleteConfirmHint')}</p>
      </ConfirmationDialog>

      <EmptyReturnDialog
        open={returnOpen}
        sale={tx?.type === 'godown_sale' ? tx : null}
        defaultBusinessDate={today}
        pending={returnMutation.isPending}
        onOpenChange={setReturnOpen}
        onSubmit={(values) => {
          if (submittingRef.current || returnMutation.isPending) return
          submittingRef.current = true
          const id = newTransactionId()
          returnMutation.mutate({
            transactionId: id,
            idempotencyKey: id,
            originTransactionId: transactionId,
            businessDate: values.businessDate,
            emptyReturned: Number(values.emptyReturned),
            note: values.note.trim() || null,
          })
        }}
      />
    </PageContainer>
  )
}
