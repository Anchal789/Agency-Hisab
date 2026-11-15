import { useQuery } from '@tanstack/react-query'
import { Boxes, ClipboardList, IndianRupee, Receipt, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { businessDateInTimeZone, formatBusinessDate } from '@shared/calculations/business-date'
import { summarizeBalancesByState } from '@shared/models/inventory'
import { canViewInventory } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { SummaryCard } from '@/components/common/SummaryCard'
import { fetchInventoryBalances, fetchInventoryOpenings } from '@/modules/inventory/inventory-query'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const { role, profile } = useAuth()
  const businessDate = formatBusinessDate(businessDateInTimeZone(new Date()), i18n.language)
  const canReadInventory = Boolean(role && profile && canViewInventory(role, profile.permissions))

  const inventoryQuery = useQuery({
    queryKey: ['dashboard', 'inventory-filled'],
    queryFn: async () => {
      const [balances, openings] = await Promise.all([fetchInventoryBalances(), fetchInventoryOpenings()])
      return { balances, openings }
    },
    enabled: canReadInventory,
  })

  const filledStock =
    canReadInventory && inventoryQuery.data
      ? inventoryQuery.data.openings.length > 0
        ? String(summarizeBalancesByState(inventoryQuery.data.balances).filled)
        : null
      : null

  return (
    <PageContainer>
      <PageHeader title={t('dashboard.title')} description={t('dashboard.subtitle', { date: businessDate })} />
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">{t('dashboard.intro')}</p>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-metrics">
        <SummaryCard title={t('summary.todaySales')} icon={<IndianRupee className="h-4 w-4" />} unavailable />
        <SummaryCard title={t('summary.collections')} icon={<Wallet className="h-4 w-4" />} unavailable />
        <SummaryCard title={t('summary.customerDues')} icon={<Receipt className="h-4 w-4" />} unavailable />
        <SummaryCard title={t('summary.emptyCylinders')} icon={<Boxes className="h-4 w-4" />} unavailable />
        <SummaryCard title={t('summary.pendingApprovals')} icon={<ClipboardList className="h-4 w-4" />} unavailable />
        {canReadInventory && filledStock !== null ? (
          <SummaryCard
            title={t('summary.filledStock')}
            icon={<Boxes className="h-4 w-4" />}
            value={filledStock}
            hint={t('inventory.subtitle')}
          />
        ) : (
          <SummaryCard title={t('summary.filledStock')} icon={<Boxes className="h-4 w-4" />} unavailable />
        )}
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <EmptyState title={t('dashboard.recentTitle')} description={t('dashboard.recentBody')} />
        <EmptyState title={t('dashboard.approvalsTitle')} description={t('dashboard.approvalsBody')} />
      </section>
    </PageContainer>
  )
}
