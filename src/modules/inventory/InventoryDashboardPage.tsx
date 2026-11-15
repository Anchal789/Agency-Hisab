import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { parseAgencySettings } from '@shared/models/agency-config'
import {
  canCreateInventoryOpening,
  canCreateInventoryReceive,
  canCreateInventoryReconcile,
  canCreateInventoryTransfer,
  canApproveInventory,
} from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { SummaryCard } from '@/components/common/SummaryCard'
import { Button } from '@/components/ui/button'
import { getFirebase } from '@/services/firebase/client'
import { AlertBanner, AlertList, MovementDetailsDialog, SignedQty, StockFigure } from './InventoryWidgets'
import {
  fetchInventoryBalances,
  fetchInventoryLedger,
  fetchInventoryMasterData,
  fetchInventoryOpenings,
  fetchOpenEmptyObligationsTotal,
  fetchPendingInventoryTransactions,
} from './inventory-query'
import {
  buildLocationStock,
  countLocationsHolding,
  groupLedgerLines,
  sumRecorded,
  type LedgerDisplayRow,
} from './inventory-stock'

export function InventoryDashboardPage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const permissions = profile?.permissions
  const canOpen = Boolean(role && permissions && canCreateInventoryOpening(role, permissions))
  const canReceive = Boolean(role && permissions && canCreateInventoryReceive(role, permissions))
  const canTransfer = Boolean(role && permissions && canCreateInventoryTransfer(role, permissions))
  const canCount = Boolean(role && permissions && canCreateInventoryReconcile(role, permissions))
  const isAdmin = Boolean(role && canApproveInventory(role))
  const [selected, setSelected] = useState<LedgerDisplayRow | null>(null)

  const agencyQuery = useQuery({
    queryKey: ['settings', 'agency'],
    queryFn: async () => {
      const snap = await getDoc(doc(getFirebase().db, 'settings/agency'))
      return parseAgencySettings(snap.data() as Record<string, unknown> | undefined)
    },
  })
  const masterQuery = useQuery({ queryKey: ['inventory-master'], queryFn: fetchInventoryMasterData })
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const obligationsQuery = useQuery({
    queryKey: ['inventory-empty-obligations'],
    queryFn: fetchOpenEmptyObligationsTotal,
  })
  const pendingQuery = useQuery({
    queryKey: ['inventory-pending'],
    queryFn: fetchPendingInventoryTransactions,
  })
  const ledgerQuery = useQuery({
    queryKey: ['inventory-ledger', 'recent'],
    queryFn: () => fetchInventoryLedger({}),
  })

  const locations = masterQuery.data?.locations ?? []
  const products = masterQuery.data?.products ?? []
  const stock = useMemo(
    () => buildLocationStock(locations, products, balancesQuery.data ?? [], openingsQuery.data ?? []),
    [locations, products, balancesQuery.data, openingsQuery.data],
  )
  const movements = useMemo(() => groupLedgerLines(ledgerQuery.data ?? []).slice(0, 8), [ledgerQuery.data])
  const names = useMemo(() => new Map(locations.map((row) => [row.id, row.name])), [locations])
  const productNames = useMemo(() => new Map(products.map((row) => [row.id, row.name])), [products])

  const filled = sumRecorded(stock, 'filled')
  const empty = sumRecorded(stock, 'empty')
  const damaged = sumRecorded(stock, 'damaged')
  const pendingCount = pendingQuery.data?.length ?? 0
  const missing = stock.flatMap((row) => row.products.filter((product) => !product.opened).map((product) => ({
    location: row.location.name,
    product: product.product.name,
  })))
  const noFilled = stock.filter((row) => row.filled === 0)
  const adjustmentsToday = (ledgerQuery.data ?? []).some((row) => row.movementType === 'adjustment')
  const customerDue = obligationsQuery.data?.customerOutstanding ?? 0
  const hasOpenings = (openingsQuery.data?.length ?? 0) > 0
  const loading = masterQuery.isLoading || balancesQuery.isLoading || openingsQuery.isLoading
  const errored = masterQuery.isError || balancesQuery.isError || openingsQuery.isError

  const actions = (
    <>
      {canReceive ? (
        <Button asChild variant="accent">
          <Link to="/inventory/receive">{t('inventory.actionReceive')}</Link>
        </Button>
      ) : null}
      {canTransfer ? (
        <Button asChild variant="outline">
          <Link to="/inventory/transfer">{t('inventory.actionTransfer')}</Link>
        </Button>
      ) : null}
      {canCount ? (
        <Button asChild variant="outline">
          <Link to="/inventory/reconcile">{t('inventory.actionCount')}</Link>
        </Button>
      ) : null}
    </>
  )

  return (
    <div>
      <PageHeader title={t('inventory.title')} description={t('inventory.subtitle')} actions={actions} />

      {canOpen && !hasOpenings && !loading ? (
        <div className="mb-4">
          <Button asChild variant="accent">
            <Link to="/inventory/opening">{t('inventory.actionOpening')}</Link>
          </Button>
        </div>
      ) : null}

      {agencyQuery.data && !agencyQuery.data.inventoryCutoverDate ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('inventory.cutoverUnset')}</p>
      ) : agencyQuery.data?.inventoryCutoverDate ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {t('inventory.cutoverDate', { date: agencyQuery.data.inventoryCutoverDate })}
        </p>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : errored ? (
        <ErrorState
          title={t('errors.generic')}
          action={
            <Button type="button" variant="outline" onClick={() => void balancesQuery.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="inventory-summary">
            <SummaryCard
              title={t('inventory.filledCylinders')}
              value={filled === null ? t('inventory.notRecordedShort') : String(filled)}
              hint={filled === null ? t('inventory.notRecordedBody') : t('inventory.locationsHolding', { count: countLocationsHolding(stock, 'filled') })}
            />
            <SummaryCard
              title={t('inventory.emptyCylinders')}
              value={empty === null ? t('inventory.notRecordedShort') : String(empty)}
              hint={empty === null ? t('inventory.physicalEmptyNote') : t('inventory.locationsHolding', { count: countLocationsHolding(stock, 'empty') })}
            />
            <SummaryCard
              title={t('inventory.damagedCylinders')}
              value={damaged === null ? t('inventory.notRecordedShort') : String(damaged)}
              hint={damaged === null ? undefined : t('inventory.locationsHolding', { count: countLocationsHolding(stock, 'damaged') })}
            />
            <SummaryCard
              title={t('inventory.pendingEntries')}
              value={String(pendingCount)}
              hint={pendingCount > 0 ? t('inventory.pendingHint') : t('inventory.pendingClear')}
            />
          </section>

          <AlertList>
            {!hasOpenings ? (
              <AlertBanner
                action={canOpen ? <Button asChild size="sm" variant="accent"><Link to="/inventory/opening">{t('inventory.actionOpening')}</Link></Button> : undefined}
              >
                {t('inventory.notRecordedBody')}
              </AlertBanner>
            ) : missing.length > 0 ? (
              <AlertBanner
                action={canOpen ? <Button asChild size="sm" variant="outline"><Link to="/inventory/opening">{t('inventory.actionOpening')}</Link></Button> : undefined}
              >
                {t('inventory.openingMissingSome', { count: missing.length })}
              </AlertBanner>
            ) : null}
            {isAdmin && pendingCount > 0 ? (
              <AlertBanner
                tone="info"
                action={<Button asChild size="sm" variant="outline"><Link to="/inventory/pending">{t('inventory.reviewPending')}</Link></Button>}
              >
                {t('inventory.pendingAlert', { count: pendingCount })}
              </AlertBanner>
            ) : null}
            {noFilled.map((row) => (
              <AlertBanner key={row.location.id}>
                {t('inventory.noFilledAlert', { location: row.location.name })}
              </AlertBanner>
            ))}
            {(damaged ?? 0) > 0 ? (
              <AlertBanner>{t('inventory.damagedAlert', { count: damaged })}</AlertBanner>
            ) : null}
            {adjustmentsToday ? (
              <AlertBanner
                tone="info"
                action={canCount ? <Button asChild size="sm" variant="outline"><Link to="/inventory/reconcile?tab=history">{t('inventory.viewAdjustments')}</Link></Button> : undefined}
              >
                {t('inventory.adjustedToday')}
              </AlertBanner>
            ) : null}
            {customerDue > 0 ? (
              <AlertBanner tone="info">{t('inventory.customerDueAlert', { count: customerDue })}</AlertBanner>
            ) : null}
          </AlertList>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">{t('inventory.stockByLocation')}</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/inventory/locations">{t('inventory.viewAllLocations')}</Link>
              </Button>
            </div>
            {!hasOpenings ? (
              <EmptyState title={t('inventory.notRecordedTitle')} description={t('inventory.notRecordedBody')} />
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {stock.map((row) => (
                    <article key={row.location.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{row.location.name}</h3>
                          <p className="text-xs text-muted-foreground">{t(`inventory.kind.${row.location.kind}`)}</p>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/inventory/locations?location=${row.location.id}`}>{t('inventory.view')}</Link>
                        </Button>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div><dt className="text-muted-foreground">{t('inventory.filled')}</dt><dd><StockFigure value={row.filled} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                        <div><dt className="text-muted-foreground">{t('inventory.empty')}</dt><dd><StockFigure value={row.empty} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                        <div><dt className="text-muted-foreground">{t('inventory.damaged')}</dt><dd><StockFigure value={row.damaged} missingLabel={t('inventory.notRecordedShort')} /></dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-4 py-3 font-medium">{t('inventory.location')}</th>
                        <th className="px-4 py-3 font-medium">{t('inventory.filled')}</th>
                        <th className="px-4 py-3 font-medium">{t('inventory.empty')}</th>
                        <th className="px-4 py-3 font-medium">{t('inventory.damaged')}</th>
                        <th className="px-4 py-3 font-medium">{t('inventory.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.map((row) => (
                        <tr key={row.location.id} className="border-t border-border">
                          <td className="px-4 py-3">
                            <p className="font-medium">{row.location.name}</p>
                            <p className="text-xs text-muted-foreground">{t(`inventory.kind.${row.location.kind}`)}</p>
                          </td>
                          <td className="px-4 py-3"><StockFigure value={row.filled} missingLabel={t('inventory.notRecordedShort')} /></td>
                          <td className="px-4 py-3"><StockFigure value={row.empty} missingLabel={t('inventory.notRecordedShort')} /></td>
                          <td className="px-4 py-3"><StockFigure value={row.damaged} missingLabel={t('inventory.notRecordedShort')} /></td>
                          <td className="px-4 py-3">
                            <Button asChild size="sm" variant="outline">
                              <Link to={`/inventory/locations?location=${row.location.id}`}>{t('inventory.view')}</Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('inventory.recentMovements')}</h2>
            {movements.length === 0 ? (
              <EmptyState title={t('inventory.recentEmptyTitle')} description={t('inventory.recentEmptyBody')} />
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {movements.map((row) => (
                  <li key={row.key}>
                    <button type="button" className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between" onClick={() => setSelected(row)}>
                      <div>
                        <p className="font-medium">{t(`inventory.movement.${row.movementType}`)}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatBusinessDate(row.businessDate, i18n.language)} · {productNames.get(row.productId) ?? row.productId}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <span>{t('inventory.filled')} <SignedQty value={row.filledDelta} /></span>
                        <span>{t('inventory.empty')} <SignedQty value={row.emptyDelta} /></span>
                        <span className="text-muted-foreground">{t('inventory.statusRecorded')}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <MovementDetailsDialog
        row={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        locationName={(id) => (id ? names.get(id) ?? id : '—')}
        productName={(id) => productNames.get(id) ?? id}
        sourceName={selected?.sourceLocationId ? names.get(selected.sourceLocationId) ?? selected.sourceLocationId : '—'}
        destinationName={selected?.destinationLocationId ? names.get(selected.destinationLocationId) ?? selected.destinationLocationId : '—'}
      />
    </div>
  )
}
