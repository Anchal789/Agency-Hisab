import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import type { LocationKind } from '@shared/models/agency-config'
import { canCreateInventoryTransfer } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { SearchInput } from '@/components/forms/SearchInput'
import { Button } from '@/components/ui/button'
import { MovementDetailsDialog, selectClass, SignedQty, StockFigure } from './InventoryWidgets'
import {
  fetchInventoryBalances,
  fetchInventoryLedger,
  fetchInventoryMasterData,
  fetchInventoryOpenings,
  fetchOpenEmptyObligationsTotal,
} from './inventory-query'
import { buildLocationStock, groupLedgerLines, type LedgerDisplayRow } from './inventory-stock'

const KINDS: Array<LocationKind | 'all'> = ['all', 'godown', 'vehicle', 'agent', 'csc', 'other']

export function InventoryLocationsPage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const canTransfer = Boolean(role && profile && canCreateInventoryTransfer(role, profile.permissions))
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('location') ?? ''
  const [kind, setKind] = useState<LocationKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [movement, setMovement] = useState<LedgerDisplayRow | null>(null)

  const masterQuery = useQuery({ queryKey: ['inventory-master'], queryFn: fetchInventoryMasterData })
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const dueQuery = useQuery({ queryKey: ['inventory-empty-obligations'], queryFn: fetchOpenEmptyObligationsTotal })
  const historyQuery = useQuery({
    queryKey: ['inventory-ledger', 'location', selectedId],
    queryFn: () => fetchInventoryLedger({ locationId: selectedId }),
    enabled: Boolean(selectedId),
  })

  const stock = useMemo(
    () =>
      buildLocationStock(
        masterQuery.data?.locations ?? [],
        masterQuery.data?.products ?? [],
        balancesQuery.data ?? [],
        openingsQuery.data ?? [],
      ),
    [masterQuery.data, balancesQuery.data, openingsQuery.data],
  )
  const visible = stock.filter((row) => {
    if (kind !== 'all' && row.location.kind !== kind) return false
    if (search.trim() && !row.location.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  })
  const selected = stock.find((row) => row.location.id === selectedId) ?? null
  const names = useMemo(
    () => new Map((masterQuery.data?.locations ?? []).map((row) => [row.id, row.name])),
    [masterQuery.data],
  )
  const productNames = useMemo(
    () => new Map((masterQuery.data?.products ?? []).map((row) => [row.id, row.name])),
    [masterQuery.data],
  )
  const history = useMemo(() => groupLedgerLines(historyQuery.data ?? []), [historyQuery.data])

  if (masterQuery.isLoading || balancesQuery.isLoading || openingsQuery.isLoading) return <LoadingState />
  if (masterQuery.isError || !masterQuery.data) return <ErrorState title={t('errors.generic')} />

  return (
    <div>
      <PageHeader title={t('inventory.navLocations')} description={t('inventory.locationsBody')} />
      <p className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {t('inventory.physicalEmptyNote')}
        {(dueQuery.data?.customerOutstanding ?? 0) > 0
          ? ` ${t('inventory.customerDueAlert', { count: dueQuery.data?.customerOutstanding ?? 0 })}`
          : ''}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <select className={selectClass} value={kind} aria-label={t('inventory.filterLocationType')} onChange={(event) => setKind(event.target.value as LocationKind | 'all')}>
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? t('inventory.allLocationTypes') : t(`inventory.kind.${value}`)}
            </option>
          ))}
        </select>
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('inventory.searchLocations')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          {visible.length === 0 ? (
            <EmptyState title={t('inventory.noLocationsTitle')} description={t('inventory.noLocationsBody')} />
          ) : (
            visible.map((row) => (
              <button
                key={row.location.id}
                type="button"
                className={`w-full rounded-xl border bg-card p-4 text-left ${selectedId === row.location.id ? 'border-accent' : 'border-border'}`}
                onClick={() => setParams({ location: row.location.id })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{row.location.name}</p>
                    <p className="text-xs text-muted-foreground">{t(`inventory.kind.${row.location.kind}`)}</p>
                  </div>
                  <span className="text-sm font-medium text-accent">{t('inventory.view')}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-muted-foreground">{t('inventory.filled')}</dt><dd><StockFigure value={row.filled} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                  <div><dt className="text-muted-foreground">{t('inventory.empty')}</dt><dd><StockFigure value={row.empty} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                  <div><dt className="text-muted-foreground">{t('inventory.damaged')}</dt><dd><StockFigure value={row.damaged} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                </dl>
              </button>
            ))
          )}
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          {!selected ? (
            <EmptyState title={t('inventory.pickLocationTitle')} description={t('inventory.pickLocationBody')} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{selected.location.name}</h2>
                  <p className="text-sm text-muted-foreground">{t(`inventory.kind.${selected.location.kind}`)}</p>
                </div>
                {canTransfer ? (
                  <Button asChild variant="accent" size="sm">
                    <Link to={`/inventory/transfer?from=${selected.location.id}`}>{t('inventory.transferFromHere')}</Link>
                  </Button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">{t('inventory.product')}</th>
                      <th className="py-2 pr-3 font-medium">{t('inventory.filled')}</th>
                      <th className="py-2 pr-3 font-medium">{t('inventory.empty')}</th>
                      <th className="py-2 font-medium">{t('inventory.damaged')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.products.map((product) => (
                      <tr key={product.product.id} className="border-t border-border">
                        <td className="py-2 pr-3">{product.product.name}</td>
                        <td className="py-2 pr-3"><StockFigure value={product.filled} missingLabel={t('inventory.notRecordedShort')} /></td>
                        <td className="py-2 pr-3"><StockFigure value={product.empty} missingLabel={t('inventory.notRecordedShort')} /></td>
                        <td className="py-2"><StockFigure value={product.damaged} missingLabel={t('inventory.notRecordedShort')} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="mb-2 font-semibold">{t('inventory.locationHistory')}</h3>
                {historyQuery.isLoading ? (
                  <LoadingState />
                ) : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('inventory.locationHistoryEmpty')}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {history.slice(0, 12).map((row) => (
                      <li key={row.key}>
                        <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40" onClick={() => setMovement(row)}>
                          <span>
                            <span className="font-medium">{t(`inventory.movement.${row.movementType}`)}</span>
                            <span className="block text-muted-foreground">
                              {formatBusinessDate(row.businessDate, i18n.language)} · {productNames.get(row.productId) ?? row.productId}
                            </span>
                          </span>
                          <SignedQty value={row.filledDelta + row.emptyDelta + row.damagedDelta} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <MovementDetailsDialog
        row={movement}
        onOpenChange={(open) => { if (!open) setMovement(null) }}
        locationName={(id) => (id ? names.get(id) ?? id : '—')}
        productName={(id) => productNames.get(id) ?? id}
        sourceName={movement?.sourceLocationId ? names.get(movement.sourceLocationId) ?? movement.sourceLocationId : '—'}
        destinationName={movement?.destinationLocationId ? names.get(movement.destinationLocationId) ?? movement.destinationLocationId : '—'}
      />
    </div>
  )
}
