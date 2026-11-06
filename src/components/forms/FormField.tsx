import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/utils/cn'

/** Shared label + control spacing so hover/focus rings never collide with labels. */
export function FormField({
  label,
  htmlFor,
  error,
  children,
  className,
  hint,
  labelAside,
}: {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  labelAside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Label htmlFor={htmlFor} className="leading-5">
          {label}
        </Label>
        {labelAside}
      </div>
      {children}
      {error ? (
        <p className="text-xs leading-4 text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
