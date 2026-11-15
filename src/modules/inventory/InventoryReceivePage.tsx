import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { inventoryBalanceId } from '@shared/models/inventory'
import { canCreateInventoryReceive } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createStockReceipt, createStockReturnToDistributor, newInventoryTransactionId } from '@/services/api/inventory'
import { callableErrorMessage } from '@/services/errors'
import { QtyPill, selectClass } from './InventoryWidgets'
import { todayBusinessDate, useInventoryMasters } from './InventoryFormShared'
import { fetchInventoryBalances, fetchInventoryOpenings } from './inventory-query'
import { parseQty } from './inventory-stock'

export function InventoryReceivePage() {
  const { t } = useTranslation()
  const { role, profile } = useAuth()
  const queryClient = useQueryClient()
  const masters = useInventoryMasters()
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const allowed = Boolean(role && profile && canCreateInventoryReceive(role, profile.permissions))
  const postsNow = role === 'admin'

  const [mode, setMode] = useState<'in' | 'out'>('in')
  const [businessDate, setBusinessDate] = useState(todayBusinessDate())
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [filled, setFilled] = useState('')
  const [empty, setEmpty] = useState('')
  const [damaged, setDamaged] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const opened = useMemo(
    () => (openingsQuery.data ?? []).some((row) => row.locationId === locationId && row.productId === productId),
    [openingsQuery.data, locationId, productId],
  )
  const available = useMemo(() => {
    const qty = (state: 'filled' | 'empty' | 'damaged') =>
      balancesQuery.data?.find((row) => row.id === inventoryBalanceId(locationId, productId, state))?.quantity ?? (opened ? 0 : null)
    return { filled: qty('filled'), empty: qty('empty'), damaged: qty('damaged') }
  }, [balancesQuery.data, locationId, productId, opened])

  function validate(): string | null {
    if (!locationId || !productId) return t('inventory.locationProductRequired')
    if (!opened) return t('inventory.needOpening')
    const filledQty = parseQty(filled)
    const emptyQty = parseQty(empty)
    const damagedQty = parseQty(damaged)
    if (filledQty === null || emptyQty === null || damagedQty === null) return t('inventory.qtyInvalid')
    if (filledQty + emptyQty + damagedQty < 1) return t('inventory.atLeastOne')
    if (mode === 'out') {
      if (filledQty > (available.filled ?? 0)) return t('inventory.insufficient', { available: available.filled ?? 0, state: t('inventory.filled') })
      if (emptyQty > (available.empty ?? 0)) return t('inventory.insufficient', { available: available.empty ?? 0, state: t('inventory.empty') })
      if (damagedQty > (available.damaged ?? 0)) return t('inventory.insufficient', { available: available.damaged ?? 0, state: t('inventory.damaged') })
    }
    return null
  }

  async function save() {
    setPending(true)
    try {
      const id = newInventoryTransactionId()
      const payload = {
        transactionId: id,
        idempotencyKey: id,
        businessDate,
        locationId,
        productId,
        filledQuantity: parseQty(filled) ?? 0,
        emptyQuantity: parseQty(empty) ?? 0,
        damagedQuantity: parseQty(damaged) ?? 0,
        note: note.trim() || null,
      }
      const result = mode === 'in' ? await createStockReceipt(payload) : await createStockReturnToDistributor(payload)
      toast.success(result.status === 'pending_approval' ? t('inventory.submittedPending') : t('inventory.receiveSaved'))
      setReviewOpen(false)
      setFilled('')
      setEmpty('')
      setDamaged('')
      setNote('')
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
  if (masters.isLoading) return <LoadingState />
  if (masters.isError || !masters.data) return <ErrorState title={t('errors.generic')} />

  const locationName = masters.data.locations.find((row) => row.id === locationId)?.name ?? ''
  const productName = masters.data.products.find((row) => row.id === productId)?.name ?? ''

  return (
    <div>
      <PageHeader title={t('inventory.navReceive')} description={t('inventory.receiveBody')} />
      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          const message = validate()
          setError(message)
          if (!message) setReviewOpen(true)
        }}
      >
        <FormField label={t('inventory.direction')}>
          <select className={selectClass} value={mode} onChange={(event) => setMode(event.target.value as 'in' | 'out')}>
            <option value="in">{t('inventory.fromDistributor')}</option>
            <option value="out">{t('inventory.toDistributor')}</option>
          </select>
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
        <FormField label={t('inventory.businessDate')}>
          <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
        </FormField>
        {locationId && productId ? (
          <div className="grid grid-cols-3 gap-2">
            <QtyPill label={t('inventory.filledOnHand')} value={available.filled} />
            <QtyPill label={t('inventory.emptyOnHand')} value={available.empty} />
            <QtyPill label={t('inventory.damagedOnHand')} value={available.damaged} />
          </div>
        ) : null}
        {!opened && locationId && productId ? <p className="text-sm text-destructive">{t('inventory.needOpening')}</p> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('inventory.filled')}><Input inputMode="numeric" value={filled} onChange={(event) => setFilled(event.target.value)} /></FormField>
          <FormField label={t('inventory.empty')}><Input inputMode="numeric" value={empty} onChange={(event) => setEmpty(event.target.value)} /></FormField>
          <FormField label={t('inventory.damaged')}><Input inputMode="numeric" value={damaged} onChange={(event) => setDamaged(event.target.value)} /></FormField>
        </div>
        <FormField label={t('inventory.note')}><Input value={note} onChange={(event) => setNote(event.target.value)} /></FormField>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <p className="text-sm text-muted-foreground">{postsNow ? t('inventory.adminPostHint') : t('inventory.staffPendingHint')}</p>
        <Button type="submit" variant="accent">{t('inventory.review')}</Button>
      </form>

      <ConfirmationDialog
        open={reviewOpen}
        pending={pending}
        title={mode === 'in' ? t('inventory.confirmReceive') : t('inventory.confirmReturn')}
        description={postsNow ? t('inventory.adminPostHint') : t('inventory.staffPendingHint')}
        confirmLabel={t('common.save')}
        onOpenChange={setReviewOpen}
        onConfirm={() => void save()}
      >
        <p className="text-sm">{locationName} · {productName}</p>
        <p className="text-sm">{t('inventory.filled')} {parseQty(filled) ?? 0} · {t('inventory.empty')} {parseQty(empty) ?? 0} · {t('inventory.damaged')} {parseQty(damaged) ?? 0}</p>
      </ConfirmationDialog>
    </div>
  )
}
