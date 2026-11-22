import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { inventoryBalanceId } from '@shared/models/inventory'
import { canCreateInventoryReconcile } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createStockReconciliation, newInventoryTransactionId } from '@/services/api/inventory'
import { callableErrorMessage } from '@/services/errors'
import { MovementDetailsDialog, selectClass } from './InventoryWidgets'
import { todayBusinessDate, useInventoryMasters } from './InventoryFormShared'
import { fetchInventoryBalances, fetchInventoryLedger } from './inventory-query'
import { groupLedgerLines, parseQty, type LedgerDisplayRow } from './inventory-stock'

function variance(system: number, actual: number): number {
  return actual - system
}

export function InventoryReconcilePage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const [params] = useSearchParams()
  const showHistory = params.get('tab') === 'history'
  const queryClient = useQueryClient()
  const masters = useInventoryMasters()
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const historyQuery = useQuery({
    queryKey: ['inventory-ledger', 'adjustments'],
    queryFn: () => fetchInventoryLedger({}),
  })
  const allowed = Boolean(role && profile && canCreateInventoryReconcile(role, profile.permissions))
  const postsNow = role === 'admin'

  const [businessDate, setBusinessDate] = useState(todayBusinessDate())
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [actualFilled, setActualFilled] = useState('')
  const [actualEmpty, setActualEmpty] = useState('')
  const [actualDamaged, setActualDamaged] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [selected, setSelected] = useState<LedgerDisplayRow | null>(null)

  /** System counts come from posted balances — opening is not required after transfer-in stock. */
  const system = useMemo(() => {
    const qty = (state: 'filled' | 'empty' | 'damaged') => {
      if (!locationId || !productId) return null
      return (
        balancesQuery.data?.find((row) => row.id === inventoryBalanceId(locationId, productId, state))?.quantity ?? 0
      )
    }
    return { filled: qty('filled'), empty: qty('empty'), damaged: qty('damaged') }
  }, [balancesQuery.data, locationId, productId])

  const actual = {
    filled: parseQty(actualFilled),
    empty: parseQty(actualEmpty),
    damaged: parseQty(actualDamaged),
  }
  const history = useMemo(
    () => groupLedgerLines(historyQuery.data ?? []).filter((row) => row.movementType === 'adjustment'),
    [historyQuery.data],
  )
  const names = useMemo(
    () => new Map((masters.data?.locations ?? []).map((row) => [row.id, row.name])),
    [masters.data],
  )
  const productNames = useMemo(
    () => new Map((masters.data?.products ?? []).map((row) => [row.id, row.name])),
    [masters.data],
  )

  function validate(): string | null {
    if (!locationId || !productId) return t('inventory.locationProductRequired')
    if (system.filled === null || system.empty === null || system.damaged === null) {
      return t('inventory.locationProductRequired')
    }
    if (actual.filled === null || actual.empty === null || actual.damaged === null) return t('inventory.qtyInvalid')
    const changed =
      actual.filled !== system.filled || actual.empty !== system.empty || actual.damaged !== system.damaged
    if (!changed) return t('inventory.countsMatch')
    if (reason.trim().length < 3) return t('inventory.reasonRequired')
    return null
  }

  async function save() {
    if (system.filled === null || actual.filled === null || actual.empty === null || actual.damaged === null) return
    setPending(true)
    try {
      const id = newInventoryTransactionId()
      const result = await createStockReconciliation({
        transactionId: id,
        idempotencyKey: id,
        businessDate,
        locationId,
        productId,
        actualFilled: actual.filled,
        actualEmpty: actual.empty,
        actualDamaged: actual.damaged,
        reason: reason.trim(),
        note: null,
      })
      toast.success(result.status === 'pending_approval' ? t('inventory.submittedPending') : t('inventory.reconcileSaved'))
      setReviewOpen(false)
      setReason('')
      await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-pending'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger'] })
    } catch (saveError) {
      toast.error(callableErrorMessage(saveError, t))
    } finally {
      setPending(false)
    }
  }

  if (!allowed) return <ErrorState title={t('inventory.noPermission')} />
  if (masters.isLoading || balancesQuery.isLoading) return <LoadingState />
  if (masters.isError || !masters.data) return <ErrorState title={t('errors.generic')} />

  const locationName = names.get(locationId) ?? ''
  const productName = productNames.get(productId) ?? ''

  return (
    <div>
      <PageHeader
        title={showHistory ? t('inventory.navReconcile') : t('inventory.navCount')}
        description={showHistory ? t('inventory.historyBody') : t('inventory.reconcileBody')}
      />
      {showHistory ? (
        historyQuery.isLoading ? <LoadingState /> : history.length === 0 ? (
          <EmptyState title={t('inventory.historyEmptyTitle')} description={t('inventory.historyEmptyBody')} />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {history.map((row) => (
              <li key={row.key}>
                <button type="button" className="w-full px-4 py-3 text-left hover:bg-muted/40" onClick={() => setSelected(row)}>
                  <p className="font-medium">{formatBusinessDate(row.businessDate, i18n.language)} · {productNames.get(row.productId) ?? row.productId}</p>
                  <p className="text-sm text-muted-foreground">{names.get(row.locationId) ?? row.locationId}{row.note ? ` · ${row.note}` : ''}</p>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form
          className="grid max-w-3xl gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const message = validate()
            setError(message)
            if (!message) setReviewOpen(true)
          }}
        >
          <FormField label={t('inventory.businessDate')}>
            <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t('inventory.location')}>
              <select className={selectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                <option value="">{t('inventory.selectPlaceholder')}</option>
                {masters.data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </FormField>
            <FormField label={t('inventory.product')}>
              <select className={selectClass} value={productId} onChange={(event) => setProductId(event.target.value)}>
                <option value="">{t('inventory.selectPlaceholder')}</option>
                {masters.data.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </FormField>
          </div>
          {locationId && productId && system.filled !== null && system.empty !== null && system.damaged !== null ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('inventory.state')}</th>
                    <th className="px-3 py-2 font-medium">{t('inventory.systemQty')}</th>
                    <th className="px-3 py-2 font-medium">{t('inventory.actualQty')}</th>
                    <th className="px-3 py-2 font-medium">{t('inventory.difference')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['filled', system.filled, actualFilled, setActualFilled, actual.filled],
                      ['empty', system.empty, actualEmpty, setActualEmpty, actual.empty],
                      ['damaged', system.damaged, actualDamaged, setActualDamaged, actual.damaged],
                    ] as const
                  ).map(([state, systemQty, value, setValue, parsed]) => {
                    const diff = parsed === null ? null : variance(systemQty, parsed)
                    return (
                      <tr key={state} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{t(`inventory.${state}`)}</td>
                        <td className="px-3 py-2 tabular-nums">{systemQty}</td>
                        <td className="px-3 py-2">
                          <Input
                            inputMode="numeric"
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {diff === null
                            ? '—'
                            : diff === 0
                              ? t('inventory.matches')
                              : diff < 0
                                ? t('inventory.shortage', { count: Math.abs(diff) })
                                : t('inventory.excess', { count: diff })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <FormField label={t('inventory.reason')}>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </FormField>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <p className="text-sm text-muted-foreground">{t('inventory.countDoesNotChangeUntilSave')}</p>
          <Button type="submit" variant="accent">{t('inventory.review')}</Button>
        </form>
      )}

      <ConfirmationDialog
        open={reviewOpen}
        pending={pending}
        title={t('inventory.confirmCount')}
        description={postsNow ? t('inventory.countWillAdjust') : t('inventory.staffPendingHint')}
        confirmLabel={t('inventory.saveReconcile')}
        onOpenChange={setReviewOpen}
        onConfirm={() => void save()}
      >
        <p className="text-sm font-medium">{locationName} · {productName}</p>
        <p className="text-sm">{reason.trim()}</p>
        {system.filled !== null && actual.filled !== null && actual.empty !== null && actual.damaged !== null && system.empty !== null && system.damaged !== null ? (
          <ul className="text-sm">
            <li>{t('inventory.filled')}: {system.filled} → {actual.filled}</li>
            <li>{t('inventory.empty')}: {system.empty} → {actual.empty}</li>
            <li>{t('inventory.damaged')}: {system.damaged} → {actual.damaged}</li>
          </ul>
        ) : null}
      </ConfirmationDialog>
      <MovementDetailsDialog
        row={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        locationName={(id) => (id ? names.get(id) ?? id : '—')}
        productName={(id) => productNames.get(id) ?? id}
        sourceName="—"
        destinationName={selected ? names.get(selected.locationId) ?? selected.locationId : '—'}
      />
    </div>
  )
}
