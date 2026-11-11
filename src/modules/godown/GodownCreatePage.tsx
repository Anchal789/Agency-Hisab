import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { createGodownSale, newTransactionId } from '@/services/api/godown'
import { callableErrorMessage } from '@/services/errors'
import { fetchGodownConfig } from './godown-config-query'
import {
  defaultGodownSaleValues,
  GodownSaleForm,
  saleFormToPayload,
  type GodownSaleFormValues,
} from './GodownSaleForm'

export function GodownCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submittingRef = useRef(false)
  const [values, setValues] = useState<GodownSaleFormValues | null>(null)

  const configQuery = useQuery({
    queryKey: ['godown-config'],
    queryFn: fetchGodownConfig,
  })

  useEffect(() => {
    if (configQuery.data && !values) {
      setValues(defaultGodownSaleValues(configQuery.data))
    }
  }, [configQuery.data, values])

  const mutation = useMutation({
    mutationFn: createGodownSale,
    onSuccess: async (result) => {
      toast.success(t('godown.created'))
      await queryClient.invalidateQueries({ queryKey: ['godown'] })
      navigate(`/godown/${result.id}`)
    },
    onError: (error) => {
      toast.error(callableErrorMessage(error, t))
    },
    onSettled: () => {
      submittingRef.current = false
    },
  })

  return (
    <PageContainer>
      <PageHeader
        title={t('godown.addTitle')}
        description={t('godown.addBody')}
        actions={
          <Button asChild variant="outline">
            <Link to="/godown">{t('godown.backToList')}</Link>
          </Button>
        }
      />

      {configQuery.isLoading || !values ? (
        <LoadingState />
      ) : configQuery.isError || !configQuery.data ? (
        <ErrorState
          title={t('errors.generic')}
          action={
            <Button type="button" variant="outline" onClick={() => void configQuery.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : configQuery.data.products.length === 0 ? (
        <ErrorState title={t('godown.noProductsTitle')} description={t('godown.noProductsBody')} />
      ) : (
        <GodownSaleForm
          config={configQuery.data}
          values={values}
          onChange={setValues}
          pending={mutation.isPending}
          submitLabel={t('godown.saveEntry')}
          onSubmit={() => {
            if (submittingRef.current || mutation.isPending) return
            try {
              const payload = saleFormToPayload(values)
              submittingRef.current = true
              const transactionId = newTransactionId()
              mutation.mutate({
                transactionId,
                idempotencyKey: transactionId,
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
