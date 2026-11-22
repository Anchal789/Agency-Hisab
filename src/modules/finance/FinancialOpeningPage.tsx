import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resolveDestinationOwnership } from '@shared/rules/destination-ownership'
import { filledQuantityFromStockReceipt } from '@shared/rules/opening-anchor'
import {
  openingAllowsStagingEdits,
  openingPublishActionPlan,
} from '@shared/rules/opening-session-ui'
import { parseAgencySettings } from '@shared/models/agency-config'
import { formatPaise, MoneyFormatError, rupeesToPaise } from '@shared/models/money'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { PageContainer } from '@/components/common/PageContainer'
import { PageHeader } from '@/components/common/PageHeader'
import { FormField } from '@/components/forms/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getFirebase } from '@/services/firebase/client'
import { callableErrorMessage } from '@/services/errors'
import { fetchPostedStockReceipts } from '@/modules/inventory/inventory-query'
import { useInventoryMasters } from '@/modules/inventory/InventoryFormShared'
import {
  abandonFinancialOpeningSeal,
  beginFinancialOpeningSeal,
  buildOpeningRollup,
  getFinancialOpeningStatus,
  listOpeningReviews,
  markOpeningReady,
  materializeOpeningReceivables,
  planFinancialOpening,
  prepareOpeningChunk,
  publishFinancialOpening,
  saveOpeningBalanceSheet,
  verifyOpeningReceivable,
} from '@/services/api/finance-opening'
import { cn } from '@/utils/cn'

type StepId =
  | 'accounts'
  | 'start'
  | 'balances'
  | 'prepare'
  | 'dues'
  | 'finish'
  | 'done'

type ProgressTone = 'not_started' | 'in_progress' | 'completed' | 'needs_attention'

function newId(): string {
  return crypto.randomUUID()
}

function paiseToRupeeInput(paise: number): string {
  return (paise / 100).toFixed(2)
}

function ProgressPill({ tone, label }: { tone: ProgressTone; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
        tone === 'completed' && 'bg-emerald-100 text-emerald-900',
        tone === 'in_progress' && 'bg-sky-100 text-sky-900',
        tone === 'needs_attention' && 'bg-amber-100 text-amber-950',
        tone === 'not_started' && 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

function CompletedSummary({
  title,
  detail,
  onEdit,
}: {
  title: string
  detail: string
  onEdit?: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
      <div className="flex items-center gap-2">
        <ProgressPill tone="completed" label="Completed" />
        {onEdit ? (
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            Review
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function FinancialOpeningPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.language === 'hi' ? 'hi' : 'en'
  const queryClient = useQueryClient()

  const [sessionId, setSessionId] = useState('')
  const [generationId, setGenerationId] = useState('')
  const [fence, setFence] = useState(1)
  const [openingDate, setOpeningDate] = useState('')
  const [anchorTransactionId, setAnchorTransactionId] = useState('')
  const [receiptSearch, setReceiptSearch] = useState('')
  const [mismatchReason, setMismatchReason] = useState('')
  const [ownerLoanRupees, setOwnerLoanRupees] = useState('')
  const [balanceDraft, setBalanceDraft] = useState<Record<string, string>>({})
  const [savedBalancesPaise, setSavedBalancesPaise] = useState<Record<string, number>>({})
  const [savedOwnerLoanPaise, setSavedOwnerLoanPaise] = useState<number | null>(null)
  const [chunkIds, setChunkIds] = useState<string[]>([])
  const [expectedPreCount, setExpectedPreCount] = useState(0)
  const [recordsPrepared, setRecordsPrepared] = useState(false)
  const [duesMaterialized, setDuesMaterialized] = useState(false)
  const [forceStep, setForceStep] = useState<StepId | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [excludeSaleId, setExcludeSaleId] = useState<string | null>(null)
  const [excludeReason, setExcludeReason] = useState('')
  const [activity, setActivity] = useState<string[]>([])
  const [sessionState, setSessionState] = useState<string>('')
  const hydratedSealRef = useRef<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['finance-opening-status'],
    queryFn: getFinancialOpeningStatus,
  })

  const agencyQuery = useQuery({
    queryKey: ['agency-settings-finance-opening'],
    queryFn: async () => {
      const snap = await getDoc(doc(getFirebase().db, 'settings', 'agency'))
      return parseAgencySettings(snap.data() as Record<string, unknown> | undefined)
    },
  })

  const inventoryMasters = useInventoryMasters()

  const stockReceiptsQuery = useQuery({
    queryKey: ['finance-opening-stock-receipts'],
    queryFn: () => fetchPostedStockReceipts(100),
  })

  const ownership = useMemo(() => {
    if (!agencyQuery.data) return null
    return resolveDestinationOwnership(agencyQuery.data.receivingAccounts)
  }, [agencyQuery.data])

  const ownershipReady = ownership?.ok === true

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of inventoryMasters.data?.locations ?? []) map.set(row.id, row.name)
    return map
  }, [inventoryMasters.data])

  const eligibleReceipts = useMemo(() => {
    return (stockReceiptsQuery.data ?? []).filter((row) => {
      if (row.status !== 'posted' || row.reversedByTransactionId) return false
      return filledQuantityFromStockReceipt(row) >= 1
    })
  }, [stockReceiptsQuery.data])

  const filteredReceipts = useMemo(() => {
    const needle = receiptSearch.trim().toLowerCase()
    if (!needle) return eligibleReceipts
    return eligibleReceipts.filter((row) => {
      const locationName = row.locationId ? locationNameById.get(row.locationId) ?? '' : ''
      const haystack = [
        row.businessDate,
        row.note,
        row.productName,
        locationName,
        row.customerSnapshot.name,
        row.id,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [eligibleReceipts, receiptSearch, locationNameById])

  const selectedReceipt = useMemo(
    () => eligibleReceipts.find((row) => row.id === anchorTransactionId) ?? null,
    [eligibleReceipts, anchorTransactionId],
  )

  const anchorDateMismatch = Boolean(
    selectedReceipt && openingDate && selectedReceipt.businessDate !== openingDate,
  )

  const reviewsQuery = useQuery({
    queryKey: ['opening-reviews', sessionId, generationId],
    enabled: Boolean(sessionId && generationId && recordsPrepared),
    queryFn: () => listOpeningReviews({ sessionId, generationId, limit: 100 }),
  })

  const pendingSalesQuery = useQuery({
    queryKey: ['opening-pending-dues', openingDate, recordsPrepared],
    enabled: Boolean(openingDate && recordsPrepared),
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(getFirebase().db, 'transactions'),
          where('type', '==', 'godown_sale'),
          where('status', '==', 'posted'),
        ),
      )
      return snap.docs
        .map((row) => {
          const data = row.data()
          return {
            id: row.id,
            businessDate: String(data.businessDate ?? ''),
            customerName: String(data.customerSnapshot?.name ?? data.customerName ?? 'Customer'),
            duePaise: Number(data.amountsPaise?.duePaise ?? 0),
            receivedPaise: Number(data.amountsPaise?.receivedPaise ?? 0),
            salePaise: Number(data.amountsPaise?.salePaise ?? 0),
          }
        })
        .filter((row) => row.businessDate && row.businessDate <= openingDate)
        .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
    },
  })

  const reviewedSaleIds = useMemo(() => {
    const set = new Set<string>()
    for (const review of reviewsQuery.data?.reviews ?? []) {
      const saleId = review.sourceSaleId
      if (typeof saleId === 'string') set.add(saleId)
    }
    return set
  }, [reviewsQuery.data])

  const pendingDues = useMemo(
    () => (pendingSalesQuery.data ?? []).filter((row) => !reviewedSaleIds.has(row.id)),
    [pendingSalesQuery.data, reviewedSaleIds],
  )

  const includedReviews = useMemo(
    () => (reviewsQuery.data?.reviews ?? []).filter((row) => row.decision === 'include'),
    [reviewsQuery.data],
  )

  const gateState = String((statusQuery.data?.gate as { state?: string } | undefined)?.state ?? 'not_opened')
  const isPublished =
    gateState === 'published' ||
    Boolean((statusQuery.data?.publication as { publishedSessionId?: string | null } | undefined)?.publishedSessionId)
  const stagingEditable = openingAllowsStagingEdits(sessionState || 'preparing')
  const publishPlan = openingPublishActionPlan(sessionState || 'preparing')

  useEffect(() => {
    const active = statusQuery.data?.activeSession as
      | {
          id?: string
          state?: string
          fence?: number
          generationId?: string | null
          openingDate?: string | null
          anchorTransactionId?: string | null
          anchorDateMismatchReason?: string | null
        }
      | null
      | undefined
    if (gateState !== 'sealing' || !active?.id || !active.generationId) return
    if (hydratedSealRef.current === active.id) {
      if (typeof active.state === 'string') setSessionState(active.state)
      return
    }
    hydratedSealRef.current = active.id
    setSessionId(active.id)
    setGenerationId(active.generationId)
    setFence(Number(active.fence ?? 1))
    setSessionState(String(active.state ?? 'preparing'))
    if (typeof active.openingDate === 'string') setOpeningDate(active.openingDate)
    if (typeof active.anchorTransactionId === 'string') setAnchorTransactionId(active.anchorTransactionId)
    if (typeof active.anchorDateMismatchReason === 'string') {
      setMismatchReason(active.anchorDateMismatchReason)
    }

    const sheet = statusQuery.data?.balanceSheet as
      | {
          amountsPaise?: Record<string, number>
          ownerLoanOutstandingPaise?: number
        }
      | null
      | undefined
    if (sheet?.amountsPaise && Object.keys(sheet.amountsPaise).length > 0) {
      setSavedBalancesPaise(sheet.amountsPaise)
      const draft: Record<string, string> = {}
      for (const [accountId, amount] of Object.entries(sheet.amountsPaise)) {
        draft[accountId] = paiseToRupeeInput(Number(amount) || 0)
      }
      setBalanceDraft(draft)
      setSavedOwnerLoanPaise(Number(sheet.ownerLoanOutstandingPaise ?? 0))
      setOwnerLoanRupees(paiseToRupeeInput(Number(sheet.ownerLoanOutstandingPaise ?? 0)))
    }

    const plan = statusQuery.data?.plan as
      | {
          expectedPreCount?: number
          chunkIds?: string[]
        }
      | null
      | undefined
    if (plan) {
      setRecordsPrepared(true)
      setExpectedPreCount(Number(plan.expectedPreCount ?? 0))
      if (Array.isArray(plan.chunkIds)) setChunkIds(plan.chunkIds.map(String))
    }

    const reviewCount = Number(statusQuery.data?.reviewCount ?? 0)
    const expectedPre = Number(plan?.expectedPreCount ?? 0)
    if (active.state === 'ready_to_publish' || (expectedPre > 0 && reviewCount >= expectedPre)) {
      setDuesMaterialized(true)
    }
    if (active.state === 'ready_to_publish') {
      setRecordsPrepared(true)
      setDuesMaterialized(true)
      setForceStep(null)
    }
  }, [statusQuery.data, gateState])

  const balancesComplete =
    ownership?.ok === true &&
    ownership.matches.every((row) => balanceDraft[row.accountId]?.trim()) &&
    ownerLoanRupees.trim() !== ''

  const currentStep: StepId = (() => {
    if (forceStep && stagingEditable) return forceStep
    if (isPublished) return 'done'
    if (!ownershipReady) return 'accounts'
    if (!sessionId || !generationId) return 'start'
    if (sessionState === 'ready_to_publish') return 'finish'
    if (savedOwnerLoanPaise == null || Object.keys(savedBalancesPaise).length === 0) return 'balances'
    if (!recordsPrepared) return 'prepare'
    if (pendingDues.length > 0 || !duesMaterialized) return 'dues'
    return 'finish'
  })()

  function pushActivity(message: string) {
    setActivity((prev) => [message, ...prev].slice(0, 30))
  }

  function progressLabel(tone: ProgressTone): string {
    if (tone === 'completed') return t('financeOpening.progress.completed')
    if (tone === 'in_progress') return t('financeOpening.progress.inProgress')
    if (tone === 'needs_attention') return t('financeOpening.progress.needsAttention')
    return t('financeOpening.progress.notStarted')
  }

  const refreshAccountsMutation = useMutation({
    mutationFn: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agency-settings-finance-opening'] })
      await queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
    },
    onSuccess: () => {
      toast.success(t('financeOpening.toasts.accountsSaved'))
      pushActivity('Accounts refreshed from Settings')
    },
  })

  const beginMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReceipt || selectedReceipt.id !== anchorTransactionId) {
        throw new Error(t('financeOpening.errors.selectStockReceipt'))
      }
      if (anchorDateMismatch && !mismatchReason.trim()) {
        throw new Error(t('financeOpening.errors.dateMismatchRequired'))
      }
      const id = sessionId || newId()
      return beginFinancialOpeningSeal({
        idempotencyKey: newId(),
        sessionId: id,
        openingDate,
        anchorTransactionId: selectedReceipt.id,
        anchorDateMismatchReason: mismatchReason.trim() ? mismatchReason.trim() : null,
      })
    },
    onSuccess: (result) => {
      setSessionId(result.sessionId)
      if (result.generationId) setGenerationId(result.generationId)
      setFence(1)
      setSessionState('preparing')
      hydratedSealRef.current = result.sessionId
      toast.success(t('financeOpening.toasts.setupStarted'))
      pushActivity('Setup started')
      setForceStep(null)
      void queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  const saveSheetMutation = useMutation({
    mutationFn: async () => {
      if (!stagingEditable) {
        throw new Error(t('financeOpening.errors.readyLocked'))
      }
      if (!ownership?.ok) throw new Error(t('financeOpening.errors.accountsNotReady'))
      const missing = ownership.matches.filter((row) => !balanceDraft[row.accountId]?.trim())
      if (missing.length > 0 || !ownerLoanRupees.trim()) {
        throw new Error(t('financeOpening.errors.enterAllAmounts'))
      }
      const balances = ownership.matches.map((row) => ({
        accountId: row.accountId,
        amountPaise: rupeesToPaise(balanceDraft[row.accountId]!.trim()),
      }))
      const ownerLoanOutstandingPaise = rupeesToPaise(ownerLoanRupees.trim())
      await saveOpeningBalanceSheet({
        idempotencyKey: newId(),
        sessionId,
        fence,
        generationId,
        balances,
        ownerLoanOutstandingPaise,
        ownerLoanVerified: true,
      })
      return { balances, ownerLoanOutstandingPaise }
    },
    onSuccess: (result) => {
      const map: Record<string, number> = {}
      for (const row of result.balances) map[row.accountId] = row.amountPaise
      setSavedBalancesPaise(map)
      setSavedOwnerLoanPaise(result.ownerLoanOutstandingPaise)
      toast.success(t('financeOpening.toasts.balancesSaved'))
      pushActivity('Balances saved')
      setForceStep(null)
      void queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
    },
    onError: (error) => {
      if (error instanceof MoneyFormatError) toast.error(error.message)
      else toast.error(callableErrorMessage(error, t))
    },
  })

  const prepareMutation = useMutation({
    mutationFn: async () => {
      if (!stagingEditable) {
        throw new Error(t('financeOpening.errors.readyLocked'))
      }
      const plan = await planFinancialOpening({
        idempotencyKey: newId(),
        sessionId,
        fence,
        generationId,
      })
      setChunkIds(plan.chunkIds)
      setExpectedPreCount(plan.expectedPreCount)
      for (const chunkId of plan.chunkIds) {
        await prepareOpeningChunk({
          idempotencyKey: newId(),
          sessionId,
          fence,
          generationId,
          chunkId,
        })
      }
      return plan
    },
    onSuccess: (plan) => {
      setRecordsPrepared(true)
      toast.success(t('financeOpening.toasts.recordsPrepared'))
      pushActivity(`Old records prepared (${plan.expectedPreCount} customer sales to check)`)
      setForceStep(null)
      void queryClient.invalidateQueries({ queryKey: ['opening-pending-dues'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  const verifyMutation = useMutation({
    mutationFn: async (input: {
      saleId: string
      decision: 'include' | 'exclude'
      approvedAmountPaise: number
      reason?: string | null
    }) => {
      await verifyOpeningReceivable({
        idempotencyKey: newId(),
        sessionId,
        fence,
        generationId,
        saleId: input.saleId,
        decision: input.decision,
        approvedAmountPaise: input.approvedAmountPaise,
        reason: input.reason ?? null,
      })
    },
    onSuccess: async () => {
      toast.success(t('financeOpening.toasts.dueReviewed'))
      await queryClient.invalidateQueries({ queryKey: ['opening-reviews', sessionId, generationId] })
      setExcludeSaleId(null)
      setExcludeReason('')
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  const materializeMutation = useMutation({
    mutationFn: async () => {
      const reviews = await listOpeningReviews({ sessionId, generationId, limit: 100 })
      const saleIds = reviews.reviews
        .filter((row) => row.decision === 'include' && Number(row.approvedAmountPaise ?? 0) > 0)
        .map((row) => String(row.sourceSaleId))
      for (let i = 0; i < saleIds.length; i += 40) {
        await materializeOpeningReceivables({
          idempotencyKey: newId(),
          sessionId,
          fence,
          generationId,
          saleIds: saleIds.slice(i, i + 40),
        })
      }
      return saleIds.length
    },
    onSuccess: (count) => {
      setDuesMaterialized(true)
      toast.success(t('financeOpening.toasts.duesSaved', { count }))
      pushActivity(`Customer dues saved (${count})`)
      setForceStep(null)
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  const publishMutation = useMutation({
    mutationFn: async () => {
      const plan = openingPublishActionPlan(sessionState || 'preparing')
      if (plan === 'blocked') {
        throw new Error(t('financeOpening.errors.publishBlocked'))
      }
      // Retry after mark-ready: only publish. Do not re-run preparing-only steps.
      if (plan === 'publish_only') {
        return publishFinancialOpening({ idempotencyKey: newId(), sessionId, fence, generationId })
      }
      await buildOpeningRollup({ idempotencyKey: newId(), sessionId, fence, generationId })
      await markOpeningReady({ idempotencyKey: newId(), sessionId, fence, generationId })
      setSessionState('ready_to_publish')
      return publishFinancialOpening({ idempotencyKey: newId(), sessionId, fence, generationId })
    },
    onSuccess: () => {
      setPublishOpen(false)
      setSessionState('published')
      toast.success(t('financeOpening.toasts.published'))
      pushActivity('Setup finished')
      setForceStep(null)
      void queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
      toast.error(callableErrorMessage(error, t))
    },
  })

  const abandonMutation = useMutation({
    mutationFn: async () =>
      abandonFinancialOpeningSeal({
        idempotencyKey: newId(),
        sessionId,
        fence,
        reason: 'Cancelled from starting balances setup',
      }),
    onSuccess: () => {
      setCancelOpen(false)
      hydratedSealRef.current = null
      setSessionId('')
      setGenerationId('')
      setSessionState('')
      setChunkIds([])
      setRecordsPrepared(false)
      setDuesMaterialized(false)
      setSavedBalancesPaise({})
      setSavedOwnerLoanPaise(null)
      toast.success(t('financeOpening.toasts.cancelled'))
      pushActivity('Setup cancelled')
      setForceStep(null)
      void queryClient.invalidateQueries({ queryKey: ['finance-opening-status'] })
    },
    onError: (error) => toast.error(callableErrorMessage(error, t)),
  })

  const configuredDestinations = agencyQuery.data?.receivingAccounts.filter((row) => row.active) ?? []

  return (
    <PageContainer>
      <PageHeader
        title={t('financeOpening.title')}
        description={t('financeOpening.description')}
      />

      <div className="mt-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t('financeOpening.overallStatus')}</span>
          {isPublished ? (
            <ProgressPill tone="completed" label={progressLabel('completed')} />
          ) : gateState === 'sealing' ? (
            <ProgressPill tone="in_progress" label={progressLabel('in_progress')} />
          ) : ownershipReady ? (
            <ProgressPill tone="not_started" label={progressLabel('not_started')} />
          ) : (
            <ProgressPill tone="needs_attention" label={progressLabel('needs_attention')} />
          )}
        </div>

        {/* Completed summaries */}
        <div>
          {ownershipReady && currentStep !== 'accounts' ? (
            <CompletedSummary
              title={t('financeOpening.steps.accounts')}
              detail={t('financeOpening.summaries.accountsReady')}
              onEdit={() => setForceStep('accounts')}
            />
          ) : null}
          {sessionId && generationId && currentStep !== 'start' && currentStep !== 'accounts' ? (
            <CompletedSummary
              title={t('financeOpening.steps.start')}
              detail={t('financeOpening.summaries.started', { date: openingDate })}
              onEdit={() => setForceStep('start')}
            />
          ) : null}
          {savedOwnerLoanPaise != null &&
          Object.keys(savedBalancesPaise).length > 0 &&
          currentStep !== 'balances' &&
          !['accounts', 'start'].includes(currentStep) ? (
            <CompletedSummary
              title={t('financeOpening.steps.balances')}
              detail={t('financeOpening.summaries.balancesSaved')}
              onEdit={stagingEditable ? () => setForceStep('balances') : undefined}
            />
          ) : null}
          {recordsPrepared && !['accounts', 'start', 'balances', 'prepare'].includes(currentStep) ? (
            <CompletedSummary
              title={t('financeOpening.steps.prepare')}
              detail={t('financeOpening.summaries.recordsPrepared')}
              onEdit={stagingEditable ? () => setForceStep('prepare') : undefined}
            />
          ) : null}
          {duesMaterialized && pendingDues.length === 0 && (currentStep === 'finish' || currentStep === 'done') ? (
            <CompletedSummary
              title={t('financeOpening.steps.dues')}
              detail={t('financeOpening.summaries.duesDone', { count: includedReviews.length })}
              onEdit={stagingEditable ? () => setForceStep('dues') : undefined}
            />
          ) : null}
        </div>

        {sessionState === 'ready_to_publish' && !isPublished ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            {t('financeOpening.readyLockedHint')}
          </p>
        ) : null}

        {/* Current / forced step */}
        {currentStep === 'accounts' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('financeOpening.steps.accounts')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('financeOpening.accountsHint')}</p>
            </div>
            {!agencyQuery.data ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : configuredDestinations.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{t('financeOpening.noDestinations')}</p>
                <p className="text-sm">
                  {t('financeOpening.checkSettings')}{' '}
                  <Link className="underline" to="/settings">
                    {t('nav.settings')}
                  </Link>
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {configuredDestinations.map((account) => {
                  const ready = Boolean(account.ownership)
                  return (
                    <li
                      key={account.id}
                      className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-3"
                    >
                      <div>
                        <p className="font-medium">{account.name}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {ready
                            ? t(`settings.ownership.${account.ownership}`)
                            : t('financeOpening.ownershipMissing')}
                        </p>
                      </div>
                      <ProgressPill
                        tone={ready ? 'completed' : 'needs_attention'}
                        label={progressLabel(ready ? 'completed' : 'needs_attention')}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            {!ownershipReady && configuredDestinations.length > 0 ? (
              <p className="text-sm">
                {t('financeOpening.checkSettings')}{' '}
                <Link className="underline" to="/settings">
                  {t('nav.settings')}
                </Link>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={refreshAccountsMutation.isPending}
                onClick={() => refreshAccountsMutation.mutate()}
              >
                {t('financeOpening.actions.refreshAccounts')}
              </Button>
              {ownershipReady ? (
                <Button onClick={() => setForceStep('start')}>
                  {t('financeOpening.actions.continue')}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {currentStep === 'start' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('financeOpening.steps.start')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('financeOpening.startHint')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={t('financeOpening.fields.startingDate')} htmlFor="openingDate">
                <Input
                  id="openingDate"
                  type="date"
                  value={openingDate}
                  onChange={(e) => setOpeningDate(e.target.value)}
                />
              </FormField>
              <FormField
                className="md:col-span-2"
                label={t('financeOpening.fields.stockReceipt')}
                htmlFor="receiptSearch"
                hint={t('financeOpening.fields.stockReceiptHint')}
              >
                <Input
                  id="receiptSearch"
                  value={receiptSearch}
                  onChange={(e) => setReceiptSearch(e.target.value)}
                  placeholder={t('financeOpening.fields.stockReceiptSearch')}
                />
              </FormField>
            </div>
            {stockReceiptsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : eligibleReceipts.length === 0 ? (
              <p className="text-sm text-destructive">{t('financeOpening.noStockReceipts')}</p>
            ) : filteredReceipts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('financeOpening.noStockReceiptsMatch')}</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                {filteredReceipts.map((row) => {
                  const filled = filledQuantityFromStockReceipt(row)
                  const locationName = row.locationId
                    ? locationNameById.get(row.locationId) ?? row.locationId
                    : t('financeOpening.fields.unknownLocation')
                  const reference = row.note.trim() || t('financeOpening.fields.noReceiptReference')
                  const selected = anchorTransactionId === row.id
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={cn(
                          'w-full rounded-md border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent hover:border-border hover:bg-muted/40',
                        )}
                        onClick={() => setAnchorTransactionId(row.id)}
                      >
                        <p className="font-medium">
                          {row.businessDate} · {reference}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {locationName} · {row.productName} · {t('financeOpening.fields.filledQty', { count: filled })}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('financeOpening.fields.transactionId')}: {row.id}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {selectedReceipt ? (
              <p className="text-sm text-muted-foreground">
                {t('financeOpening.fields.selectedReceipt', {
                  date: selectedReceipt.businessDate,
                  reference: selectedReceipt.note.trim() || t('financeOpening.fields.noReceiptReference'),
                })}
              </p>
            ) : null}
            {anchorDateMismatch ? (
              <FormField
                label={t('financeOpening.fields.dateMismatchReason')}
                htmlFor="mismatch"
                hint={t('financeOpening.fields.dateMismatchHint')}
              >
                <Input
                  id="mismatch"
                  value={mismatchReason}
                  onChange={(e) => setMismatchReason(e.target.value)}
                />
              </FormField>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  beginMutation.isPending ||
                  !openingDate ||
                  !selectedReceipt ||
                  (anchorDateMismatch && !mismatchReason.trim())
                }
                onClick={() => beginMutation.mutate()}
              >
                {t('financeOpening.actions.startSetup')}
              </Button>
              {sessionId ? (
                <Button variant="secondary" onClick={() => setForceStep('balances')}>
                  {t('financeOpening.actions.continue')}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {currentStep === 'balances' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('financeOpening.steps.balances')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('financeOpening.balancesHint')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {ownership?.ok
                ? ownership.matches.map((row) => (
                    <FormField
                      key={row.accountId}
                      label={row.accountName}
                      htmlFor={`bal-${row.accountId}`}
                      hint={t(`settings.ownership.${row.ownership}`)}
                    >
                      <Input
                        id={`bal-${row.accountId}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={balanceDraft[row.accountId] ?? ''}
                        onChange={(e) =>
                          setBalanceDraft((prev) => ({ ...prev, [row.accountId]: e.target.value }))
                        }
                      />
                    </FormField>
                  ))
                : null}
            </div>
            <FormField
              label={t('financeOpening.fields.ownerLoan')}
              htmlFor="ownerLoan"
              hint={t('financeOpening.fields.ownerLoanHint')}
            >
              <Input
                id="ownerLoan"
                inputMode="decimal"
                placeholder="0.00"
                value={ownerLoanRupees}
                onChange={(e) => setOwnerLoanRupees(e.target.value)}
              />
            </FormField>
            <Button
              disabled={
                !sessionId ||
                !generationId ||
                !balancesComplete ||
                !stagingEditable ||
                saveSheetMutation.isPending
              }
              onClick={() => saveSheetMutation.mutate()}
            >
              {t('financeOpening.actions.saveBalances')}
            </Button>
            {!stagingEditable ? (
              <p className="text-sm text-destructive">{t('financeOpening.errors.readyLocked')}</p>
            ) : null}
          </section>
        ) : null}

        {currentStep === 'prepare' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('financeOpening.steps.prepare')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('financeOpening.prepareHint')}</p>
            </div>
            <ProgressPill
              tone={recordsPrepared ? 'completed' : prepareMutation.isPending ? 'in_progress' : 'not_started'}
              label={progressLabel(
                recordsPrepared ? 'completed' : prepareMutation.isPending ? 'in_progress' : 'not_started',
              )}
            />
            <Button
              disabled={!sessionId || !stagingEditable || prepareMutation.isPending}
              onClick={() => prepareMutation.mutate()}
            >
              {prepareMutation.isPending
                ? t('financeOpening.actions.preparing')
                : t('financeOpening.actions.prepareRecords')}
            </Button>
            {recordsPrepared ? (
              <Button variant="secondary" onClick={() => setForceStep('dues')}>
                {t('financeOpening.actions.continue')}
              </Button>
            ) : null}
          </section>
        ) : null}

        {currentStep === 'dues' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('financeOpening.steps.dues')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('financeOpening.duesHint')}</p>
            </div>
            <p className="text-sm">
              {pendingDues.length > 0
                ? t('financeOpening.duesPending', { count: pendingDues.length })
                : t('financeOpening.duesNonePending')}
              {expectedPreCount > 0 ? (
                <span className="text-muted-foreground">
                  {' '}
                  ({t('financeOpening.duesReviewed', { count: reviewedSaleIds.size })})
                </span>
              ) : null}
            </p>
            <ul className="divide-y divide-border border-y border-border">
              {pendingDues.slice(0, 40).map((sale) => (
                <li key={sale.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{sale.customerName}</p>
                    <p className="text-sm text-muted-foreground">
                      {sale.businessDate} · {t('financeOpening.dueAmount')}:{' '}
                      {formatPaise(sale.duePaise, language)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={verifyMutation.isPending}
                      onClick={() =>
                        verifyMutation.mutate({
                          saleId: sale.id,
                          decision: 'include',
                          approvedAmountPaise: sale.duePaise,
                          reason: sale.duePaise === 0 ? null : 'Verified starting due',
                        })
                      }
                    >
                      {t('financeOpening.actions.carryForward')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={verifyMutation.isPending}
                      onClick={() => {
                        setExcludeSaleId(sale.id)
                        setExcludeReason('')
                      }}
                    >
                      {t('financeOpening.actions.doNotCarry')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {pendingDues.length > 40 ? (
              <p className="text-sm text-muted-foreground">
                {t('financeOpening.duesMore', { count: pendingDues.length - 40 })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pendingDues.length > 0 || materializeMutation.isPending}
                onClick={() => materializeMutation.mutate()}
              >
                {t('financeOpening.actions.saveDues')}
              </Button>
              {duesMaterialized && pendingDues.length === 0 ? (
                <Button variant="secondary" onClick={() => setForceStep('finish')}>
                  {t('financeOpening.actions.continue')}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {currentStep === 'finish' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t('financeOpening.steps.finish')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('financeOpening.finishHint')}</p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('financeOpening.fields.startingDate')}</dt>
                <dd className="font-medium">{openingDate || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('financeOpening.fields.ownerLoan')}</dt>
                <dd className="font-medium">
                  {savedOwnerLoanPaise == null ? '—' : formatPaise(savedOwnerLoanPaise, language)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t('financeOpening.confirm.accountBalances')}</dt>
                <dd className="mt-2 space-y-1">
                  {ownership?.ok
                    ? ownership.matches.map((row) => (
                        <div key={row.accountId} className="flex justify-between gap-3">
                          <span>{row.accountName}</span>
                          <span className="font-medium">
                            {formatPaise(savedBalancesPaise[row.accountId] ?? 0, language)}
                          </span>
                        </div>
                      ))
                    : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('financeOpening.confirm.duesIncluded')}</dt>
                <dd className="font-medium">{includedReviews.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('financeOpening.confirm.unresolved')}</dt>
                <dd className="font-medium">
                  {pendingDues.length > 0
                    ? t('financeOpening.duesPending', { count: pendingDues.length })
                    : t('financeOpening.confirm.none')}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  publishMutation.isPending ||
                  publishPlan === 'blocked' ||
                  (sessionState !== 'ready_to_publish' && (pendingDues.length > 0 || !duesMaterialized))
                }
                onClick={() => setPublishOpen(true)}
              >
                {sessionState === 'ready_to_publish'
                  ? t('financeOpening.actions.finishSetup')
                  : t('financeOpening.actions.finishSetup')}
              </Button>
              <Button variant="outline" disabled={!sessionId || abandonMutation.isPending} onClick={() => setCancelOpen(true)}>
                {t('financeOpening.actions.cancelSetup')}
              </Button>
            </div>
          </section>
        ) : null}

        {currentStep === 'done' ? (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t('financeOpening.doneTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('financeOpening.doneBody')}</p>
            <ProgressPill tone="completed" label={progressLabel('completed')} />
          </section>
        ) : null}

        {sessionId && currentStep !== 'done' && currentStep !== 'finish' ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
              {t('financeOpening.actions.cancelSetup')}
            </Button>
          </div>
        ) : null}

        <div className="border-t border-border pt-4">
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setShowDiagnostics((value) => !value)}
          >
            {showDiagnostics ? t('financeOpening.hideDiagnostics') : t('financeOpening.showDiagnostics')}
          </button>
          {showDiagnostics ? (
            <div className="mt-3 space-y-2 font-mono text-xs text-muted-foreground">
              <p>session={sessionId || '—'} fence={fence}</p>
              <p>chunks={chunkIds.length} preExpected={expectedPreCount}</p>
              <ul className="max-h-40 space-y-1 overflow-auto">
                {activity.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmationDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={t('financeOpening.confirm.publishTitle')}
        description={t('financeOpening.confirm.publishBody')}
        confirmLabel={t('financeOpening.actions.confirmPublish')}
        pending={publishMutation.isPending}
        onConfirm={() => publishMutation.mutate()}
      >
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt>{t('financeOpening.fields.startingDate')}</dt>
            <dd className="font-medium">{openingDate}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t('financeOpening.fields.ownerLoan')}</dt>
            <dd className="font-medium">
              {savedOwnerLoanPaise == null ? '—' : formatPaise(savedOwnerLoanPaise, language)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>{t('financeOpening.confirm.duesIncluded')}</dt>
            <dd className="font-medium">{includedReviews.length}</dd>
          </div>
        </dl>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('financeOpening.confirm.cancelTitle')}
        description={t('financeOpening.confirm.cancelBody')}
        confirmLabel={t('financeOpening.actions.cancelSetup')}
        destructive
        pending={abandonMutation.isPending}
        onConfirm={() => abandonMutation.mutate()}
      />

      <ConfirmationDialog
        open={Boolean(excludeSaleId)}
        onOpenChange={(open) => {
          if (!open) {
            setExcludeSaleId(null)
            setExcludeReason('')
          }
        }}
        title={t('financeOpening.confirm.excludeTitle')}
        description={t('financeOpening.confirm.excludeBody')}
        confirmLabel={t('financeOpening.actions.doNotCarry')}
        destructive
        pending={verifyMutation.isPending}
        onConfirm={() => {
          if (!excludeSaleId || excludeReason.trim().length < 3) {
            toast.error(t('financeOpening.errors.excludeReason'))
            return
          }
          verifyMutation.mutate({
            saleId: excludeSaleId,
            decision: 'exclude',
            approvedAmountPaise: 0,
            reason: excludeReason.trim(),
          })
        }}
      >
        <FormField label={t('financeOpening.fields.excludeReason')} htmlFor="excludeReason">
          <Input
            id="excludeReason"
            value={excludeReason}
            onChange={(e) => setExcludeReason(e.target.value)}
          />
        </FormField>
      </ConfirmationDialog>
    </PageContainer>
  )
}
