import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

/**
 * Shared app content shell.
 * Horizontal padding ≈ 1.25 × vertical padding (`py-5` / `md:py-7`).
 * No max-width so list tables can use the available viewport width.
 */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full px-[calc(1.25rem*1.25)] py-5 md:px-[calc(1.75rem*1.25)] md:py-7', className)}>
      {children}
    </div>
  )
}
