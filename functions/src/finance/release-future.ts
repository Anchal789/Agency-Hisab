import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '../../../shared/calculations/business-date'
import { saleCollectionLedgerId } from '../../../shared/models/finance'
import { releaseFutureDatedTransactionSchema } from '../../../shared/schemas/finance-opening'
import { requireAdmin } from '../auth/guards'
import {
  commitMoneyDueIfNeededInTx,
  prepareMoneyDueIfNeededInTx,
  readGateAndPublicationInTx,
} from './apply-godown-finance'
import { assertIdempotentOrReplay, writeIdempotencyInTx } from './financial-ledger'
import {
  commitBalanceDeltasInTx,
  commitLedgerLinesInTx,
  prepareBalanceDocsInTx,
  prepareLedgerLinesInTx,
} from './ledger-write'
import { sha256Hex } from './opening-context'

export const releaseFutureDatedTransaction = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = releaseFutureDatedTransactionSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request.',
      )
    }
    const input = parsed.data
    const db = getFirestore()
    const hash = sha256Hex(JSON.stringify(input))
    const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)

    await db.runTransaction(async (tx) => {
      const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
      if (replay.replay) return

      const financeGate = await readGateAndPublicationInTx(tx)
      if (
        financeGate.gateState !== 'published' ||
        !financeGate.publishedSessionId ||
        !financeGate.publishedGenerationId
      ) {
        throw new functions.https.HttpsError('failed-precondition', 'Financial opening is not published.')
      }

      const saleRef = db.collection('transactions').doc(input.saleId)
      const cutoverRef = db.collection('saleCutoverRecords').doc(input.saleId)
      const [saleSnap, cutoverSnap] = await Promise.all([tx.get(saleRef), tx.get(cutoverRef)])
      if (!saleSnap.exists) throw new functions.https.HttpsError('not-found', 'Sale not found.')
      const sale = saleSnap.data() ?? {}
      if (sale.type !== 'godown_sale' || sale.status !== 'posted') {
        throw new functions.https.HttpsError('failed-precondition', 'Sale is not eligible for release.')
      }
      const cutover = cutoverSnap.data() ?? {}
      if (cutover.cohort !== 'future_dated' || cutover.financeEffect !== 'deferred') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Sale is not a deferred future-dated transaction.',
        )
      }
      const businessDate = String(sale.businessDate ?? '')
      if (businessDate > today && !input.earlyReleaseReason) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Early release requires an audited reason.',
        )
      }

      const amounts = sale.amountsPaise ?? {}
      const receivedPaise = Number(amounts.receivedPaise ?? 0)
      const duePaise = Number(amounts.duePaise ?? 0)
      const accountId = typeof sale.receivingAccountId === 'string' ? sale.receivingAccountId : null
      const customerId = typeof sale.customerId === 'string' ? sale.customerId : null
      const customerKind = sale.customerKind === 'custom' ? 'custom' : 'registered'
      const customerName = String(sale.customerSnapshot?.name ?? '')

      const ledgerInputs =
        receivedPaise > 0 && accountId
          ? [
              {
                entryId: saleCollectionLedgerId(input.saleId, accountId),
                accountId,
                amountPaise: receivedPaise,
                direction: 'credit' as const,
                entryClass: 'sale_collection' as const,
                businessDate,
                transactionId: input.saleId,
                recordScope: 'operational' as const,
                customerId,
              },
            ]
          : []
      const preparedLedger = await prepareLedgerLinesInTx(tx, db, ledgerInputs)
      const balances = await prepareBalanceDocsInTx(tx, db, accountId && receivedPaise > 0 ? [accountId] : [])
      const moneyPrepared = await prepareMoneyDueIfNeededInTx(tx, db, {
        saleId: input.saleId,
        duePaise,
        businessDate,
        customerId,
        customerKind,
        customerName,
        actorUid,
        enabled: duePaise > 0,
      })

      commitLedgerLinesInTx(tx, db, preparedLedger, actorUid)
      if (accountId && receivedPaise > 0) {
        commitBalanceDeltasInTx(tx, db, {
          balances,
          deltas: [{ accountId, deltaPaise: receivedPaise, transactionId: input.saleId }],
          publishedSessionId: financeGate.publishedSessionId,
          publishedGenerationId: financeGate.publishedGenerationId,
        })
      }
      commitMoneyDueIfNeededInTx(tx, db, moneyPrepared)
      tx.set(
        cutoverRef,
        {
          financeEffect: 'phase5_posted',
          earlyReleaseReason: input.earlyReleaseReason ?? null,
          releasedAt: FieldValue.serverTimestamp(),
          releasedBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: input.saleId,
      })
      tx.set(db.collection('auditLogs').doc(), {
        action: 'finance.future.release',
        actorUid,
        saleId: input.saleId,
        earlyReleaseReason: input.earlyReleaseReason ?? null,
        createdAt: FieldValue.serverTimestamp(),
      })
    })

    return { ok: true, saleId: input.saleId }
  })
