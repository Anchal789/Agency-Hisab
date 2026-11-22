import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import {
  createManualOpeningReceivableSchema,
  createOpeningReceivableAdjustmentSchema,
  linkOpeningReceivableSchema,
} from '../../../shared/schemas/finance-opening'
import { moneyObligationIdForSale } from '../../../shared/models/finance'
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

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'Invalid request.'
}

/** Admin-only manual opening receivable (no cash credit). */
export const createManualOpeningReceivable = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = createManualOpeningReceivableSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
    }
    const input = parsed.data
    const gate = await getGateState()
    if (gate.state !== 'published' && gate.state !== 'sealing') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Manual opening receivables require sealing or published financial opening.',
      )
    }
    const pub = await getPublicationPointer()
    const db = getFirestore()
    const hash = requestHash(input)
    const syntheticSaleId = `manual_${input.idempotencyKey}`

    const result = await db.runTransaction(async (tx) => {
      const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
      if (replay.replay) {
        return { obligationId: replay.transactionId, reused: true }
      }

      const customerSnap = await tx.get(db.collection('customers').doc(input.customerId))
      if (!customerSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Customer not found.')
      }
      const customer = customerSnap.data() ?? {}
      const customerName = String(customer.fullName ?? customer.name ?? 'Customer')

      const created = await createMoneyObligationForSaleInTx(tx, db, {
        saleId: syntheticSaleId,
        obligationIdOverride: `money_manual_${input.idempotencyKey}`,
        customerId: input.customerId,
        customerKind: 'registered',
        customerName,
        businessDate: input.businessDate,
        amountPaise: input.amountPaise,
        source: 'manual_opening_receivable',
        recordScope: gate.state === 'published' ? 'operational' : 'opening',
        openingSessionId: pub.publishedSessionId,
        openingGenerationId: pub.publishedGenerationId,
        actorUid,
      })

      tx.set(db.collection('auditLogs').doc(), {
        action: 'finance.manual_opening_receivable_created',
        actorUid,
        obligationId: created.obligationId,
        customerId: input.customerId,
        amountPaise: input.amountPaise,
        reason: input.reason,
        createdAt: FieldValue.serverTimestamp(),
      })

      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: created.obligationId,
      })
      return { obligationId: created.obligationId, reused: false }
    })

    return result
  })

/** Link an existing money obligation to a sale (Admin). */
export const linkOpeningReceivable = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = linkOpeningReceivableSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()
  const hash = requestHash(input)

  const result = await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) {
      return { obligationId: replay.transactionId, reused: true }
    }

    const saleSnap = await tx.get(db.collection('transactions').doc(input.saleId))
    if (!saleSnap.exists) throw new functions.https.HttpsError('not-found', 'Sale not found.')
    const sale = saleSnap.data() ?? {}
    if (sale.type !== 'godown_sale') {
      throw new functions.https.HttpsError('failed-precondition', 'Only godown sales can be linked.')
    }

    const linked = await linkMoneyObligationToSaleInTx(tx, db, {
      saleId: input.saleId,
      obligationId: input.obligationId,
      expectedCustomerId: typeof sale.customerId === 'string' ? sale.customerId : null,
      actorUid,
    })

    tx.set(
      db.collection('saleCutoverRecords').doc(input.saleId),
      {
        receivableStatus: 'open',
        linkedObligationId: input.obligationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: linked.obligationId,
    })
    return { obligationId: linked.obligationId, reused: false }
  })

  return result
})

/**
 * Adjust outstanding on a sale-originated money obligation after reverse/conflict.
 * Does not create cash movements.
 */
export const createOpeningReceivableAdjustment = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = createOpeningReceivableAdjustmentSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
    }
    const input = parsed.data
    const db = getFirestore()
    const hash = requestHash(input)
    const obligationId = moneyObligationIdForSale(input.saleId)

    const result = await db.runTransaction(async (tx) => {
      const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
      if (replay.replay) {
        return { obligationId: replay.transactionId, reused: true }
      }

      const oblRef = db.collection('obligations').doc(obligationId)
      const oblSnap = await tx.get(oblRef)
      if (!oblSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Money obligation not found for sale.')
      }
      const obl = oblSnap.data() ?? {}
      if (obl.kind !== 'money') {
        throw new functions.https.HttpsError('failed-precondition', 'Not a money obligation.')
      }
      if (obl.status === 'settled') {
        throw new functions.https.HttpsError('failed-precondition', 'Settled obligations cannot be adjusted.')
      }

      const settled = Number(obl.settledAmountPaise ?? 0)
      if (input.newOutstandingPaise < 0 || !Number.isSafeInteger(input.newOutstandingPaise)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid outstanding amount.')
      }
      const original = settled + input.newOutstandingPaise
      const status =
        input.newOutstandingPaise === 0 ? 'settled' : settled > 0 ? 'partial' : 'open'

      tx.update(oblRef, {
        outstandingAmountPaise: input.newOutstandingPaise,
        originalAmountPaise: original,
        status,
        adjustmentReason: input.reason,
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      })

      tx.set(db.collection('auditLogs').doc(), {
        action: 'finance.opening_receivable_adjusted',
        actorUid,
        saleId: input.saleId,
        obligationId,
        newOutstandingPaise: input.newOutstandingPaise,
        reason: input.reason,
        createdAt: FieldValue.serverTimestamp(),
      })

      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: obligationId,
      })
      return { obligationId, reused: false }
    })

    return result
  })
