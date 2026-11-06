import type { InputHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground shadow-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground md:text-sm',
        'hover:border-primary/35 hover:bg-muted/30',
        'focus-visible:border-ring focus-visible:bg-card focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_28%,transparent)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}
