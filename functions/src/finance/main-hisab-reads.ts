import { getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { parseAgencySettings, type ReceivingAccount } from '../../../shared/models/agency-config'
import {
  getMainHisabDashboardSchema,
  listHisabCashbookSchema,
  listHisabDayLedgerSchema,
} from '../../../shared/schemas/finance-hisab'
import {
  resolveHisabBusinessDate,
  todayHisabBusinessDate,
  validateHisabBusinessDate,
} from '../../../shared/rules/hisab-date'
import { requirePermission } from '../auth/permission-guards'
import { getGateState, getPublicationPointer } from './opening-context'

function firstZodMessage(error: { issues: Array<{ message?: string }> }): string {
  return error.issues[0]?.message || 'Invalid request.'
}

function accountMeta(accounts: ReceivingAccount[], accountId: string) {
  const row = accounts.find((item) => item.id === accountId)
  return {
    name: row?.name ?? accountId,
    kind: row?.kind ?? null,
    ownership: row?.ownership ?? null,
    active: row?.active !== false,
  }
}

function serializeLedgerDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    accountId: String(data.accountId ?? ''),
    amountPaise: Number(data.amountPaise ?? 0),
    direction: data.direction === 'debit' ? 'debit' : 'credit',
    entryClass: String(data.entryClass ?? ''),
    businessDate: typeof data.businessDate === 'string' ? data.businessDate : null,
    recordScope: data.recordScope === 'opening' ? 'opening' : 'operational',
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : null,
    relatedCustomerId: typeof data.relatedCustomerId === 'string' ? data.relatedCustomerId : null,
    openingSessionId: typeof data.openingSessionId === 'string' ? data.openingSessionId : null,
    openingGenerationId: typeof data.openingGenerationId === 'string' ? data.openingGenerationId : null,
    createdAt: data.createdAt ?? null,
  }
}

/** Stage 5F.1 — Main Hisab dashboard (balances + day context). Read-only. */
export const getMainHisabDashboard = functions.region('asia-south1').https.onCall(async (data, context) => {
  await requirePermission(context, 'finance.viewBalances')
  const parsed = getMainHisabDashboardSchema.safeParse(data ?? {})
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }

  const db = getFirestore()
  const [gate, publication, agencySnap] = await Promise.all([
    getGateState(),
    getPublicationPointer(),
    db.collection('settings').doc('agency').get(),
  ])
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const today = todayHisabBusinessDate()
  const financialOpeningDate = agency.financialOpeningDate

  if (gate.state !== 'published' || !publication.publishedSessionId || !publication.publishedGenerationId) {
    return {
      gate,
      publication,
      published: false,
      today,
      financialOpeningDate,
      businessDate: today,
      destinations: [] as unknown[],
      dayActivity: [] as unknown[],
      ownerLoanOutstandingPaise: agency.ownerLoanOutstandingPaise,
      needsOpening: true,
    }
  }

  if (!financialOpeningDate) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening date is missing.')
  }

  const businessDate = resolveHisabBusinessDate({
    selected: parsed.data.businessDate,
    financialOpeningDate,
    today,
  })
  if (parsed.data.businessDate) {
    const check = validateHisabBusinessDate({
      selected: parsed.data.businessDate,
      financialOpeningDate,
      today,
    })
    if (!check.ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        check.code === 'future'
          ? 'Business date cannot be in the future.'
          : check.code === 'before_opening'
            ? 'Business date cannot be before the financial opening date.'
            : 'Invalid business date.',
      )
    }
  }

  const bals = await db
    .collection('financialBalances')
    .where('publishedSessionId', '==', publication.publishedSessionId)
    .where('publishedGenerationId', '==', publication.publishedGenerationId)
    .get()

  const configuredIds = new Set(
    agency.receivingAccounts.filter((row) => row.active !== false).map((row) => row.id),
  )
  const destinations = bals.docs
    .filter((doc) => configuredIds.has(doc.id))
    .map((doc) => {
      const data = doc.data()
      const meta = accountMeta(agency.receivingAccounts, doc.id)
      return {
        accountId: doc.id,
        name: meta.name,
        kind: meta.kind,
        ownership: meta.ownership,
        active: meta.active,
        balancePaise: Number(data.balancePaise ?? 0),
        needsReconciliation: data.needsReconciliation === true,
        reconciliationReason: typeof data.reconciliationReason === 'string' ? data.reconciliationReason : null,
        publishedSessionId: data.publishedSessionId ?? null,
        publishedGenerationId: data.publishedGenerationId ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const daySnap = await db
    .collection('financialLedger')
    .where('recordScope', '==', 'operational')
    .where('businessDate', '==', businessDate)
    .limit(100)
    .get()

  const dayActivity = daySnap.docs
    .map((doc) => serializeLedgerDoc(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => {
      const byAccount = a.accountId.localeCompare(b.accountId)
      if (byAccount !== 0) return byAccount
      return a.id.localeCompare(b.id)
    })

  return {
    gate,
    publication,
    published: true,
    needsOpening: false,
    today,
    financialOpeningDate,
    businessDate,
    destinations,
    dayActivity,
    ownerLoanOutstandingPaise: agency.ownerLoanOutstandingPaise,
  }
})

/** Stage 5F.1 — operational ledger lines for one business date (all destinations). */
export const listHisabDayLedger = functions.region('asia-south1').https.onCall(async (data, context) => {
  await requirePermission(context, 'finance.viewBalances')
  const parsed = listHisabDayLedgerSchema.safeParse(data ?? {})
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }

  const db = getFirestore()
  const [gate, publication, agencySnap] = await Promise.all([
    getGateState(),
    getPublicationPointer(),
    db.collection('settings').doc('agency').get(),
  ])
  if (gate.state !== 'published' || !publication.publishedSessionId) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening is not published.')
  }
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const financialOpeningDate = agency.financialOpeningDate
  if (!financialOpeningDate) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening date is missing.')
  }
  const today = todayHisabBusinessDate()
  const check = validateHisabBusinessDate({
    selected: parsed.data.businessDate,
    financialOpeningDate,
    today,
  })
  if (!check.ok) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      check.code === 'future'
        ? 'Business date cannot be in the future.'
        : check.code === 'before_opening'
          ? 'Business date cannot be before the financial opening date.'
          : 'Invalid business date.',
    )
  }

  const limit = parsed.data.limit ?? 100
  const snap = await db
    .collection('financialLedger')
    .where('recordScope', '==', 'operational')
    .where('businessDate', '==', parsed.data.businessDate)
    .limit(limit)
    .get()

  return {
    businessDate: parsed.data.businessDate,
    entries: snap.docs.map((doc) => serializeLedgerDoc(doc.id, doc.data() as Record<string, unknown>)),
  }
})

/**
 * Stage 5F.1 — destination cashbook reads.
 * Operational lines optionally filtered by business date / range.
 * Published opening lines for the account are included separately (not double-counted as day activity).
 */
export const listHisabCashbook = functions.region('asia-south1').https.onCall(async (data, context) => {
  await requirePermission(context, 'finance.viewBalances')
  const parsed = listHisabCashbookSchema.safeParse(data ?? {})
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data

  const db = getFirestore()
  const [gate, publication, agencySnap, balanceSnap] = await Promise.all([
    getGateState(),
    getPublicationPointer(),
    db.collection('settings').doc('agency').get(),
    db.collection('financialBalances').doc(input.accountId).get(),
  ])
  if (gate.state !== 'published' || !publication.publishedSessionId || !publication.publishedGenerationId) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening is not published.')
  }
  if (!balanceSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Destination balance not found.')
  }
  const bal = balanceSnap.data() ?? {}
  if (
    bal.publishedSessionId !== publication.publishedSessionId ||
    bal.publishedGenerationId !== publication.publishedGenerationId
  ) {
    throw new functions.https.HttpsError('failed-precondition', 'Balance does not match the publication pointer.')
  }

  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const financialOpeningDate = agency.financialOpeningDate
  if (!financialOpeningDate) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening date is missing.')
  }
  const today = todayHisabBusinessDate()
  const meta = accountMeta(agency.receivingAccounts, input.accountId)

  let fromDate = input.fromDate ?? input.businessDate ?? null
  let toDate = input.toDate ?? input.businessDate ?? null
  if (fromDate) {
    const check = validateHisabBusinessDate({ selected: fromDate, financialOpeningDate, today })
    if (!check.ok) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid from / business date.')
    }
  }
  if (toDate) {
    const check = validateHisabBusinessDate({ selected: toDate, financialOpeningDate, today })
    if (!check.ok) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid to / business date.')
    }
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new functions.https.HttpsError('invalid-argument', 'fromDate cannot be after toDate.')
  }

  const limit = input.limit ?? 100
  let operationalQuery = db
    .collection('financialLedger')
    .where('recordScope', '==', 'operational')
    .where('accountId', '==', input.accountId)

  if (fromDate && toDate && fromDate === toDate) {
    operationalQuery = operationalQuery.where('businessDate', '==', fromDate)
  } else if (fromDate && toDate) {
    operationalQuery = operationalQuery
      .where('businessDate', '>=', fromDate)
      .where('businessDate', '<=', toDate)
  } else if (fromDate) {
    operationalQuery = operationalQuery.where('businessDate', '>=', fromDate)
  } else if (toDate) {
    operationalQuery = operationalQuery.where('businessDate', '<=', toDate)
  }

  const [operationalSnap, openingSnap] = await Promise.all([
    operationalQuery.limit(limit).get(),
    db
      .collection('financialLedger')
      .where('recordScope', '==', 'opening')
      .where('openingSessionId', '==', publication.publishedSessionId)
      .where('openingGenerationId', '==', publication.publishedGenerationId)
      .where('accountId', '==', input.accountId)
      .limit(40)
      .get(),
  ])

  return {
    accountId: input.accountId,
    name: meta.name,
    kind: meta.kind,
    ownership: meta.ownership,
    balancePaise: Number(bal.balancePaise ?? 0),
    needsReconciliation: bal.needsReconciliation === true,
    reconciliationReason: typeof bal.reconciliationReason === 'string' ? bal.reconciliationReason : null,
    fromDate,
    toDate,
    openingEntries: openingSnap.docs.map((doc) =>
      serializeLedgerDoc(doc.id, doc.data() as Record<string, unknown>),
    ),
    operationalEntries: operationalSnap.docs.map((doc) =>
      serializeLedgerDoc(doc.id, doc.data() as Record<string, unknown>),
    ),
  }
})
