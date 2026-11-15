import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { INVENTORY_MOVEMENT_TYPES } from '@shared/models/inventory'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { SearchInput } from '@/components/forms/SearchInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MovementDetailsDialog, selectClass, SignedQty } from './InventoryWidgets'
import { todayBusinessDate } from './InventoryFormShared'
import { fetchInventoryLedger, fetchInventoryMasterData } from './inventory-query'
import { groupLedgerLines, movementDirection, type LedgerDisplayRow } from './inventory-stock'

export function InventoryLedgerPage() {
  const { t, i18n } = useTranslation()
  const today = todayBusinessDate()
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [movementType, setMovementType] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<LedgerDisplayRow | null>(null)

  const masterQuery = useQuery({ queryKey: ['inventory-master'], queryFn: fetchInventoryMasterData })
  const ledgerQuery = useQuery({
    queryKey: ['inventory-ledger', fromDate, toDate, locationId],
    queryFn: () => fetchInventoryLedger({ fromDate, toDate, locationId: locationId || undefined }),
  })

  const names = useMemo(
    () => new Map((masterQuery.data?.locations ?? []).map((row) => [row.id, row.name])),
    [masterQuery.data],
  )
  const productNames = useMemo(
    () => new Map((masterQuery.data?.products ?? []).map((row) => [row.id, row.name])),
    [masterQuery.data],
  )
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return groupLedgerLines(ledgerQuery.data ?? []).filter((row) => {
      if (productId && row.productId !== productId) return false
      if (movementType && row.movementType !== movementType) return false
      if (!needle) return true
      const blob = [
        row.transactionId,
        row.note,
        names.get(row.locationId),
        productNames.get(row.productId),
        t(`inventory.movement.${row.movementType}`),
      ].join(' ').toLowerCase()
      return blob.includes(needle)
    })
  }, [ledgerQuery.data, productId, movementType, search, names, productNames, t])

  function clearFilters() {
    setFromDate(today)
    setToDate(today)
    setLocationId('')
    setProductId('')
    setMovementType('')
    setSearch('')
  }

  return (
    <div>
      <PageHeader
        title={t('inventory.navLedger')}
        description={t('inventory.ledgerBody')}
        actions={<Button type="button" variant="outline" onClick={clearFilters}>{t('inventory.clearFilters')}</Button>}
      />
      <p className="mb-4 text-sm text-muted-foreground">{t('inventory.recordedHint')}</p>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FormField label={t('inventory.dateFrom')}><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></FormField>
        <FormField label={t('inventory.dateTo')}><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></FormField>
        <FormField label={t('inventory.location')}>
          <select className={selectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">{t('inventory.allLocations')}</option>
            {(masterQuery.data?.locations ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </FormField>
        <FormField label={t('inventory.product')}>
          <select className={selectClass} value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">{t('inventory.allProducts')}</option>
            {(masterQuery.data?.products ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </FormField>
        <FormField label={t('inventory.movementType')}>
          <select className={selectClass} value={movementType} onChange={(event) => setMovementType(event.target.value)}>
            <option value="">{t('inventory.allMovements')}</option>
            {INVENTORY_MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>{t(`inventory.movement.${type}`)}</option>
            ))}
          </select>
        </FormField>
        <FormField label={t('common.search')}>
          <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('inventory.searchLedger')} />
        </FormField>
      </div>

      {ledgerQuery.isLoading ? (
        <LoadingState />
      ) : ledgerQuery.isError ? (
        <ErrorState title={t('errors.generic')} action={<Button type="button" variant="outline" onClick={() => void ledgerQuery.refetch()}>{t('common.retry')}</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('inventory.ledgerEmptyTitle')} description={t('inventory.ledgerEmptyBody')} />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <button key={row.key} type="button" className="w-full rounded-xl border border-border bg-card p-4 text-left" onClick={() => setSelected(row)}>
                <p className="font-semibold">{t(`inventory.movement.${row.movementType}`)}</p>
                <p className="text-sm text-muted-foreground">{formatBusinessDate(row.businessDate, i18n.language)} · {productNames.get(row.productId) ?? row.productId}</p>
                <p className="mt-2 text-sm">{t(`inventory.directionLabel.${movementDirection(row)}`)} · {names.get(row.locationId) ?? row.locationId}</p>
                <p className="mt-1 text-sm">{t('inventory.filled')} <SignedQty value={row.filledDelta} /> · {t('inventory.empty')} <SignedQty value={row.emptyDelta} /></p>
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-3 font-medium">{t('inventory.businessDate')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.movementType')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.product')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.filled')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.empty')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.source')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.destination')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.reference')}</th>
                  <th className="px-3 py-3 font-medium">{t('inventory.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={() => setSelected(row)}>
                    <td className="px-3 py-3">{formatBusinessDate(row.businessDate, i18n.language)}</td>
                    <td className="px-3 py-3">
                      <span className="font-medium">{t(`inventory.movement.${row.movementType}`)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{t(`inventory.directionLabel.${movementDirection(row)}`)}</span>
                    </td>
                    <td className="px-3 py-3">{productNames.get(row.productId) ?? row.productId}</td>
                    <td className="px-3 py-3"><SignedQty value={row.filledDelta} /></td>
                    <td className="px-3 py-3"><SignedQty value={row.emptyDelta} /></td>
                    <td className="px-3 py-3">{row.sourceLocationId ? names.get(row.sourceLocationId) ?? row.sourceLocationId : '—'}</td>
                    <td className="px-3 py-3">{row.destinationLocationId ? names.get(row.destinationLocationId) ?? row.destinationLocationId : names.get(row.locationId) ?? '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs">{row.transactionId.slice(0, 8)}</td>
                    <td className="px-3 py-3">{t('inventory.statusRecorded')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
