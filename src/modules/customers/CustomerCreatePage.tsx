import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { createCustomer } from '@/services/api/customers'
import { callableErrorMessage } from '@/services/errors'
import { CustomerFormFields, type CustomerFormValues } from './CustomerFormFields'
import { buildCustomerFormSchema } from './customer-form-schema'

export function CustomerCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const submittingRef = useRef(false)

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

  const mutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: async (result) => {
      toast.success(t('customers.created'))
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      navigate(`/customers/${result.id}`)
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
        title={t('customers.addTitle')}
        description={t('customers.addBody')}
        actions={
          <Button asChild variant="outline">
            <Link to="/customers">{t('customers.backToList')}</Link>
          </Button>
        }
      />

      <form
        className="max-w-3xl space-y-6 rounded-xl border border-border bg-card p-4 sm:p-6"
        onSubmit={form.handleSubmit((values) => {
          if (submittingRef.current || mutation.isPending) return
          submittingRef.current = true
          mutation.mutate({
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
            <Link to="/customers">{t('common.cancel')}</Link>
          </Button>
        </div>
      </form>
    </PageContainer>
  )
}
