import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { inventoryBalanceId, type InventoryState } from '@shared/models/inventory'
import { canCreateInventoryTransfer } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createStockTransfer, newInventoryTransactionId } from '@/services/api/inventory'
import { callableErrorMessage } from '@/services/errors'
import { QtyPill, selectClass } from './InventoryWidgets'
import { todayBusinessDate, useInventoryMasters } from './InventoryFormShared'
import { fetchInventoryBalances, fetchInventoryOpenings } from './inventory-query'
import { parseQty } from './inventory-stock'

const STATES = ['filled', 'empty', 'damaged'] as const

export function InventoryTransferPage() {
  const { t } = useTranslation()
  const { role, profile } = useAuth()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const masters = useInventoryMasters()
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const allowed = Boolean(role && profile && canCreateInventoryTransfer(role, profile.permissions))
  const postsNow = role === 'admin'

  const [businessDate, setBusinessDate] = useState(todayBusinessDate())
  const [sourceLocationId, setSource] = useState(params.get('from') ?? '')
  const [destinationLocationId, setDest] = useState('')
  const [productId, setProductId] = useState('')
  const [filled, setFilled] = useState('')
  const [empty, setEmpty] = useState('')
  const [damaged, setDamaged] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const from = params.get('from')
    if (from) setSource(from)
  }, [params])

  const sourceOpen = (openingsQuery.data ?? []).some((row) => row.locationId === sourceLocationId && row.productId === productId)
  const destOpen = (openingsQuery.data ?? []).some((row) => row.locationId === destinationLocationId && row.productId === productId)
  const available = useMemo(() => {
    const qty = (state: InventoryState) => {
      if (!sourceOpen) return null
      return balancesQuery.data?.find((row) => row.id === inventoryBalanceId(sourceLocationId, productId, state))?.quantity ?? 0
    }
    return { filled: qty('filled'), empty: qty('empty'), damaged: qty('damaged') }
  }, [balancesQuery.data, sourceLocationId, productId, sourceOpen])

  const quantities = {
    filled: parseQty(filled),
    empty: parseQty(empty),
    damaged: parseQty(damaged),
  }

  function validate(): string | null {
    if (!sourceLocationId || !destinationLocationId || !productId) return t('inventory.transferRequired')
    if (sourceLocationId === destinationLocationId) return t('inventory.sameLocation')
    if (!sourceOpen || !destOpen) return t('inventory.bothNeedOpening')
    if (quantities.filled === null || quantities.empty === null || quantities.damaged === null) return t('inventory.qtyInvalid')
    const planned = STATES.filter((state) => (quantities[state] ?? 0) > 0)
    if (planned.length === 0) return t('inventory.atLeastOne')
    for (const state of planned) {
      const asked = quantities[state] ?? 0
      const have = available[state] ?? 0
      if (asked > have) return t('inventory.insufficient', { available: have, state: t(`inventory.${state}`) })
    }
    return null
  }

  async function save() {
    const planned = STATES.filter((state) => (quantities[state] ?? 0) > 0)
    setPending(true)
    let saved = 0
    try {
      let waiting = false
      for (const state of planned) {
        const id = newInventoryTransactionId()
        const result = await createStockTransfer({
          transactionId: id,
          idempotencyKey: id,
          businessDate,
          sourceLocationId,
          destinationLocationId,
          productId,
          state,
          quantity: quantities[state] ?? 0,
          note: note.trim() || null,
        })
        saved += 1
        waiting = waiting || result.status === 'pending_approval'
      }
      toast.success(waiting ? t('inventory.submittedPending') : t('inventory.transferSaved'))
      setReviewOpen(false)
      setFilled('')
      setEmpty('')
      setDamaged('')
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-pending'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger'] })
    } catch (saveError) {
      toast.error(saved > 0 ? t('inventory.transferPartial', { saved }) : callableErrorMessage(saveError, t))
      if (saved > 0) {
        await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] })
      }
    } finally {
      setPending(false)
    }
  }

  if (!allowed) return <ErrorState title={t('inventory.noPermission')} />
  if (masters.isLoading) return <LoadingState />
  if (masters.isError || !masters.data) return <ErrorState title={t('errors.generic')} />

  const nameOf = (id: string) => masters.data?.locations.find((row) => row.id === id)?.name ?? id
  const productName = masters.data.products.find((row) => row.id === productId)?.name ?? ''

  return (
    <div>
      <PageHeader title={t('inventory.navTransfer')} description={t('inventory.transferBody')} />
      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const message = validate()
          setError(message)
          if (!message) setReviewOpen(true)
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('inventory.source')} error={sourceLocationId && sourceLocationId === destinationLocationId ? t('inventory.sameLocation') : undefined}>
            <select className={selectClass} value={sourceLocationId} onChange={(event) => setSource(event.target.value)}>
              <option value="">{t('inventory.selectPlaceholder')}</option>
              {masters.data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </FormField>
          <FormField label={t('inventory.destination')}>
            <select className={selectClass} value={destinationLocationId} onChange={(event) => setDest(event.target.value)}>
              <option value="">{t('inventory.selectPlaceholder')}</option>
              {masters.data.locations.filter((row) => row.id !== sourceLocationId).map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('inventory.product')}>
            <select className={selectClass} value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">{t('inventory.selectPlaceholder')}</option>
              {masters.data.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </FormField>
          <FormField label={t('inventory.businessDate')}>
            <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </FormField>
        </div>
        {sourceLocationId && productId ? (
          <div>
            <p className="mb-2 text-sm font-medium">{t('inventory.sourceStock')}</p>
            <div className="grid grid-cols-3 gap-2">
              <QtyPill label={t('inventory.filled')} value={available.filled} />
              <QtyPill label={t('inventory.empty')} value={available.empty} />
              <QtyPill label={t('inventory.damaged')} value={available.damaged} />
            </div>
            {!sourceOpen || (destinationLocationId && !destOpen) ? (
              <p className="mt-2 text-sm text-destructive">{t('inventory.bothNeedOpening')}</p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('inventory.filledToMove')}><Input inputMode="numeric" value={filled} onChange={(event) => setFilled(event.target.value)} /></FormField>
          <FormField label={t('inventory.emptyToMove')}><Input inputMode="numeric" value={empty} onChange={(event) => setEmpty(event.target.value)} /></FormField>
          <FormField label={t('inventory.damagedToMove')}><Input inputMode="numeric" value={damaged} onChange={(event) => setDamaged(event.target.value)} /></FormField>
        </div>
        <FormField label={t('inventory.note')}><Input value={note} onChange={(event) => setNote(event.target.value)} /></FormField>
        <p className="text-sm text-muted-foreground">{t('inventory.transferSeparateNote')}</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" variant="accent">{t('inventory.review')}</Button>
      </form>

      <ConfirmationDialog
        open={reviewOpen}
        pending={pending}
        title={t('inventory.confirmTransfer')}
        description={t('inventory.transferSeparateNote')}
        confirmLabel={t('inventory.saveTransfer')}
        onOpenChange={setReviewOpen}
        onConfirm={() => void save()}
      >
        <p className="text-sm font-medium">{nameOf(sourceLocationId)} → {nameOf(destinationLocationId)}</p>
        <p className="text-sm">{productName}</p>
        <ul className="text-sm">
          {STATES.filter((state) => (quantities[state] ?? 0) > 0).map((state) => (
            <li key={state}>{t(`inventory.${state}`)}: {quantities[state]}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{postsNow ? t('inventory.adminPostHint') : t('inventory.staffPendingHint')}</p>
      </ConfirmationDialog>
    </div>
  )
}
