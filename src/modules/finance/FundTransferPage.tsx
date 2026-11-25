import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatPaise, MoneyFormatError, rupeesToPaise } from '@shared/models/money'
import { canCreateFundTransfer } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { callableErrorMessage } from '@/services/errors'
import { createFundTransfer, getMainHisabDashboard } from '@/services/api/finance-hisab'

function newId(): string {
  return crypto.randomUUID()
}

export function FundTransferPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.language === 'hi' ? 'hi' : 'en'
  const { role, profile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  const allowed = Boolean(role && profile && canCreateFundTransfer(role, profile.permissions))

  const dashboardQuery = useQuery({
    queryKey: ['main-hisab-dashboard', 'transfer'],
    queryFn: () => getMainHisabDashboard(),
    enabled: allowed,
  })

  const transferable = useMemo(
    () =>
      (dashboardQuery.data?.destinations ?? []).filter(
        (row) => row.active && row.ownership !== 'portal',
      ),
    [dashboardQuery.data?.destinations],
  )

  const [sourceAccountId, setSourceAccountId] = useState(search.get('from') ?? '')
  const [destinationAccountId, setDestinationAccountId] = useState(search.get('to') ?? '')
  const [amountRupees, setAmountRupees] = useState('')
  const [businessDate, setBusinessDate] = useState(search.get('date') ?? '')
  const [note, setNote] = useState('')

  const minDate = dashboardQuery.data?.financialOpeningDate ?? undefined
  const maxDate = dashboardQuery.data?.today ?? undefined
  const effectiveDate = businessDate || dashboardQuery.data?.businessDate || dashboardQuery.data?.today || ''

  const source = transferable.find((row) => row.accountId === sourceAccountId)

  const mutation = useMutation({
    mutationFn: async () => {
      const amountPaise = rupeesToPaise(amountRupees)
      return createFundTransfer({
        idempotencyKey: newId(),
        transactionId: newId(),
        sourceAccountId,
        destinationAccountId,
        amountPaise,
        businessDate: effectiveDate,
        note: note.trim() || undefined,
      })
    },
    onSuccess: async (result) => {
      toast.success(
        result.reused ? t('fundTransfer.reused') : t('fundTransfer.saved', { amount: formatPaise(result.amountPaise, language) }),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['main-hisab-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['hisab-cashbook'] }),
      ])
      navigate(`/hisab/transfers/${result.transactionId}`)
    },
    onError: (error) => {
      if (error instanceof MoneyFormatError) {
        toast.error(t('fundTransfer.invalidAmount'))
        return
      }
      toast.error(callableErrorMessage(error, t))
    },
  })

  if (!allowed) {
    return (
      <PageContainer>
        <ErrorState title={t('fundTransfer.noPermission')} description={t('fundTransfer.noPermissionBody')} />
      </PageContainer>
    )
  }

  if (dashboardQuery.isLoading) {
    return (
      <PageContainer>
        <LoadingState label={t('common.loading')} />
      </PageContainer>
    )
  }

  if (dashboardQuery.isError || dashboardQuery.data?.needsOpening) {
    return (
      <PageContainer>
        <ErrorState
          title={t('fundTransfer.unavailable')}
          description={
            dashboardQuery.data?.needsOpening
              ? t('mainHisab.notPublishedBody')
              : callableErrorMessage(dashboardQuery.error, t)
          }
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/hisab">{t('mainHisab.backToHisab')}</Link>
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const canSubmit =
    Boolean(sourceAccountId) &&
    Boolean(destinationAccountId) &&
    sourceAccountId !== destinationAccountId &&
    Boolean(effectiveDate) &&
    amountRupees.trim().length > 0 &&
    !mutation.isPending

  return (
    <PageContainer>
      <PageHeader
        title={t('fundTransfer.title')}
        description={t('fundTransfer.description')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/hisab">{t('mainHisab.backToHisab')}</Link>
          </Button>
        }
      />

      <form
        className="mx-auto flex max-w-lg flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit) return
          mutation.mutate()
        }}
      >
        <FormField label={t('fundTransfer.source')}>
          <select
            className="flex h-11 w-full rounded-md border border-border bg-card px-3 text-sm"
            value={sourceAccountId}
            onChange={(event) => setSourceAccountId(event.target.value)}
          >
            <option value="">{t('fundTransfer.selectAccount')}</option>
            {transferable.map((row) => (
              <option key={row.accountId} value={row.accountId}>
                {row.name} ({formatPaise(row.balancePaise, language)})
              </option>
            ))}
          </select>
        </FormField>

        <FormField label={t('fundTransfer.destination')}>
          <select
            className="flex h-11 w-full rounded-md border border-border bg-card px-3 text-sm"
            value={destinationAccountId}
            onChange={(event) => setDestinationAccountId(event.target.value)}
          >
            <option value="">{t('fundTransfer.selectAccount')}</option>
            {transferable
              .filter((row) => row.accountId !== sourceAccountId)
              .map((row) => (
                <option key={row.accountId} value={row.accountId}>
                  {row.name} ({formatPaise(row.balancePaise, language)})
                </option>
              ))}
          </select>
        </FormField>

        <FormField label={t('fundTransfer.amount')}>
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amountRupees}
            onChange={(event) => setAmountRupees(event.target.value)}
          />
          {source ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('fundTransfer.available', { amount: formatPaise(source.balancePaise, language) })}
            </p>
          ) : null}
        </FormField>

        <FormField label={t('mainHisab.businessDate')}>
          <Input
            type="date"
            value={effectiveDate}
            min={minDate}
            max={maxDate}
            onChange={(event) => setBusinessDate(event.target.value)}
          />
        </FormField>

        <FormField label={t('fundTransfer.note')}>
          <Input
            value={note}
            maxLength={500}
            placeholder={t('fundTransfer.notePlaceholder')}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>

        <Button type="submit" disabled={!canSubmit}>
          {mutation.isPending ? t('common.loading') : t('fundTransfer.submit')}
        </Button>
      </form>
    </PageContainer>
  )
}
