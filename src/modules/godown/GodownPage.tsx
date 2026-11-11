import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AGENCY_TIME_ZONE, businessDateInTimeZone, formatBusinessDate } from '@shared/calculations/business-date'
import { formatPaise } from '@shared/models/money'
import { summarizeGodownDay, type TransactionDoc } from '@shared/models/transaction'
import { canCreateGodown, canEditGodown, canReverseGodown } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { SummaryCard } from '@/components/common/SummaryCard'
import { FilterPanel } from '@/components/forms/FilterPanel'
import { SearchInput } from '@/components/forms/SearchInput'
import { DataTable, type DataColumn } from '@/components/tables/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyReturnHistoryDialog } from './EmptyReturnHistoryDialog'
import { GodownCylindersCell } from './GodownCylindersCell'
import { fetchGodownDay } from './godown-query'

export function GodownPage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const language = i18n.language.startsWith('hi') ? 'hi' : 'en'
  const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)

  const [businessDate, setBusinessDate] = useState(today)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [bookingStatus, setBookingStatus] = useState<'all' | 'yes' | 'no'>('all')
  const [customerKind, setCustomerKind] = useState<'all' | 'registered' | 'custom'>('all')
  const [historySale, setHistorySale] = useState<TransactionDoc | null>(null)

  const canCreate = Boolean(role && profile && canCreateGodown(role, profile.permissions))
  const canEdit = Boolean(role && profile && canEditGodown(role, profile.permissions))
  const canReverse = Boolean(role && canReverseGodown(role))

  const listQuery = useQuery({
    queryKey: ['godown', businessDate, appliedSearch, bookingStatus, customerKind],
    queryFn: () =>
      fetchGodownDay({
        businessDate,
        search: appliedSearch,
        bookingStatus,
        customerKind,
        includeReversed: false,
      }),
  })

  const items = listQuery.data?.items ?? []
  const summary = useMemo(() => summarizeGodownDay(items), [items])

  const columns = useMemo<Array<DataColumn<TransactionDoc>>>(
    () => [
      {
        id: 'customer',
        header: t('godown.customer'),
        cell: (row) => (
          <div>
            <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/godown/${row.id}`}>
              {row.customerSnapshot.name}
            </Link>
            <p className="font-mono text-xs text-muted-foreground">
              {row.customerSnapshot.consumerNumber ?? t('godown.customCustomer')}
            </p>
          </div>
        ),
      },
      {
        id: 'booking',
        header: t('godown.booking'),
        cell: (row) => (row.bookingStatus === 'yes' ? t('godown.bookingYes') : t('godown.bookingNo')),
      },
      {
        id: 'type',
        header: t('godown.entryType'),
        cell: (row) => (row.type === 'godown_sale' ? t('godown.sale') : t('godown.emptyReturn')),
      },
      {
        id: 'cylinders',
        header: t('godown.sectionCylinders'),
        cell: (row) => (
          <GodownCylindersCell
            row={row}
            onViewReturnHistory={(sale) => setHistorySale(sale)}
          />
        ),
      },
      {
        id: 'sale',
        header: t('godown.totalSaleAmount'),
        cell: (row) =>
          row.type === 'godown_sale' ? formatPaise(row.amountsPaise.salePaise, language) : '—',
      },
      {
        id: 'received',
        header: t('godown.amountReceived'),
        cell: (row) =>
          row.type === 'godown_sale' ? formatPaise(row.amountsPaise.receivedPaise, language) : '—',
      },
      {
        id: 'payment',
        header: t('godown.payment'),
        cell: (row) =>
          row.type === 'godown_sale'
            ? [row.paymentMethodName, row.receivingAccountName].filter(Boolean).join(' → ') || '—'
            : '—',
      },
      {
        id: 'actions',
        header: t('table.actions'),
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/godown/${row.id}`}>{t('godown.view')}</Link>
            </Button>
            {canEdit && row.type === 'godown_sale' && row.businessDate === today ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`/godown/${row.id}/edit`}>{t('common.edit')}</Link>
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canEdit, language, t, today],
  )

  return (
    <PageContainer>
      <PageHeader
        title={t('godown.title')}
        description={t('godown.subtitle')}
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/godown/new">{t('godown.addEntry')}</Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard title={t('godown.summarySales')} value={String(summary.salesCount)} />
        <SummaryCard title={t('godown.summaryFilled')} value={String(summary.filledIssued)} />
        <SummaryCard
          title={t('godown.summaryCollected')}
          value={formatPaise(summary.receivedPaise, language)}
        />
        <SummaryCard title={t('godown.summaryDue')} value={formatPaise(summary.duePaise, language)} />
      </div>

      <FilterPanel
        onClear={() => {
          setSearchInput('')
          setAppliedSearch('')
          setBookingStatus('all')
          setCustomerKind('all')
        }}
      >
        <div className="flex flex-1 flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('godown.transactionDate')}</span>
            <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </label>
          <SearchInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setAppliedSearch(searchInput)
            }}
          />
          <Button type="button" variant="outline" onClick={() => setAppliedSearch(searchInput)}>
            {t('common.search')}
          </Button>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('godown.booking')}</span>
            <select
              className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={bookingStatus}
              onChange={(event) => setBookingStatus(event.target.value as typeof bookingStatus)}
            >
              <option value="all">{t('godown.filterAll')}</option>
              <option value="yes">{t('godown.bookingYes')}</option>
              <option value="no">{t('godown.bookingNo')}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('godown.customerType')}</span>
            <select
              className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={customerKind}
              onChange={(event) => setCustomerKind(event.target.value as typeof customerKind)}
            >
              <option value="all">{t('godown.filterAll')}</option>
              <option value="registered">{t('godown.registeredCustomer')}</option>
              <option value="custom">{t('godown.customCustomer')}</option>
            </select>
          </label>
        </div>
      </FilterPanel>

      <p className="mb-3 text-sm text-muted-foreground">
        {t('godown.showingFor', { date: formatBusinessDate(businessDate, i18n.language) })}
        {canReverse ? ` · ${t('godown.adminDeleteHint')}` : ''}
      </p>

      {listQuery.isLoading ? (
        <LoadingState label={t('common.loading')} />
      ) : listQuery.isError ? (
        <ErrorState
          title={t('errors.generic')}
          action={
            <Button type="button" variant="outline" onClick={() => void listQuery.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title={t('godown.emptyTitle')} description={t('godown.emptyBody')} />
      ) : (
        <DataTable columns={columns} data={items} rowKey={(row) => row.id} />
      )}

      <EmptyReturnHistoryDialog
        open={Boolean(historySale)}
        sale={historySale}
        onOpenChange={(open) => {
          if (!open) setHistorySale(null)
        }}
      />
    </PageContainer>
  )
}
