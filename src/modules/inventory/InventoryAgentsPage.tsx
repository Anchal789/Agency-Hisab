import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { SearchInput } from '@/components/forms/SearchInput'
import { MovementDetailsDialog, SignedQty, StockFigure } from './InventoryWidgets'
import {
  fetchInventoryBalances,
  fetchInventoryLedger,
  fetchInventoryMasterData,
  fetchInventoryOpenings,
  fetchOpenEmptyObligationsTotal,
} from './inventory-query'
import { buildLocationStock, groupLedgerLines, type LedgerDisplayRow } from './inventory-stock'

export function InventoryAgentsPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('location') ?? ''
  const [search, setSearch] = useState('')
  const [movement, setMovement] = useState<LedgerDisplayRow | null>(null)

  const masterQuery = useQuery({ queryKey: ['inventory-master'], queryFn: fetchInventoryMasterData })
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const dueQuery = useQuery({ queryKey: ['inventory-empty-obligations'], queryFn: fetchOpenEmptyObligationsTotal })
  const recentQuery = useQuery({ queryKey: ['inventory-ledger', 'recent'], queryFn: () => fetchInventoryLedger({}) })
  const historyQuery = useQuery({
    queryKey: ['inventory-ledger', 'location', selectedId],
    queryFn: () => fetchInventoryLedger({ locationId: selectedId }),
    enabled: Boolean(selectedId),
  })

  const stock = useMemo(
    () =>
      buildLocationStock(
        (masterQuery.data?.locations ?? []).filter((row) => row.kind === 'agent' || row.kind === 'csc'),
        masterQuery.data?.products ?? [],
        balancesQuery.data ?? [],
        openingsQuery.data ?? [],
      ),
    [masterQuery.data, balancesQuery.data, openingsQuery.data],
  )
  const recent = useMemo(() => groupLedgerLines(recentQuery.data ?? []), [recentQuery.data])
  const history = useMemo(() => groupLedgerLines(historyQuery.data ?? []), [historyQuery.data])
  const visible = stock.filter((row) => row.location.name.toLowerCase().includes(search.trim().toLowerCase()))
  const selected = stock.find((row) => row.location.id === selectedId) ?? null
  const names = useMemo(
    () => new Map((masterQuery.data?.locations ?? []).map((row) => [row.id, row.name])),
    [masterQuery.data],
  )
  const productNames = useMemo(
    () => new Map((masterQuery.data?.products ?? []).map((row) => [row.id, row.name])),
    [masterQuery.data],
  )

  if (masterQuery.isLoading || balancesQuery.isLoading || openingsQuery.isLoading) return <LoadingState />
  if (masterQuery.isError) return <ErrorState title={t('errors.generic')} />

  return (
    <div>
      <PageHeader title={t('inventory.navAgents')} description={t('inventory.agentsBody')} />
      <p className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {t('inventory.agentPhysicalNote')}
        {(dueQuery.data?.customerOutstanding ?? 0) > 0
          ? ` ${t('inventory.customerDueSeparate', { count: dueQuery.data?.customerOutstanding ?? 0 })}`
          : ''}
      </p>
      {stock.length === 0 ? (
        <EmptyState title={t('inventory.noAgentLocationsTitle')} description={t('inventory.noAgentLocationsBody')} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('inventory.searchAgents')} />
            {visible.map((row) => {
              const last = recent.find((item) => item.locationId === row.location.id)
              return (
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
                    <span className="text-sm font-medium text-accent">{t('inventory.viewDetails')}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-muted-foreground">{t('inventory.filled')}</dt><dd><StockFigure value={row.filled} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                    <div><dt className="text-muted-foreground">{t('inventory.empty')}</dt><dd><StockFigure value={row.empty} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                    <div><dt className="text-muted-foreground">{t('inventory.damaged')}</dt><dd><StockFigure value={row.damaged} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('inventory.lastMovement')}: {last ? `${formatBusinessDate(last.businessDate, i18n.language)} · ${t(`inventory.movement.${last.movementType}`)}` : t('inventory.noMovement')}
                  </p>
                </button>
              )
            })}
          </div>
          <section className="rounded-xl border border-border bg-card p-4">
            {!selected ? (
              <EmptyState title={t('inventory.pickAgentTitle')} description={t('inventory.pickAgentBody')} />
            ) : (
              <div>
                <h2 className="text-lg font-semibold">{selected.location.name}</h2>
                <p className="mb-3 text-sm text-muted-foreground">{t('inventory.agentHistoryBody')}</p>
                {historyQuery.isLoading ? <LoadingState /> : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('inventory.locationHistoryEmpty')}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {history.map((row) => (
                      <li key={row.key}>
                        <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm hover:bg-muted/40" onClick={() => setMovement(row)}>
                          <span>
                            <span className="font-medium">{formatBusinessDate(row.businessDate, i18n.language)}</span>
                            <span className="block text-muted-foreground">{t(`inventory.movement.${row.movementType}`)} · {productNames.get(row.productId) ?? row.productId}</span>
                          </span>
                          <SignedQty value={row.filledDelta || row.emptyDelta || row.damagedDelta} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      )}
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
