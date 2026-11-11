import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '@shared/calculations/business-date'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { updateGodownSale } from '@/services/api/godown'
import { callableErrorMessage } from '@/services/errors'
import { fetchCustomerById } from '@/modules/customers/customer-query'
import { fetchGodownConfig } from './godown-config-query'
import { fetchGodownTransaction } from './godown-query'
import {
  GodownSaleForm,
  saleFormToPayload,
  type GodownSaleFormValues,
} from './GodownSaleForm'

function paiseToRupeeInput(paise: number): string {
  const whole = Math.floor(paise / 100)
  const fraction = paise % 100
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`
}

export function GodownEditPage() {
  const { t } = useTranslation()
  const { transactionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submittingRef = useRef(false)
  const [values, setValues] = useState<GodownSaleFormValues | null>(null)
  const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)

  const configQuery = useQuery({
    queryKey: ['godown-config'],
    queryFn: fetchGodownConfig,
  })
  const txQuery = useQuery({
    queryKey: ['godown-transaction', transactionId],
    queryFn: () => fetchGodownTransaction(transactionId),
    enabled: Boolean(transactionId),
  })

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      if (!configQuery.data || !txQuery.data || values) return
      const tx = txQuery.data
      if (tx.type !== 'godown_sale') return
      const selectedCustomer = tx.customerId ? await fetchCustomerById(tx.customerId) : null
      if (cancelled) return
      setValues({
        businessDate: tx.businessDate,
        customerKind: tx.customerKind,
        customerId: tx.customerId,
        customCustomerName: tx.customerKind === 'custom' ? tx.customerSnapshot.name : '',
        selectedCustomer,
        locationId: tx.locationId ?? '',
        productId: tx.productId,
        filledIssued: String(tx.quantities.filledIssued),
        emptyReceived: String(tx.quantities.emptyReceived),
        receivedRupees: paiseToRupeeInput(tx.amountsPaise.receivedPaise),
        // Legacy-safe: prefer stored due; if missing/inconsistent, derive from sale − received.
        dueRupees: paiseToRupeeInput(
          Number.isSafeInteger(tx.amountsPaise.duePaise)
            ? Math.max(0, tx.amountsPaise.duePaise)
            : Math.max(0, tx.amountsPaise.salePaise - tx.amountsPaise.receivedPaise),
        ),
        paymentMethodId: tx.paymentMethodId ?? '',
        receivingAccountId: tx.receivingAccountId ?? '',
        bookingStatus: tx.bookingStatus,
        note: tx.note,
      })
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [configQuery.data, txQuery.data, values])

  const mutation = useMutation({
    mutationFn: updateGodownSale,
    onSuccess: async () => {
      toast.success(t('godown.updated'))
      await queryClient.invalidateQueries({ queryKey: ['godown'] })
      await queryClient.invalidateQueries({ queryKey: ['godown-transaction', transactionId] })
      navigate(`/godown/${transactionId}`)
    },
    onError: (error) => {
      toast.error(callableErrorMessage(error, t))
    },
    onSettled: () => {
      submittingRef.current = false
    },
  })

  const tx = txQuery.data

  return (
    <PageContainer>
      <PageHeader
        title={t('godown.editTitle')}
        description={t('godown.editBody')}
        actions={
          <Button asChild variant="outline">
            <Link to={`/godown/${transactionId}`}>{t('common.cancel')}</Link>
          </Button>
        }
      />

      {configQuery.isLoading || txQuery.isLoading || !values ? (
        <LoadingState />
      ) : configQuery.isError || txQuery.isError || !configQuery.data || !tx ? (
        <ErrorState title={t('errors.generic')} />
      ) : tx.type !== 'godown_sale' || tx.status !== 'posted' ? (
        <ErrorState title={t('godown.cannotEditTitle')} description={t('godown.cannotEditBody')} />
      ) : tx.businessDate !== today ? (
        <ErrorState title={t('godown.historicalEditTitle')} description={t('godown.historicalEditBody')} />
      ) : (
        <GodownSaleForm
          config={configQuery.data}
          values={values}
          onChange={setValues}
          pending={mutation.isPending}
          submitLabel={t('common.save')}
          onSubmit={() => {
            if (submittingRef.current || mutation.isPending) return
            try {
              const payload = saleFormToPayload(values)
              submittingRef.current = true
              mutation.mutate({
                transactionId,
                ...payload,
              })
            } catch (error) {
              toast.error(callableErrorMessage(error, t))
            }
          }}
        />
      )}
    </PageContainer>
  )
}
