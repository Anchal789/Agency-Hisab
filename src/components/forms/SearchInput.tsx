import { Search } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { cn } from '@/utils/cn'

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation()
  return (
    <label className="relative block min-w-[12rem] flex-1">
      <span className="sr-only">{t('common.search')}</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        {...props}
        type="search"
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder ?? t('common.search')}
        className={cn('pl-9', className)}
        autoComplete="off"
        data-testid="users-search"
      />
    </label>
  )
}
