import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { canCreateCustomers, canEditCustomers } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterPanel } from '@/components/forms/FilterPanel'
import { SearchInput } from '@/components/forms/SearchInput'
import { DataTable, type DataColumn } from '@/components/tables/DataTable'
import { Button } from '@/components/ui/button'
import type { CustomerDoc } from '@shared/models/customer'
import { CUSTOMER_PAGE_SIZE, fetchCustomerPage } from './customer-query'

export function CustomersPage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const canCreate = Boolean(role && profile && canCreateCustomers(role, profile.permissions))
  const canEdit = Boolean(role && profile && canEditCustomers(role, profile.permissions))

  const listQuery = useInfiniteQuery({
    queryKey: ['customers', appliedSearch],
    initialPageParam: null as Awaited<ReturnType<typeof fetchCustomerPage>>['lastDoc'],
    queryFn: ({ pageParam }) => fetchCustomerPage({ search: appliedSearch, cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.lastDoc : undefined),
  })

  const customers = useMemo(() => listQuery.data?.pages.flatMap((page) => page.items) ?? [], [listQuery.data])

  const columns = useMemo<Array<DataColumn<CustomerDoc>>>(
    () => [
      {
        id: 'name',
        header: t('customers.name'),
        cell: (row) => (
          <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/customers/${row.id}`}>
            {row.displayName}
          </Link>
        ),
      },
      {
        id: 'consumerNumber',
        header: t('customers.consumerNumber'),
        cell: (row) => <span className="font-mono text-xs sm:text-sm">{row.consumerNumber}</span>,
      },
      {
        id: 'address',
        header: t('customers.address'),
        cell: (row) => row.address || '—',
      },
      {
        id: 'city',
        header: t('customers.city'),
        cell: (row) => row.city || '—',
      },
      {
        id: 'lastRefillDate',
        header: t('customers.lastRefillDate'),
        cell: (row) =>
          row.lastRefillDate ? formatBusinessDate(row.lastRefillDate, i18n.language) : t('customers.noRefillDate'),
      },
      {
        id: 'actions',
        header: t('table.actions'),
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/customers/${row.id}`}>{t('customers.view')}</Link>
            </Button>
            {canEdit ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`/customers/${row.id}/edit`}>{t('common.edit')}</Link>
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canEdit, i18n.language, t],
  )

  return (
    <PageContainer>
      <PageHeader
        title={t('customers.title')}
        description={t('customers.subtitle')}
        actions={
          canCreate ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/customers/import">{t('customers.import')}</Link>
              </Button>
              <Button asChild>
                <Link to="/customers/new">{t('customers.add')}</Link>
              </Button>
            </div>
          ) : null
        }
      />

      <FilterPanel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end justify-between w-full">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('customers.search')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setAppliedSearch(searchInput.trim())
                }
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => setAppliedSearch(searchInput.trim())}>
              {t('common.search')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearchInput('')
                setAppliedSearch('')
              }}
            >
              {t('common.clear')}
            </Button>
          </div>
        </div>
      </FilterPanel>

      {listQuery.isLoading ? <LoadingState label={t('common.loading')} /> : null}
      {listQuery.isError ? (
        <ErrorState
          title={t('customers.loadFailed')}
          description={t('errors.generic')}
          action={
            <Button type="button" onClick={() => void listQuery.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && customers.length === 0 ? (
        <EmptyState title={t('customers.emptyTitle')} description={t('customers.emptyBody')} />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && customers.length > 0 ? (
        <div className="space-y-4">
          <DataTable data={customers} columns={columns} rowKey={(row) => row.id} />
          {appliedSearch ? (
            <p className="text-xs text-muted-foreground">
              {t('customers.searchResultCount', { count: customers.length })}
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t('customers.pageHint', { count: customers.length, size: CUSTOMER_PAGE_SIZE })}
              </p>
              {listQuery.hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {listQuery.isFetchingNextPage ? t('common.loading') : t('customers.loadMore')}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </PageContainer>
  )
}
