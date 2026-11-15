import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { canCreateInventoryOpening } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createStockOpening, newInventoryTransactionId } from '@/services/api/inventory'
import { callableErrorMessage } from '@/services/errors'
import { selectClass } from './InventoryWidgets'
import { todayBusinessDate, useInventoryMasters } from './InventoryFormShared'
import { fetchInventoryOpenings } from './inventory-query'
import { parseQty } from './inventory-stock'

type OpeningRow = { key: string; productId: string; filled: string; empty: string; damaged: string }

function blankRow(): OpeningRow {
  return { key: newInventoryTransactionId(), productId: '', filled: '', empty: '', damaged: '' }
}

export function InventoryOpeningPage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const queryClient = useQueryClient()
  const masters = useInventoryMasters()
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const allowed = Boolean(role && profile && canCreateInventoryOpening(role, profile.permissions))
  const postsNow = role === 'admin'

  const [businessDate, setBusinessDate] = useState(todayBusinessDate())
  const [locationId, setLocationId] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<OpeningRow[]>([blankRow()])
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const openedKeys = useMemo(
    () => new Set((openingsQuery.data ?? []).filter((row) => row.locationId === locationId).map((row) => row.productId)),
    [openingsQuery.data, locationId],
  )
  const locationName = masters.data?.locations.find((row) => row.id === locationId)?.name ?? ''
  const productName = (id: string) => masters.data?.products.find((row) => row.id === id)?.name ?? id

  function updateRow(key: string, patch: Partial<OpeningRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    setError(null)
  }

  function validate(): string | null {
    if (!locationId) return t('inventory.locationRequired')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return t('inventory.dateRequired')
    const chosen = rows.filter((row) => row.productId)
    if (chosen.length === 0) return t('inventory.atLeastOne')
    const seen = new Set<string>()
    for (const row of chosen) {
      if (seen.has(row.productId)) return t('inventory.duplicateProduct')
      seen.add(row.productId)
      if (openedKeys.has(row.productId)) return t('inventory.alreadyOpened', { product: productName(row.productId) })
      const filled = parseQty(row.filled)
      const empty = parseQty(row.empty)
      const damaged = parseQty(row.damaged)
      if (filled === null || empty === null || damaged === null) return t('inventory.qtyInvalid')
      if (filled + empty + damaged < 1) return t('inventory.atLeastOne')
    }
    return null
  }

  async function save() {
    const chosen = rows.filter((row) => row.productId)
    setPending(true)
    try {
      let waiting = false
      for (const row of chosen) {
        const id = newInventoryTransactionId()
        const result = await createStockOpening({
          transactionId: id,
          idempotencyKey: id,
          businessDate,
          locationId,
          productId: row.productId,
          filledQuantity: parseQty(row.filled) ?? 0,
          emptyQuantity: parseQty(row.empty) ?? 0,
          damagedQuantity: parseQty(row.damaged) ?? 0,
          note: note.trim() || null,
        })
        waiting = waiting || result.status === 'pending_approval'
      }
      toast.success(waiting ? t('inventory.submittedPending') : t('inventory.openingSaved'))
      setReviewOpen(false)
      setRows([blankRow()])
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-openings'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-pending'] })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'agency'] })
    } catch (saveError) {
      toast.error(callableErrorMessage(saveError, t))
    } finally {
      setPending(false)
    }
  }

  if (!allowed) return <ErrorState title={t('inventory.noPermission')} />
  if (masters.isLoading || openingsQuery.isLoading) return <LoadingState />
  if (masters.isError || !masters.data) return <ErrorState title={t('errors.generic')} />

  const readyProducts = masters.data.products.filter((product) => !openedKeys.has(product.id))

  return (
    <div>
      <PageHeader title={t('inventory.navOpening')} description={t('inventory.openingBody')} />
      <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <FormField label={t('inventory.location')}>
          <select className={selectClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">{t('inventory.selectPlaceholder')}</option>
            {masters.data.locations.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label={t('inventory.businessDate')}>
          <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
        </FormField>
        {locationId ? (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {t('inventory.openingContext', {
              location: locationName,
              date: formatBusinessDate(businessDate, i18n.language),
            })}
          </p>
        ) : null}
      </div>

      {locationId && readyProducts.length === 0 ? (
        <ErrorState title={t('inventory.allOpened')} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const message = validate()
            setError(message)
            if (!message) setReviewOpen(true)
          }}
        >
          {rows.map((row, index) => (
            <fieldset key={row.key} className="rounded-xl border border-border bg-card p-4">
              <legend className="px-1 text-sm font-semibold">{t('inventory.cylinderRow', { index: index + 1 })}</legend>
              <div className="grid gap-3 md:grid-cols-4">
                <FormField label={t('inventory.product')}>
                  <select className={selectClass} value={row.productId} onChange={(event) => updateRow(row.key, { productId: event.target.value })}>
                    <option value="">{t('inventory.selectPlaceholder')}</option>
                    {(masters.data?.products ?? []).map((product) => (
                      <option key={product.id} value={product.id} disabled={openedKeys.has(product.id)}>
                        {openedKeys.has(product.id) ? `${product.name} (${t('inventory.alreadyShort')})` : product.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t('inventory.filled')}>
                  <Input inputMode="numeric" value={row.filled} onChange={(event) => updateRow(row.key, { filled: event.target.value })} />
                </FormField>
                <FormField label={t('inventory.empty')}>
                  <Input inputMode="numeric" value={row.empty} onChange={(event) => updateRow(row.key, { empty: event.target.value })} />
                </FormField>
                <FormField label={t('inventory.damaged')}>
                  <Input inputMode="numeric" value={row.damaged} onChange={(event) => updateRow(row.key, { damaged: event.target.value })} />
                </FormField>
              </div>
              {rows.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                  {t('inventory.remove')}
                </Button>
              ) : null}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, blankRow()])}>
              {t('inventory.addProduct')}
            </Button>
          </div>
          <FormField label={t('inventory.note')}>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <p className="text-sm text-muted-foreground">{postsNow ? t('inventory.adminPostHint') : t('inventory.staffPendingHint')}</p>
          <Button type="submit" variant="accent">{t('inventory.review')}</Button>
        </form>
      )}

      <ConfirmationDialog
        open={reviewOpen}
        pending={pending}
        title={t('inventory.confirmOpening')}
        description={postsNow ? t('inventory.adminPostHint') : t('inventory.staffPendingHint')}
        confirmLabel={t('inventory.saveOpening')}
        onOpenChange={setReviewOpen}
        onConfirm={() => void save()}
      >
        <p className="text-sm font-medium">{locationName} · {formatBusinessDate(businessDate, i18n.language)}</p>
        <ul className="space-y-2 text-sm">
          {rows.filter((row) => row.productId).map((row) => (
            <li key={row.key} className="rounded-lg border border-border px-3 py-2">
              <p className="font-medium">{productName(row.productId)}</p>
              <p>{t('inventory.filled')} {parseQty(row.filled) ?? 0} · {t('inventory.empty')} {parseQty(row.empty) ?? 0} · {t('inventory.damaged')} {parseQty(row.damaged) ?? 0}</p>
            </li>
          ))}
        </ul>
        {note.trim() ? <p className="text-sm text-muted-foreground">{note.trim()}</p> : null}
      </ConfirmationDialog>
    </div>
  )
}
