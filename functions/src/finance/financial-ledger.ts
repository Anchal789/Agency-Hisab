import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import type {
  FinancialEntryClass,
  LedgerDirection,
  RecordScope,
} from '../../../shared/models/finance'

export type LedgerWrite = {
  entryId: string
  accountId: string
  amountPaise: number
  direction: LedgerDirection
  entryClass: FinancialEntryClass
  businessDate: string
  transactionId: string
  recordScope: RecordScope
  openingSessionId?: string | null
  openingGenerationId?: string | null
  customerId?: string | null
  obligationId?: string | null
  relatedTransactionId?: string | null
  idempotencyKey?: string | null
  reversalOfEntryId?: string | null
  contentHash?: string
}

/**
 * Write an immutable ledger line. If the id exists with the same contentHash, no-op.
 * If it exists with a different hash, integrity error.
 * Optionally applies the same delta to financialBalances when updateBalance is true
 * (post-publication operational/opening-visible cash movements only).
 */
export async function writeLedgerEntryInTx(
  tx: Transaction,
  db: Firestore,
  input: LedgerWrite & {
    actorUid: string
    updateBalance?: boolean
    publishedSessionId?: string
    publishedGenerationId?: string
  },
): Promise<{ written: boolean }> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ledger amount.')
  }
  if (input.amountPaise === 0) {
    return { written: false }
  }

  const ref = db.collection('financialLedger').doc(input.entryId)
  const snap = await tx.get(ref)
  const contentHash =
    input.contentHash ??
    [
      input.accountId,
      input.amountPaise,
      input.direction,
      input.entryClass,
      input.businessDate,
      input.transactionId,
      input.recordScope,
      input.openingSessionId ?? '',
      input.openingGenerationId ?? '',
    ].join('|')

  if (snap.exists) {
    const existing = snap.data() ?? {}
    if (existing.contentHash === contentHash) {
      return { written: false }
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Ledger integrity conflict for ${input.entryId}.`,
    )
  }

  tx.set(ref, {
    accountId: input.accountId,
    amountPaise: input.amountPaise,
    direction: input.direction,
    entryClass: input.entryClass,
    businessDate: input.businessDate,
    transactionId: input.transactionId,
    recordScope: input.recordScope,
    openingSessionId: input.openingSessionId ?? null,
    openingGenerationId: input.openingGenerationId ?? null,
    customerId: input.customerId ?? null,
    obligationId: input.obligationId ?? null,
    relatedTransactionId: input.relatedTransactionId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    reversalOfEntryId: input.reversalOfEntryId ?? null,
    contentHash,
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })

  if (input.updateBalance) {
    if (!input.publishedSessionId || !input.publishedGenerationId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Balance updates require a published opening session and generation.',
      )
    }
    const balRef = db.collection('financialBalances').doc(input.accountId)
    const balSnap = await tx.get(balRef)
    if (!balSnap.exists) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Financial balance is missing for this destination.',
      )
    }
    const bal = balSnap.data() ?? {}
    if (
      bal.publishedSessionId !== input.publishedSessionId ||
      bal.publishedGenerationId !== input.publishedGenerationId
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Balance publication identifiers do not match the pointer.',
      )
    }
    const delta = input.direction === 'credit' ? input.amountPaise : -input.amountPaise
    const next = Number(bal.balancePaise ?? 0) + delta
    if (!Number.isSafeInteger(next)) {
      throw new functions.https.HttpsError('failed-precondition', 'Balance overflow.')
    }
    const needsReconciliation = next < 0 ? true : bal.needsReconciliation === true
    tx.update(balRef, {
      balancePaise: next,
      needsReconciliation,
      reconciliationReason:
        next < 0 ? (bal.reconciliationReason ?? 'godown_reversal_overdraw') : bal.reconciliationReason ?? null,
      updatedByTransactionId: input.transactionId,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  return { written: true }
}

export async function readIdempotencyInTx(
  tx: Transaction,
  db: Firestore,
  key: string,
): Promise<{ exists: boolean; transactionId: string | null; requestHash: string | null }> {
  const snap = await tx.get(db.collection('idempotencyRecords').doc(key))
  if (!snap.exists) return { exists: false, transactionId: null, requestHash: null }
  const data = snap.data() ?? {}
  return {
    exists: true,
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : null,
    requestHash: typeof data.requestHash === 'string' ? data.requestHash : null,
  }
}

export function writeIdempotencyInTx(
  tx: Transaction,
  db: Firestore,
  input: { key: string; actorUid: string; requestHash: string; transactionId: string },
): void {
  tx.set(db.collection('idempotencyRecords').doc(input.key), {
    actorUid: input.actorUid,
    requestHash: input.requestHash,
    transactionId: input.transactionId,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export async function assertIdempotentOrReplay(
  tx: Transaction,
  db: Firestore,
  key: string,
  requestHash: string,
): Promise<{ replay: true; transactionId: string } | { replay: false }> {
  const existing = await readIdempotencyInTx(tx, db, key)
  if (!existing.exists) return { replay: false }
  if (existing.requestHash === requestHash && existing.transactionId) {
    return { replay: true, transactionId: existing.transactionId }
  }
  throw new functions.https.HttpsError(
    'already-exists',
    'This request conflicts with a previous submission that used the same idempotency key.',
  )
}
