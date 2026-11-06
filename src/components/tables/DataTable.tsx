import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type DataColumn<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
}

export function DataTable<T>({ data, columns, rowKey }: { data: T[]; columns: Array<DataColumn<T>>; rowKey: (row: T) => string }) {
  const { t } = useTranslation()

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-muted/70 text-left text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            {columns.map((column) => (
              <th key={column.id} className="px-3 py-2.5 font-semibold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                {t('table.empty')}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr key={rowKey(row)} className="border-t border-border">
                {columns.map((column) => (
                  <td key={column.id} className="px-3 py-3 align-middle">
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
