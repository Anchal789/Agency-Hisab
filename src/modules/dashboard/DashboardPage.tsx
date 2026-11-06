import { Boxes, ClipboardList, IndianRupee, Receipt, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { businessDateInTimeZone, formatBusinessDate } from '@shared/calculations/business-date'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { SummaryCard } from '@/components/common/SummaryCard'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const businessDate = formatBusinessDate(businessDateInTimeZone(new Date()), i18n.language)

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
        <SummaryCard title={t('summary.filledStock')} icon={<Boxes className="h-4 w-4" />} unavailable />
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <EmptyState title={t('dashboard.recentTitle')} description={t('dashboard.recentBody')} />
        <EmptyState title={t('dashboard.approvalsTitle')} description={t('dashboard.approvalsBody')} />
      </section>
    </PageContainer>
  )
}
