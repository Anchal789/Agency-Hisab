import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/cn'

export const Sheet = DialogPrimitive.Root

export function SheetContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  const { t } = useTranslation()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40" />
      <DialogPrimitive.Content
        className={cn('fixed inset-y-0 left-0 z-50 flex w-[min(100%,20rem)] flex-col bg-sidebar text-sidebar-foreground shadow-xl', className)}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{t('nav.menu')}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 rounded-md p-2 text-sidebar-muted hover:bg-white/10" aria-label={t('common.close')}>
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
