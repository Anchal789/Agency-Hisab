import { FieldValue, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '../../../shared/calculations/business-date'
import { classifyGodownSaleCohort } from '../../../shared/calculations/finance-classification'
import {
  collectionUnwindLedgerId,
  moneyObligationIdForSale,
  saleCollectionLedgerId,
} from '../../../shared/models/finance'
import {
  commitMoneyObligationForSaleInTx,
  prepareMoneyObligationForSaleInTx,
  releaseMoneyClaimsInTx,
  type PreparedMoneyObligationCreate,
} from './money-obligation-claims'
import {
  commitBalanceDeltasInTx,
  commitLedgerLinesInTx,
  prepareBalanceDocsInTx,
  prepareLedgerLinesInTx,
} from './ledger-write'
import { gateRef, getPublicationPointer, invalidateOpeningGenerationInTx, publicationRef } from './opening-context'

export async function readGateAndPublicationInTx(tx: Transaction) {
  const [gateSnap, pubSnap] = await Promise.all([tx.get(gateRef()), tx.get(publicationRef())])
  const gate = gateSnap.data() ?? { state: 'not_opened', mutationEpoch: 0 }
  const pub = pubSnap.data() ?? { publishedSessionId: null, publishedGenerationId: null }
  return {
    gateState: (gate.state as string) || 'not_opened',
    mutationEpoch: Number(gate.mutationEpoch ?? 0),
    publishedSessionId: typeof pub.publishedSessionId === 'string' ? pub.publishedSessionId : null,
    publishedGenerationId: typeof pub.publishedGenerationId === 'string' ? pub.publishedGenerationId : null,
  }
}

/**
 * Post Phase 5 finance for a newly created Godown sale when gate is published.
 * Caller must invoke prepare (reads) before any writes, then commit (writes).
 */
export async function preparePostCutoverSaleFinanceInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    businessDate: string
    openingDate: string | null
    receivedPaise: number
    duePaise: number
    salePaise: number
    accountId: string | null
    customerId: string | null
    customerKind: 'registered' | 'custom'
    customerName: string
    publishedSessionId: string
    publishedGenerationId: string
  },
): Promise<{
  cohort: 'post_cutover' | 'future_dated'
  ledger: Awaited<ReturnType<typeof prepareLedgerLinesInTx>>
  balances: Map<string, DocumentData | null>
  createMoneyDue: boolean
}> {
  const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)
  if (!input.openingDate) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening date is missing.')
  }
  const cohort = classifyGodownSaleCohort({
    businessDate: input.businessDate,
    openingDate: input.openingDate,
    today,
  })
  if (cohort === 'pre_cutover') {
    // Historical exception path — mark for review; no cash credit.
    return {
      cohort: 'future_dated',
      ledger: [],
      balances: new Map(),
      createMoneyDue: false,
    }
  }

  const ledgerInputs =
    cohort === 'post_cutover' && input.receivedPaise > 0 && input.accountId
      ? [
          {
            entryId: saleCollectionLedgerId(input.saleId, input.accountId),
            accountId: input.accountId,
            amountPaise: input.receivedPaise,
            direction: 'credit' as const,
            entryClass: 'sale_collection' as const,
            businessDate: input.businessDate,
            transactionId: input.saleId,
            recordScope: 'operational' as const,
            customerId: input.customerId,
          },
        ]
      : []

  const ledger = await prepareLedgerLinesInTx(tx, db, ledgerInputs)
  const accountIds = input.accountId && input.receivedPaise > 0 && cohort === 'post_cutover' ? [input.accountId] : []
  const balances = await prepareBalanceDocsInTx(tx, db, accountIds)
  return {
    cohort,
    ledger,
    balances,
    createMoneyDue: cohort === 'post_cutover' && input.duePaise > 0,
  }
}

export function commitPostCutoverSaleFinanceInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    businessDate: string
    receivedPaise: number
    duePaise: number
    salePaise: number
    accountId: string | null
    customerId: string | null
    customerKind: 'registered' | 'custom'
    customerName: string
    actorUid: string
    publishedSessionId: string
    publishedGenerationId: string
    prepared: Awaited<ReturnType<typeof preparePostCutoverSaleFinanceInTx>>
    historicalPreCutover?: boolean
  },
): void {
  const { prepared } = input
  if (input.historicalPreCutover) {
    tx.set(
      db.collection('saleCutoverRecords').doc(input.saleId),
      {
        saleId: input.saleId,
        cohort: 'pre_cutover',
        financeEffect: 'none',
        historicalExceptionState: 'needs_historical_review',
        recordScope: 'operational',
        businessDateAtClassification: input.businessDate,
        salePaise: input.salePaise,
        receivedPaise: input.receivedPaise,
        duePaise: input.duePaise,
        receivingAccountId: input.accountId,
        createdBy: input.actorUid,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return
  }

  commitLedgerLinesInTx(tx, db, prepared.ledger, input.actorUid)
  if (prepared.ledger.length > 0 && input.accountId) {
    commitBalanceDeltasInTx(tx, db, {
      balances: prepared.balances,
      deltas: [{ accountId: input.accountId, deltaPaise: input.receivedPaise, transactionId: input.saleId }],
      publishedSessionId: input.publishedSessionId,
      publishedGenerationId: input.publishedGenerationId,
    })
  }

  tx.set(
    db.collection('saleCutoverRecords').doc(input.saleId),
    {
      saleId: input.saleId,
      cohort: prepared.cohort,
      financeEffect: prepared.cohort === 'future_dated' ? 'deferred' : 'phase5_posted',
      recordScope: 'operational',
      businessDateAtClassification: input.businessDate,
      salePaise: input.salePaise,
      receivedPaise: input.receivedPaise,
      duePaise: input.duePaise,
      receivingAccountId: input.accountId,
      receivableStatus: prepared.createMoneyDue ? 'open' : 'none',
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

export async function prepareMoneyDueIfNeededInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    duePaise: number
    businessDate: string
    customerId: string | null
    customerKind: 'registered' | 'custom'
    customerName: string
    actorUid: string
    enabled: boolean
  },
): Promise<PreparedMoneyObligationCreate | null> {
  if (!input.enabled || input.duePaise <= 0) return null
  return prepareMoneyObligationForSaleInTx(tx, db, {
    saleId: input.saleId,
    customerId: input.customerId,
    customerKind: input.customerKind,
    customerName: input.customerName,
    businessDate: input.businessDate,
    amountPaise: input.duePaise,
    source: 'godown_sale',
    recordScope: 'operational',
    openingSessionId: null,
    openingGenerationId: null,
    actorUid: input.actorUid,
  })
}

export function commitMoneyDueIfNeededInTx(
  tx: Transaction,
  db: Firestore,
  prepared: PreparedMoneyObligationCreate | null,
): void {
  if (!prepared) return
  commitMoneyObligationForSaleInTx(tx, db, prepared)
}

export async function registerSealingCandidateInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    businessDate: string
    status: string
    receivedPaise: number
    duePaise: number
    receivingAccountId: string | null
    customerId: string | null
    actorUid: string
  },
): Promise<void> {
  tx.set(db.collection('financeCutoverCandidates').doc(input.saleId), {
    saleId: input.saleId,
    businessDate: input.businessDate,
    status: input.status,
    receivedPaise: input.receivedPaise,
    duePaise: input.duePaise,
    receivingAccountId: input.receivingAccountId,
    customerId: input.customerId,
    updatedBy: input.actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  })
  invalidateOpeningGenerationInTx(tx, { actorUid: input.actorUid, reason: 'godown_sale_mutation' })
}

export type PreparedPublishedFinancialReverse = {
  alreadyReversed: boolean
  financeEffect: 'opening_reversed' | 'phase5_reversed'
  reverseMoneyObligation: boolean
  moneyObligationId: string
  ledger: Awaited<ReturnType<typeof prepareLedgerLinesInTx>>
  balances: Map<string, DocumentData | null>
  unwindAccountId: string | null
  unwindAmountPaise: number
  publishedSessionId: string
  publishedGenerationId: string
}

/**
 * Prepare cash unwind + money-obligation reverse for a published Godown sale.
 * All reads happen here; caller must not have written in the transaction yet.
 */
export async function preparePublishedFinancialReverseInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    businessDate: string
    publishedSessionId: string
    publishedGenerationId: string
  },
): Promise<PreparedPublishedFinancialReverse> {
  const cutoverSnap = await tx.get(db.collection('saleCutoverRecords').doc(input.saleId))
  if (!cutoverSnap.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Sale cutover record is required for financial reversal after publication.',
    )
  }
  const cutover = cutoverSnap.data() ?? {}
  const effect = String(cutover.financeEffect ?? 'none')
  if (effect === 'opening_reversed' || effect === 'phase5_reversed') {
    return {
      alreadyReversed: true,
      financeEffect: effect as 'opening_reversed' | 'phase5_reversed',
      reverseMoneyObligation: false,
      moneyObligationId: moneyObligationIdForSale(input.saleId),
      ledger: [],
      balances: new Map(),
      unwindAccountId: null,
      unwindAmountPaise: 0,
      publishedSessionId: input.publishedSessionId,
      publishedGenerationId: input.publishedGenerationId,
    }
  }

  const cohort = String(cutover.cohort ?? '')
  const financeEffect: 'opening_reversed' | 'phase5_reversed' =
    cohort === 'pre_cutover' ? 'opening_reversed' : 'phase5_reversed'

  let unwindAccountId: string | null = null
  let unwindAmountPaise = 0

  if (cohort === 'pre_cutover') {
    const snap = await tx.get(db.collection('openingCollectionSnapshots').doc(input.saleId))
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Opening collection snapshot is required for pre-cutover reversal.',
      )
    }
    const snapshot = snap.data() ?? {}
    const status = String(snapshot.snapshotStatus ?? 'incomplete')
    if (status === 'incomplete') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Incomplete opening collection snapshot blocks reversal.',
      )
    }
    if (status === 'captured') {
      unwindAmountPaise = Number(snapshot.amountPaise ?? 0)
      unwindAccountId = typeof snapshot.accountId === 'string' ? snapshot.accountId : null
      if (unwindAmountPaise > 0 && !unwindAccountId) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Captured snapshot is missing destination account.',
        )
      }
    }
  } else if (cohort === 'post_cutover' || effect === 'phase5_posted') {
    unwindAmountPaise = Number(cutover.receivedPaise ?? 0)
    unwindAccountId =
      typeof cutover.receivingAccountId === 'string' ? cutover.receivingAccountId : null
    if (unwindAmountPaise > 0 && !unwindAccountId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Posted collection is missing destination account.',
      )
    }
  }

  const moneyObligationId = moneyObligationIdForSale(input.saleId)
  const moneyOblSnap = await tx.get(db.collection('obligations').doc(moneyObligationId))
  let reverseMoneyObligation = false
  if (moneyOblSnap.exists) {
    const money = moneyOblSnap.data() ?? {}
    if (Number(money.settledAmountPaise ?? 0) > 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Sale has settled money and cannot be reversed.',
      )
    }
    const status = String(money.status ?? '')
    if (status !== 'reversed' && status !== 'settled') {
      reverseMoneyObligation = true
    }
  }

  const allocSnap = await tx.get(
    db.collection('paymentAllocations').where('obligationId', '==', moneyObligationId).limit(1),
  )
  if (!allocSnap.empty) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Sale has payment allocations and cannot be reversed.',
    )
  }
  const creditSnap = await tx.get(
    db.collection('creditApplications').where('targetObligationId', '==', moneyObligationId).limit(1),
  )
  if (!creditSnap.empty) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Sale has customer-credit applications and cannot be reversed.',
    )
  }

  const ledgerInputs =
    unwindAmountPaise > 0 && unwindAccountId
      ? [
          {
            entryId: collectionUnwindLedgerId(input.saleId),
            accountId: unwindAccountId,
            amountPaise: unwindAmountPaise,
            direction: 'debit' as const,
            entryClass: 'collection_unwind' as const,
            businessDate: input.businessDate,
            transactionId: `${input.saleId}_reversal`,
            recordScope: 'operational' as const,
            relatedTransactionId: input.saleId,
            reversalOfEntryId:
              unwindAccountId != null
                ? saleCollectionLedgerId(input.saleId, unwindAccountId)
                : null,
          },
        ]
      : []

  const ledger = await prepareLedgerLinesInTx(tx, db, ledgerInputs)
  const balances = await prepareBalanceDocsInTx(
    tx,
    db,
    unwindAccountId && unwindAmountPaise > 0 ? [unwindAccountId] : [],
  )

  return {
    alreadyReversed: false,
    financeEffect,
    reverseMoneyObligation,
    moneyObligationId,
    ledger,
    balances,
    unwindAccountId,
    unwindAmountPaise,
    publishedSessionId: input.publishedSessionId,
    publishedGenerationId: input.publishedGenerationId,
  }
}

export function commitPublishedFinancialReverseInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    actorUid: string
    prepared: PreparedPublishedFinancialReverse
  },
): void {
  const { prepared } = input
  if (prepared.alreadyReversed) return

  commitLedgerLinesInTx(tx, db, prepared.ledger, input.actorUid)
  if (prepared.unwindAccountId && prepared.unwindAmountPaise > 0) {
    commitBalanceDeltasInTx(tx, db, {
      balances: prepared.balances,
      deltas: [
        {
          accountId: prepared.unwindAccountId,
          deltaPaise: -prepared.unwindAmountPaise,
          transactionId: `${input.saleId}_reversal`,
        },
      ],
      publishedSessionId: prepared.publishedSessionId,
      publishedGenerationId: prepared.publishedGenerationId,
      allowNegative: true,
    })
  }

  if (prepared.reverseMoneyObligation) {
    // Keep origin/link claims as claimed so uniqueness cannot be bypassed after reverse.
    tx.update(db.collection('obligations').doc(prepared.moneyObligationId), {
      status: 'reversed',
      outstandingAmountPaise: 0,
      updatedBy: input.actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  tx.set(
    db.collection('saleCutoverRecords').doc(input.saleId),
    {
      financeEffect: prepared.financeEffect,
      receivableStatus: prepared.reverseMoneyObligation ? 'reversed' : undefined,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

export { getPublicationPointer, collectionUnwindLedgerId, releaseMoneyClaimsInTx }
