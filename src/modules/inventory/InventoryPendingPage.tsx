import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collection, getDocs } from 'firebase/firestore'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { canApproveInventory } from '@shared/rules/permissions'
import type { TransactionDoc } from '@shared/models/transaction'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { approveInventoryTransaction, rejectInventoryTransaction } from '@/services/api/inventory'
import { callableErrorMessage } from '@/services/errors'
import { getFirebase } from '@/services/firebase/client'
import { fetchInventoryMasterData, fetchPendingInventoryTransactions } from './inventory-query'

function payloadNumber(payload: Record<string, unknown> | null, key: string): number | null {
  const value = payload?.[key]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

export function InventoryPendingPage() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const queryClient = useQueryClient()
  const allowed = Boolean(role && canApproveInventory(role))
  const [selected, setSelected] = useState<TransactionDoc | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['inventory-pending'],
    queryFn: fetchPendingInventoryTransactions,
    enabled: allowed,
  })
  const masterQuery = useQuery({
    queryKey: ['inventory-master'],
    queryFn: fetchInventoryMasterData,
    enabled: allowed,
  })
  const usersQuery = useQuery({
    queryKey: ['users-directory'],
    enabled: allowed,
    queryFn: async () => {
      const snapshot = await getDocs(collection(getFirebase().db, 'users'))
      const names = new Map<string, string>()
      for (const row of snapshot.docs) {
        const name = row.data().displayName
        if (typeof name === 'string' && name.trim()) names.set(row.id, name.trim())
      }
      return names
    },
  })

  const approveMutation = useMutation({
    mutationFn: approveInventoryTransaction,
    onSuccess: async () => {
      toast.success(t('inventory.approved'))
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['inventory-pending'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-balances'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-openings'] })
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger'] })
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })
  const rejectMutation = useMutation({
    mutationFn: rejectInventoryTransaction,
    onSuccess: async () => {
      toast.success(t('inventory.rejected'))
      setSelected(null)
      setReason('')
      await queryClient.invalidateQueries({ queryKey: ['inventory-pending'] })
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  if (!allowed) return <ErrorState title={t('inventory.noPermission')} />

  const locationName = (id: string | null) =>
    masterQuery.data?.locations.find((row) => row.id === id)?.name ?? id ?? '—'
  const payload = selected?.inventoryPayload ?? null

  return (
    <div>
      <PageHeader title={t('inventory.navPending')} description={t('inventory.pendingBody')} />
      <p className="mb-4 text-sm text-muted-foreground">{t('inventory.approvalEffect')}</p>
      {listQuery.isLoading ? (
        <LoadingState />
      ) : listQuery.isError ? (
        <ErrorState title={t('errors.generic')} />
      ) : (listQuery.data?.length ?? 0) === 0 ? (
        <EmptyState title={t('inventory.noPendingTitle')} description={t('inventory.noPendingBody')} />
      ) : (
        <ul className="space-y-3">
          {listQuery.data?.map((row) => (
            <li key={row.id}>
              <button type="button" className="w-full rounded-xl border border-border bg-card p-4 text-left hover:bg-muted/30" onClick={() => { setSelected(row); setReason(''); setReasonError(null) }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{t(`inventory.txType.${row.type}`)}</p>
                  <span className="text-sm font-medium text-accent">{t('inventory.review')}</span>
                </div>
                <p className="mt-1 text-sm">
                  {locationName(row.locationId)} · {row.productName || '—'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('inventory.businessDate')} {formatBusinessDate(row.businessDate, i18n.language)}
                  {' · '}
                  {usersQuery.data?.get(row.createdBy) ?? t('inventory.staffMember')}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !approveMutation.isPending && !rejectMutation.isPending) setSelected(null) }}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{t(`inventory.txType.${selected.type}`)}</DialogTitle>
                <DialogDescription>{t('inventory.approvalEffect')}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">{t('inventory.location')}</dt><dd className="font-medium">{locationName(selected.locationId)}</dd></div>
                <div><dt className="text-muted-foreground">{t('inventory.product')}</dt><dd className="font-medium">{selected.productName || '—'}</dd></div>
                <div><dt className="text-muted-foreground">{t('inventory.businessDate')}</dt><dd>{formatBusinessDate(selected.businessDate, i18n.language)}</dd></div>
                <div><dt className="text-muted-foreground">{t('inventory.submittedOn')}</dt><dd>{selected.createdAtMs ? formatBusinessDate(new Date(selected.createdAtMs).toISOString().slice(0, 10), i18n.language) : '—'}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">{t('inventory.createdBy')}</dt><dd>{usersQuery.data?.get(selected.createdBy) ?? t('inventory.staffMember')}</dd></div>
                <div><dt className="text-muted-foreground">{t('inventory.filled')}</dt><dd className="font-semibold tabular-nums">{payloadNumber(payload, 'filledQuantity') ?? payloadNumber(payload, 'actualFilled') ?? (payload?.state === 'filled' ? payloadNumber(payload, 'quantity') : selected.quantities.filledIssued)}</dd></div>
                <div><dt className="text-muted-foreground">{t('inventory.empty')}</dt><dd className="font-semibold tabular-nums">{payloadNumber(payload, 'emptyQuantity') ?? payloadNumber(payload, 'actualEmpty') ?? (payload?.state === 'empty' ? payloadNumber(payload, 'quantity') : selected.quantities.emptyReceived)}</dd></div>
                <div><dt className="text-muted-foreground">{t('inventory.damaged')}</dt><dd className="font-semibold tabular-nums">{payloadNumber(payload, 'damagedQuantity') ?? payloadNumber(payload, 'actualDamaged') ?? (payload?.state === 'damaged' ? payloadNumber(payload, 'quantity') : 0)}</dd></div>
                {typeof payload?.destinationLocationId === 'string' ? (
                  <div><dt className="text-muted-foreground">{t('inventory.destination')}</dt><dd>{locationName(payload.destinationLocationId)}</dd></div>
                ) : null}
                {selected.note ? <div className="col-span-2"><dt className="text-muted-foreground">{t('inventory.note')}</dt><dd>{selected.note}</dd></div> : null}
              </dl>
              <div className="mt-4 space-y-3">
                <Button type="button" variant="accent" className="w-full" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate({ transactionId: selected.id })}>
                  {t('inventory.approve')}
                </Button>
                <FormField label={t('inventory.rejectReason')} error={reasonError ?? undefined}>
                  <Input value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(null) }} />
                </FormField>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  disabled={rejectMutation.isPending}
                  onClick={() => {
                    if (reason.trim().length < 3) {
                      setReasonError(t('inventory.reasonRequired'))
                      return
                    }
                    rejectMutation.mutate({ transactionId: selected.id, reason: reason.trim() })
                  }}
                >
                  {t('inventory.reject')}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
