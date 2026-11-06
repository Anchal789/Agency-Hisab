import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { updateCustomer } from '@/services/api/customers'
import { callableErrorMessage } from '@/services/errors'
import { CustomerFormFields, type CustomerFormValues } from './CustomerFormFields'
import { buildCustomerFormSchema } from './customer-form-schema'
import { fetchCustomerById } from './customer-query'

export function CustomerEditPage() {
  const { t } = useTranslation()
  const { customerId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submittingRef = useRef(false)

  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerById(customerId),
    enabled: Boolean(customerId),
  })

  const schema = buildCustomerFormSchema({
    firstName: t('customers.validation.firstName'),
    lastName: t('customers.validation.lastName'),
    consumerNumber: t('customers.validation.consumerNumber'),
    consumerInvalid: t('customers.validation.consumerInvalid'),
    dateInvalid: t('customers.validation.dateInvalid'),
  })

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      firstName: '',
      lastName: '',
      address: '',
      city: '',
      consumerNumber: '',
      lastRefillDate: '',
    },
  })

  useEffect(() => {
    if (!customerQuery.data) return
    form.reset({
      firstName: customerQuery.data.firstName,
      lastName: customerQuery.data.lastName,
      address: customerQuery.data.address,
      city: customerQuery.data.city,
      consumerNumber: customerQuery.data.consumerNumber,
      lastRefillDate: customerQuery.data.lastRefillDate ?? '',
    })
  }, [customerQuery.data, form])

  const mutation = useMutation({
    mutationFn: updateCustomer,
    onSuccess: async (result) => {
      toast.success(t('customers.updated'))
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      await queryClient.invalidateQueries({ queryKey: ['customer', result.id] })
      navigate(`/customers/${result.id}`)
    },
    onError: (error) => {
      toast.error(callableErrorMessage(error, t))
    },
    onSettled: () => {
      submittingRef.current = false
    },
  })

  if (customerQuery.isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    )
  }

  if (customerQuery.isError || !customerQuery.data) {
    return (
      <PageContainer>
        <ErrorState
          title={t('customers.notFoundTitle')}
          description={t('customers.notFoundBody')}
          action={
            <Button asChild>
              <Link to="/customers">{t('customers.backToList')}</Link>
            </Button>
          }
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('customers.editTitle')}
        description={t('customers.editBody', { name: customerQuery.data.displayName })}
        actions={
          <Button asChild variant="outline">
            <Link to={`/customers/${customerId}`}>{t('common.cancel')}</Link>
          </Button>
        }
      />

      <form
        className="max-w-3xl space-y-6 rounded-xl border border-border bg-card p-4 sm:p-6"
        onSubmit={form.handleSubmit((values) => {
          if (submittingRef.current || mutation.isPending) return
          submittingRef.current = true
          mutation.mutate({
            id: customerId,
            firstName: values.firstName,
            lastName: values.lastName,
            address: values.address,
            city: values.city,
            consumerNumber: values.consumerNumber,
            lastRefillDate: values.lastRefillDate ? values.lastRefillDate : null,
          })
        })}
      >
        <CustomerFormFields form={form} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!form.formState.isValid || mutation.isPending}>
            {mutation.isPending ? t('customers.saving') : t('customers.save')}
          </Button>
          <Button asChild type="button" variant="outline">
            <Link to={`/customers/${customerId}`}>{t('common.cancel')}</Link>
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
