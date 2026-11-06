import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { canEditCustomers } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { fetchCustomerById } from './customer-query'

export function CustomerDetailPage() {
  const { t, i18n } = useTranslation()
  const { customerId = '' } = useParams()
  const { role, profile } = useAuth()
  const canEdit = Boolean(role && profile && canEditCustomers(role, profile.permissions))

  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerById(customerId),
    enabled: Boolean(customerId),
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

  const customer = customerQuery.data

  return (
    <PageContainer>
      <PageHeader
        title={customer.displayName}
        description={t('customers.detailSubtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/customers">{t('customers.backToList')}</Link>
            </Button>
            {canEdit ? (
              <Button asChild>
                <Link to={`/customers/${customer.id}/edit`}>{t('common.edit')}</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid max-w-3xl gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-6">
        <DetailItem label={t('customers.consumerNumber')} value={customer.consumerNumber} mono />
        <DetailItem
          label={t('customers.status')}
          value={
            <StatusBadge tone={customer.status === 'active' ? 'success' : 'neutral'}>
              {customer.status === 'active' ? t('account.active') : t('account.disabled')}
            </StatusBadge>
          }
        />
        <DetailItem label={t('customers.firstName')} value={customer.firstName} />
        <DetailItem label={t('customers.lastName')} value={customer.lastName} />
        <DetailItem label={t('customers.address')} value={customer.address || '—'} className="sm:col-span-2" />
        <DetailItem label={t('customers.city')} value={customer.city || '—'} />
        <DetailItem
          label={t('customers.lastRefillDate')}
          value={customer.lastRefillDate ? formatBusinessDate(customer.lastRefillDate, i18n.language) : t('customers.noRefillDate')}
        />
        <DetailItem
          label={t('customers.importSource')}
          value={
            customer.importSource === 'excel'
              ? t('customers.importSourceExcel')
              : customer.importSource === 'manual'
                ? t('customers.importSourceManual')
                : '—'
          }
        />
      </div>
    </PageContainer>
  )
}

function DetailItem({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className={mono ? 'mt-1 font-mono text-sm' : 'mt-1 text-sm font-medium'}>{value}</div>
    </div>
  )
}
