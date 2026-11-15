import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageHeader } from '@/components/common/PageHeader'
import { SummaryCard } from '@/components/common/SummaryCard'
import { FormField } from '@/components/forms/FormField'
import { Input } from '@/components/ui/input'
import { StockFigure } from './InventoryWidgets'
import { todayBusinessDate } from './InventoryFormShared'
import {
  fetchInventoryBalances,
  fetchInventoryLedger,
  fetchInventoryMasterData,
  fetchInventoryOpenings,
} from './inventory-query'
import { buildLocationStock, groupLedgerLines, sumRecorded } from './inventory-stock'

export function InventoryReportsPage() {
  const { t } = useTranslation()
  const [businessDate, setBusinessDate] = useState(todayBusinessDate())
  const masterQuery = useQuery({ queryKey: ['inventory-master'], queryFn: fetchInventoryMasterData })
  const balancesQuery = useQuery({ queryKey: ['inventory-balances'], queryFn: fetchInventoryBalances })
  const openingsQuery = useQuery({ queryKey: ['inventory-openings'], queryFn: fetchInventoryOpenings })
  const ledgerQuery = useQuery({
    queryKey: ['inventory-ledger', businessDate],
    queryFn: () => fetchInventoryLedger({ businessDate }),
  })

  const stock = useMemo(
    () =>
      buildLocationStock(
        masterQuery.data?.locations ?? [],
        masterQuery.data?.products ?? [],
        balancesQuery.data ?? [],
        openingsQuery.data ?? [],
      ),
    [masterQuery.data, balancesQuery.data, openingsQuery.data],
  )
  const movements = useMemo(() => groupLedgerLines(ledgerQuery.data ?? []), [ledgerQuery.data])
  const transfers = movements.filter((row) => row.movementType === 'transfer_in' || row.movementType === 'transfer_out').length
  const adjustments = movements.filter((row) => row.movementType === 'adjustment').length
  const receipts = movements.filter((row) => row.movementType === 'distributor_receipt').length

  if (masterQuery.isLoading || balancesQuery.isLoading || openingsQuery.isLoading) return <LoadingState />
  if (masterQuery.isError) return <ErrorState title={t('errors.generic')} />

  const filled = sumRecorded(stock, 'filled')
  const empty = sumRecorded(stock, 'empty')

  return (
    <div>
      <PageHeader title={t('inventory.navReports')} description={t('inventory.reportsBody')} />
      <div className="mb-4 max-w-xs">
        <FormField label={t('inventory.businessDate')}>
          <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title={t('inventory.filledCylinders')} value={filled === null ? t('inventory.notRecordedShort') : String(filled)} />
        <SummaryCard title={t('inventory.emptyCylinders')} value={empty === null ? t('inventory.notRecordedShort') : String(empty)} />
        <SummaryCard title={t('inventory.receiptsOnDate')} value={ledgerQuery.isLoading ? '…' : String(receipts)} />
        <SummaryCard title={t('inventory.transfersOnDate')} value={ledgerQuery.isLoading ? '…' : String(transfers)} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t('inventory.adjustmentsOnDate', { count: adjustments })} {t('inventory.reportsHint')}
      </p>
      <div className="mt-5 space-y-3 md:hidden">
        {stock.map((row) => (
          <article key={row.location.id} className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">{row.location.name}</h2>
            <p className="text-sm">{t('inventory.filled')} <StockFigure value={row.filled} missingLabel={t('inventory.notRecordedShort')} /></p>
            <p className="text-sm">{t('inventory.empty')} <StockFigure value={row.empty} missingLabel={t('inventory.notRecordedShort')} /></p>
            <p className="text-sm">{t('inventory.damaged')} <StockFigure value={row.damaged} missingLabel={t('inventory.notRecordedShort')} /></p>
          </article>
        ))}
      </div>
      <div className="mt-5 hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">{t('inventory.location')}</th>
              <th className="px-4 py-3 font-medium">{t('inventory.kindLabel')}</th>
              <th className="px-4 py-3 font-medium">{t('inventory.filled')}</th>
              <th className="px-4 py-3 font-medium">{t('inventory.empty')}</th>
              <th className="px-4 py-3 font-medium">{t('inventory.damaged')}</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((row) => (
              <tr key={row.location.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{row.location.name}</td>
                <td className="px-4 py-3">{t(`inventory.kind.${row.location.kind}`)}</td>
                <td className="px-4 py-3"><StockFigure value={row.filled} missingLabel={t('inventory.notRecordedShort')} /></td>
                <td className="px-4 py-3"><StockFigure value={row.empty} missingLabel={t('inventory.notRecordedShort')} /></td>
                <td className="px-4 py-3"><StockFigure value={row.damaged} missingLabel={t('inventory.notRecordedShort')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
