import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import type { CustomerDoc } from '@shared/models/customer'
import { LoadingState } from '@/components/common/LoadingState'
import { SearchInput } from '@/components/forms/SearchInput'
import { Button } from '@/components/ui/button'
import { fetchCustomerPage } from '@/modules/customers/customer-query'

export function CustomerPicker({
  selected,
  onSelect,
  onClear,
}: {
  selected: CustomerDoc | null
  onSelect: (customer: CustomerDoc) => void
  onClear: () => void
}) {
  const { t, i18n } = useTranslation()
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  useEffect(() => {
    const handle = window.setTimeout(() => setAppliedSearch(searchInput), 250)
    return () => window.clearTimeout(handle)
  }, [searchInput])

  const searchQuery = useQuery({
    queryKey: ['godown-customer-search', appliedSearch],
    queryFn: () => fetchCustomerPage({ search: appliedSearch }),
    enabled: appliedSearch.trim().length >= 1,
  })

  if (selected) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="font-medium text-foreground">{selected.displayName}</p>
            <p className="font-mono text-xs text-muted-foreground">{selected.consumerNumber}</p>
            <p className="text-muted-foreground">
              {[selected.address, selected.city].filter(Boolean).join(', ') || '—'}
            </p>
            <p className="text-muted-foreground">
              {t('godown.lastRefill')}:{' '}
              {selected.lastRefillDate
                ? formatBusinessDate(selected.lastRefillDate, i18n.language)
                : t('customers.noRefillDate')}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            {t('common.clear')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <SearchInput
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        placeholder={t('godown.customerSearchPlaceholder')}
      />
      {!appliedSearch.trim() ? (
        <p className="text-sm text-muted-foreground">{t('godown.customerSearchHint')}</p>
      ) : searchQuery.isLoading ? (
        <LoadingState label={t('common.loading')} />
      ) : searchQuery.isError ? (
        <p className="text-sm text-destructive">{t('errors.generic')}</p>
      ) : (searchQuery.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t('godown.noCustomersFound')}</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border">
          {searchQuery.data?.items.slice(0, 20).map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60"
                onClick={() => onSelect(customer)}
              >
                <span className="font-medium">{customer.displayName}</span>
                <span className="font-mono text-xs text-muted-foreground">{customer.consumerNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {[customer.address, customer.city].filter(Boolean).join(', ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
