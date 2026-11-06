import { cn } from '@/utils/cn'

const tones = {
  success: 'bg-emerald-50 text-success',
  warning: 'bg-amber-50 text-warning',
  danger: 'bg-red-50 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-sky-50 text-sky-800',
} as const

export function StatusBadge({ children, tone = 'neutral' }: { children: string; tone?: keyof typeof tones }) {
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone])}>{children}</span>
}
