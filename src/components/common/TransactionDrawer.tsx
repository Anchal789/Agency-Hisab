import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function TransactionDrawer({
  open,
  title,
  children,
  onOpenChange,
}: {
  open: boolean
  title?: string
  children: ReactNode
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100%-1.5rem,28rem)]">
        <DialogHeader>
          <DialogTitle>{title ?? t('transaction.details')}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
