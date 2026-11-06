import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/forms/FormField'
import { Input } from '@/components/ui/input'

export type CustomerFormValues = {
  firstName: string
  lastName: string
  address: string
  city: string
  consumerNumber: string
  lastRefillDate: string
}

export function CustomerFormFields({ form }: { form: UseFormReturn<CustomerFormValues> }) {
  const { t } = useTranslation()
  const {
    register,
    formState: { errors },
  } = form

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label={`${t('customers.firstName')} *`} error={errors.firstName?.message}>
        <Input autoComplete="given-name" {...register('firstName')} />
      </FormField>
      <FormField label={`${t('customers.lastName')} *`} error={errors.lastName?.message}>
        <Input autoComplete="family-name" {...register('lastName')} />
      </FormField>
      <FormField
        label={`${t('customers.consumerNumber')} *`}
        error={errors.consumerNumber?.message}
        className="sm:col-span-2"
        hint={t('customers.consumerNumberHint')}
      >
        <Input inputMode="text" autoComplete="off" {...register('consumerNumber')} />
      </FormField>
      <FormField label={t('customers.address')} error={errors.address?.message} className="sm:col-span-2">
        <Input autoComplete="street-address" {...register('address')} />
      </FormField>
      <FormField label={t('customers.city')} error={errors.city?.message}>
        <Input autoComplete="address-level2" {...register('city')} />
      </FormField>
      <FormField label={t('customers.lastRefillDate')} error={errors.lastRefillDate?.message}>
        <Input type="date" {...register('lastRefillDate')} />
      </FormField>
    </div>
  )
}
