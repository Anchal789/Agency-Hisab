import type { ReactNode } from 'react'

export function ErrorState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center" role="alert">
      <h2 className="text-base font-semibold text-destructive">{title}</h2>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-red-900/80">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
