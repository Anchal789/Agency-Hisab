import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-7', className)}>{children}</div>
}
