import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { parseAgencySettings } from '../../../shared/models/agency-config'
import { resolveHistoricalGodownSaleFinanceSchema } from '../../../shared/schemas/finance-opening'
import { requireAdmin } from '../auth/guards'
import {
  createMoneyObligationForSaleInTx,
  linkMoneyObligationToSaleInTx,
} from './money-obligation-claims'
import { assertIdempotentOrReplay, writeIdempotencyInTx } from './financial-ledger'
import { getGateState, getPublicationPointer, sha256Hex } from './opening-context'

function requestHash(payload: unknown): string {
  return sha256Hex(JSON.stringify(payload))
}

export const resolveHistoricalGodownSaleFinance = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = resolveHistoricalGodownSaleFinanceSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request.',
      )
    }
    const input = parsed.data
    const gate = await getGateState()
    if (gate.state !== 'published') {
      throw new functions.https.HttpsError('failed-precondition', 'Financial opening is not published.')
    }
    const agencySnap = await getFirestore().collection('settings').doc('agency').get()
    const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
    const openingDate = agency.financialOpeningDate
    if (!openingDate) {
      throw new functions.https.HttpsError('failed-precondition', 'Financial opening date is missing.')
    }

    if (
      input.historicalCollection.status === 'incomplete' &&
      input.resolution.kind !== 'block_pending_reconciliation'
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Incomplete historical collection must use block_pending_reconciliation (or remain blocked).',
      )
    }

    const db = getFirestore()
    const hash = requestHash(input)
    const result = await db.runTransaction(async (tx) => {
      const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
      if (replay.replay) {
        return { saleId: replay.transactionId, reused: true }
      }

      const saleRef = db.collection('transactions').doc(input.saleId)
      const cutoverRef = db.collection('saleCutoverRecords').doc(input.saleId)
      const [saleSnap, cutoverSnap] = await Promise.all([tx.get(saleRef), tx.get(cutoverRef)])
      if (!saleSnap.exists) throw new functions.https.HttpsError('not-found', 'Sale not found.')
      const sale = saleSnap.data() ?? {}
      if (sale.type !== 'godown_sale' || sale.status !== 'posted') {
        throw new functions.https.HttpsError('failed-precondition', 'Sale is not an eligible posted godown sale.')
      }
      const businessDate = String(sale.businessDate ?? '')
      if (businessDate > openingDate) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Sale business date is after the financial opening date.',
        )
      }

      const cutover = cutoverSnap.exists ? cutoverSnap.data() ?? {} : {}
      const currentState = (cutover.historicalExceptionState as string | null) ?? 'needs_historical_review'
      if (
        (currentState === 'resolved_receivable' || currentState === 'resolved_no_receivable') &&
        cutover.historicalResolutionHash &&
        cutover.historicalResolutionHash !== hash
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Historical exception is already resolved with a different payload.',
        )
      }
      if (
        (currentState === 'resolved_receivable' || currentState === 'resolved_no_receivable') &&
        cutover.historicalResolutionHash === hash
      ) {
        return { saleId: input.saleId, reused: true }
      }

      // Never credit current destination balances for historical collection.
      let nextState = currentState
      if (input.resolution.kind === 'block_pending_reconciliation') {
        nextState = 'blocked_reconciliation'
      } else if (input.resolution.kind === 'no_receivable') {
        // Reject if open/partial money obligation exists
        const originClaim = await tx.get(db.collection('moneyObligationOriginClaims').doc(input.saleId))
        if (originClaim.exists && originClaim.data()?.status === 'claimed') {
          const oblId = String(originClaim.data()?.obligationId ?? '')
          const oblSnap = await tx.get(db.collection('obligations').doc(oblId))
          if (oblSnap.exists) {
            const st = oblSnap.data()?.status
            if (st === 'open' || st === 'partial') {
              throw new functions.https.HttpsError(
                'failed-precondition',
                'Cannot choose no_receivable while an open or partial money obligation exists.',
              )
            }
          }
        }
        nextState = 'resolved_no_receivable'
      } else if (input.resolution.kind === 'create_opening_receivable') {
        await createMoneyObligationForSaleInTx(tx, db, {
          saleId: input.saleId,
          customerId: typeof sale.customerId === 'string' ? sale.customerId : null,
          customerKind: sale.customerKind === 'custom' ? 'custom' : 'registered',
          customerName: String(sale.customerSnapshot?.name ?? ''),
          businessDate,
          amountPaise: input.resolution.approvedAmountPaise,
          source: 'backdated_adjustment',
          recordScope: 'operational',
          openingSessionId: null,
          openingGenerationId: null,
          actorUid,
        })
        nextState = 'resolved_receivable'
      } else if (input.resolution.kind === 'link_existing_receivable') {
        await linkMoneyObligationToSaleInTx(tx, db, {
          saleId: input.saleId,
          obligationId: input.resolution.obligationId,
          expectedCustomerId: typeof sale.customerId === 'string' ? sale.customerId : null,
          actorUid,
        })
        nextState = 'resolved_receivable'
      }

      tx.set(
        cutoverRef,
        {
          saleId: input.saleId,
          cohort: cutover.cohort ?? 'pre_cutover',
          historicalExceptionState: nextState,
          historicalResolutionHash: hash,
          historicalCollectionStatus: input.historicalCollection.status,
          recordScope: cutover.recordScope ?? 'operational',
          updatedBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
          ...(cutoverSnap.exists ? {} : { createdBy: actorUid, createdAt: FieldValue.serverTimestamp() }),
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
        action: 'finance.historical.resolve',
        actorUid,
        saleId: input.saleId,
        resolution: input.resolution.kind,
        historicalCollection: input.historicalCollection.status,
        nextState,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { saleId: input.saleId, reused: false, state: nextState }
    })

    void getPublicationPointer
    return result
  })
