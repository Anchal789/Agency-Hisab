import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBusinessDate } from '@shared/calculations/business-date'
import { saleEmptyCylinderBreakdown, type TransactionDoc } from '@shared/models/transaction'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type EmptyReturnFormValues = {
  emptyReturned: string
  businessDate: string
  note: string
}

export function EmptyReturnDialog({
  open,
  sale,
  defaultBusinessDate,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  sale: TransactionDoc | null
  defaultBusinessDate: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: EmptyReturnFormValues) => void
}) {
  const { t, i18n } = useTranslation()
  const [emptyReturned, setEmptyReturned] = useState('1')
  const [businessDate, setBusinessDate] = useState(defaultBusinessDate)
  const [note, setNote] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const breakdown = sale ? saleEmptyCylinderBreakdown(sale.quantities) : null
  const outstanding = breakdown?.remainingDue ?? 0

  useEffect(() => {
    if (!open) return
    setEmptyReturned(outstanding > 0 ? '1' : '')
    setBusinessDate(defaultBusinessDate)
    setNote('')
    setFieldError(null)
  }, [open, defaultBusinessDate, outstanding, sale?.id])

  function handleOpenChange(next: boolean) {
    if (pending) return
    onOpenChange(next)
  }

  function handleSubmit() {
    if (pending) return
    const qty = Number(emptyReturned)
    if (!Number.isSafeInteger(qty) || qty < 1) {
      setFieldError(t('godown.validation.returnPositive'))
      return
    }
    if (qty > outstanding) {
      setFieldError(t('godown.validation.returnTooHigh', { outstanding }))
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      setFieldError(t('godown.validation.date'))
      return
    }
    setFieldError(null)
    onSubmit({
      emptyReturned: String(qty),
      businessDate,
      note,
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('godown.returnTitle')}</DialogTitle>
          <DialogDescription>
            {t('godown.returnBody', { outstanding })}
          </DialogDescription>
        </DialogHeader>

        {sale && breakdown ? (
          <div className="mb-4 grid gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t('godown.customer')}</p>
              <p className="font-medium">{sale.customerSnapshot.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {sale.customerSnapshot.consumerNumber ?? t('godown.customCustomer')}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.originalSaleDate')}</dt>
                <dd>{formatBusinessDate(sale.businessDate, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.filledIssued')}</dt>
                <dd>{breakdown.filledIssued}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.emptyReceivedAtSale')}</dt>
                <dd>{breakdown.emptyReceivedAtSale}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('godown.originalEmptyDue')}</dt>
                <dd>{breakdown.originalDue}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">{t('godown.remainingEmptyDue')}</dt>
                <dd className="font-medium">{breakdown.remainingDue}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div className="grid gap-3">
          <FormField label={t('godown.emptyReturnedNow')} error={fieldError ?? undefined}>
            <Input
              inputMode="numeric"
              value={emptyReturned}
              disabled={pending}
              onChange={(event) => {
                setEmptyReturned(event.target.value)
                setFieldError(null)
              }}
            />
          </FormField>
          {Number.isSafeInteger(Number(emptyReturned)) && Number(emptyReturned) > 0 && Number(emptyReturned) <= outstanding ? (
            <p className="text-xs text-muted-foreground">
              {t('godown.remainingAfterReturn', {
                remaining: outstanding - Number(emptyReturned),
              })}
            </p>
          ) : null}
          <FormField label={t('godown.returnTransactionDate')}>
            <Input
              type="date"
              value={businessDate}
              disabled={pending}
              onChange={(event) => setBusinessDate(event.target.value)}
            />
          </FormField>
          <FormField label={t('godown.note')}>
            <Input
              value={note}
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={pending || outstanding < 1} onClick={handleSubmit}>
            {pending ? t('common.loading') : t('godown.saveReturn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
