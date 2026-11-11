import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { businessDateInTimeZone, AGENCY_TIME_ZONE } from '@shared/calculations/business-date'
import type { CustomerDoc } from '@shared/models/customer'
import { formatPaise, rupeesToPaise, MoneyFormatError } from '@shared/models/money'
import { emptyOutstandingFromIssue } from '@shared/models/transaction'
import { destinationsForPaymentMethod } from '@shared/rules/payment-destinations'
import { amountsFromReceivedAndDue } from '@shared/schemas/godown'
import type { GodownConfig } from '@/modules/godown/godown-config-query'
import { CustomerPicker } from '@/modules/godown/CustomerPicker'
import { FormField } from '@/components/forms/FormField'
import { FormSection } from '@/components/forms/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type GodownSaleFormValues = {
  businessDate: string
  customerKind: 'registered' | 'custom'
  customerId: string | null
  customCustomerName: string
  selectedCustomer: CustomerDoc | null
  locationId: string
  productId: string
  filledIssued: string
  emptyReceived: string
  receivedRupees: string
  dueRupees: string
  paymentMethodId: string
  receivingAccountId: string
  bookingStatus: 'yes' | 'no'
  note: string
}

export function defaultGodownSaleValues(config?: GodownConfig): GodownSaleFormValues {
  const defaultProduct = config?.products[0]?.id ?? ''
  const defaultLocation =
    config?.locations.find((row) => row.kind === 'godown')?.id ?? config?.locations[0]?.id ?? ''
  return {
    businessDate: businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE),
    customerKind: 'registered',
    customerId: null,
    customCustomerName: '',
    selectedCustomer: null,
    locationId: defaultLocation,
    productId: defaultProduct,
    filledIssued: '1',
    emptyReceived: '1',
    receivedRupees: '0',
    dueRupees: '0',
    paymentMethodId: '',
    receivingAccountId: '',
    bookingStatus: 'yes',
    note: '',
  }
}

function parseMoneyField(value: string): { paise: number | null; error: string | null } {
  try {
    return { paise: rupeesToPaise(value.trim() === '' ? '0' : value), error: null }
  } catch (error) {
    return {
      paise: null,
      error: error instanceof MoneyFormatError ? error.message : 'invalid',
    }
  }
}

export function GodownSaleForm({
  config,
  values,
  onChange,
  onSubmit,
  pending,
  submitLabel,
}: {
  config: GodownConfig
  values: GodownSaleFormValues
  onChange: (next: GodownSaleFormValues) => void
  onSubmit: () => void
  pending: boolean
  submitLabel: string
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language.startsWith('hi') ? 'hi' : 'en'
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const filledIssued = Number(values.filledIssued)
  const emptyReceived = Number(values.emptyReceived)
  const outstanding = emptyOutstandingFromIssue(
    Number.isFinite(filledIssued) ? filledIssued : NaN,
    Number.isFinite(emptyReceived) ? emptyReceived : NaN,
  )

  const paymentMethods = useMemo(
    () => config.agency.paymentMethods.filter((row) => row.active),
    [config.agency.paymentMethods],
  )
  const selectedMethod = paymentMethods.find((row) => row.id === values.paymentMethodId) ?? null
  const filteredDestinations = useMemo(
    () => destinationsForPaymentMethod(selectedMethod, config.agency.receivingAccounts),
    [selectedMethod, config.agency.receivingAccounts],
  )

  const receivedParsed = parseMoneyField(values.receivedRupees)
  const dueParsed = parseMoneyField(values.dueRupees)
  const calculatedSalePaise =
    receivedParsed.paise !== null && dueParsed.paise !== null
      ? amountsFromReceivedAndDue(receivedParsed.paise, dueParsed.paise).salePaise
      : null

  function patch(partial: Partial<GodownSaleFormValues>) {
    onChange({ ...values, ...partial })
  }

  function setPaymentMethod(methodId: string) {
    const method = paymentMethods.find((row) => row.id === methodId) ?? null
    const allowed = destinationsForPaymentMethod(method, config.agency.receivingAccounts)
    const stillValid = allowed.some((row) => row.id === values.receivingAccountId)
    patch({
      paymentMethodId: methodId,
      receivingAccountId: stillValid ? values.receivingAccountId : '',
    })
  }

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.businessDate)) {
      errors.businessDate = t('godown.validation.date')
    }
    if (values.customerKind === 'registered' && !values.customerId) {
      errors.customer = t('godown.validation.customer')
    }
    if (values.customerKind === 'custom' && !values.customCustomerName.trim()) {
      errors.customCustomerName = t('godown.validation.customName')
    }
    if (!values.productId) errors.productId = t('godown.validation.product')
    if (!/^\d+$/.test(values.filledIssued) || Number(values.filledIssued) < 1) {
      errors.filledIssued = t('godown.validation.filled')
    }
    if (!/^\d+$/.test(values.emptyReceived)) {
      errors.emptyReceived = t('godown.validation.emptyReceived')
    } else if (!Number.isSafeInteger(outstanding)) {
      errors.emptyReceived = t('godown.validation.emptyTooHigh')
    }

    const received = parseMoneyField(values.receivedRupees)
    const due = parseMoneyField(values.dueRupees)
    if (received.error) errors.receivedRupees = received.error === 'invalid' ? t('errors.invalidInput') : received.error
    if (due.error) errors.dueRupees = due.error === 'invalid' ? t('errors.invalidInput') : due.error

    if (received.paise !== null && received.paise < 0) {
      errors.receivedRupees = t('godown.validation.amountNegative')
    }
    if (due.paise !== null && due.paise < 0) {
      errors.dueRupees = t('godown.validation.amountNegative')
    }

    if ((received.paise ?? 0) > 0) {
      if (!values.paymentMethodId) {
        errors.paymentMethodId = t('godown.validation.paymentMethod')
      } else if (filteredDestinations.length === 0) {
        errors.receivingAccountId = t('godown.validation.noDestinationConfigured', {
          method: selectedMethod?.name ?? values.paymentMethodId,
        })
      } else if (!values.receivingAccountId) {
        errors.receivingAccountId = t('godown.validation.receivingAccount')
      } else if (!filteredDestinations.some((row) => row.id === values.receivingAccountId)) {
        errors.receivingAccountId = t('godown.validation.destinationMismatch')
      }
    }

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      const first = Object.values(errors)[0]
      if (first) toast.error(first)
      return false
    }
    return true
  }

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (pending) return
        if (!validate()) return
        onSubmit()
      }}
    >
      <FormSection title={t('godown.sectionCustomer')}>
        <div className="flex flex-wrap gap-2">
          {(['registered', 'custom'] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={values.customerKind === kind ? 'primary' : 'outline'}
              onClick={() =>
                patch({
                  customerKind: kind,
                  customerId: null,
                  selectedCustomer: null,
                  customCustomerName: kind === 'custom' ? values.customCustomerName : '',
                })
              }
            >
              {kind === 'registered' ? t('godown.registeredCustomer') : t('godown.customCustomer')}
            </Button>
          ))}
        </div>
        {values.customerKind === 'registered' ? (
          <div className="mt-3 space-y-1.5">
            <Label>{t('godown.selectCustomer')}</Label>
            <CustomerPicker
              selected={values.selectedCustomer}
              onSelect={(customer) =>
                patch({ selectedCustomer: customer, customerId: customer.id, customCustomerName: '' })
              }
              onClear={() => patch({ selectedCustomer: null, customerId: null })}
            />
            {fieldErrors.customer ? <p className="text-xs text-destructive">{fieldErrors.customer}</p> : null}
          </div>
        ) : (
          <FormField
            className="mt-3"
            label={t('godown.customCustomerName')}
            error={fieldErrors.customCustomerName}
          >
            <Input
              value={values.customCustomerName}
              onChange={(event) => patch({ customCustomerName: event.target.value })}
              autoComplete="off"
            />
          </FormField>
        )}
      </FormSection>

      <FormSection title={t('godown.sectionBooking')}>
        <div className="flex flex-wrap gap-2">
          {(['yes', 'no'] as const).map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={values.bookingStatus === status ? 'primary' : 'outline'}
              onClick={() => patch({ bookingStatus: status })}
            >
              {status === 'yes' ? t('godown.bookingYes') : t('godown.bookingNo')}
            </Button>
          ))}
        </div>
      </FormSection>

      <FormSection title={t('godown.sectionCylinders')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('godown.product')} error={fieldErrors.productId}>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.productId}
              onChange={(event) => patch({ productId: event.target.value })}
            >
              <option value="">{t('godown.selectProduct')}</option>
              {config.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('godown.location')}>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.locationId}
              onChange={(event) => patch({ locationId: event.target.value })}
            >
              <option value="">{t('godown.selectLocation')}</option>
              {config.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('godown.filledIssued')} error={fieldErrors.filledIssued}>
            <Input
              inputMode="numeric"
              value={values.filledIssued}
              onChange={(event) => patch({ filledIssued: event.target.value })}
            />
          </FormField>
          <FormField label={t('godown.emptyReceived')} error={fieldErrors.emptyReceived}>
            <Input
              inputMode="numeric"
              value={values.emptyReceived}
              onChange={(event) => patch({ emptyReceived: event.target.value })}
            />
          </FormField>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('godown.emptyOutstanding')}:{' '}
          <span className="font-semibold text-foreground">
            {Number.isSafeInteger(outstanding) ? outstanding : '—'}
          </span>
        </p>
      </FormSection>

      <FormSection title={t('godown.sectionPayment')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('godown.amountReceived')} error={fieldErrors.receivedRupees}>
            <Input
              inputMode="decimal"
              value={values.receivedRupees}
              onChange={(event) => patch({ receivedRupees: event.target.value })}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t('godown.amountDue')} error={fieldErrors.dueRupees}>
            <Input
              inputMode="decimal"
              value={values.dueRupees}
              onChange={(event) => patch({ dueRupees: event.target.value })}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t('godown.paymentMethod')} error={fieldErrors.paymentMethodId}>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.paymentMethodId}
              onChange={(event) => setPaymentMethod(event.target.value)}
            >
              <option value="">{t('godown.selectPaymentMethod')}</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('godown.receivingAccount')} error={fieldErrors.receivingAccountId}>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={values.receivingAccountId}
              onChange={(event) => patch({ receivingAccountId: event.target.value })}
              disabled={!values.paymentMethodId}
            >
              <option value="">{t('godown.selectReceivingAccount')}</option>
              {filteredDestinations.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            {values.paymentMethodId && filteredDestinations.length === 0 ? (
              <p className="mt-1 text-xs text-destructive">
                {t('godown.validation.noDestinationConfigured', {
                  method: selectedMethod?.name ?? values.paymentMethodId,
                })}
              </p>
            ) : null}
          </FormField>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('godown.totalSaleAmount')}:{' '}
          <span className="font-semibold text-foreground">
            {calculatedSalePaise === null ? '—' : formatPaise(calculatedSalePaise, language)}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('godown.totalSaleHint')}</p>
      </FormSection>

      <FormSection title={t('godown.sectionMeta')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('godown.transactionDate')} error={fieldErrors.businessDate}>
            <Input
              type="date"
              value={values.businessDate}
              onChange={(event) => patch({ businessDate: event.target.value })}
            />
          </FormField>
          <FormField label={t('godown.note')}>
            <Input value={values.note} onChange={(event) => patch({ note: event.target.value })} />
          </FormField>
        </div>
      </FormSection>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('common.loading') : submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function saleFormToPayload(values: GodownSaleFormValues) {
  const receivedPaise = rupeesToPaise(values.receivedRupees.trim() === '' ? '0' : values.receivedRupees)
  const duePaise = rupeesToPaise(values.dueRupees.trim() === '' ? '0' : values.dueRupees)
  const amounts = amountsFromReceivedAndDue(receivedPaise, duePaise)
  const customName = values.customCustomerName.trim()
  const note = values.note.trim()
  return {
    businessDate: values.businessDate,
    customerKind: values.customerKind,
    customerId: values.customerKind === 'registered' ? values.customerId : null,
    // Prefer null over undefined: Firebase httpsCallable serializes undefined as null anyway.
    customCustomerName: values.customerKind === 'custom' ? customName : null,
    locationId: values.locationId || null,
    productId: values.productId,
    filledIssued: Number(values.filledIssued),
    emptyReceived: Number(values.emptyReceived),
    salePaise: amounts.salePaise,
    receivedPaise: amounts.receivedPaise,
    duePaise: amounts.duePaise,
    paymentMethodId: values.paymentMethodId || null,
    receivingAccountId: values.receivingAccountId || null,
    bookingStatus: values.bookingStatus,
    note: note || null,
  }
}
