import {
  FieldValue,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import type {
  FinancialEntryClass,
  LedgerDirection,
  RecordScope,
} from '../../../shared/models/finance'

export type PreparedLedgerLine = {
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
  contentHash: string
  existsWithSameHash: boolean
  conflict: boolean
}

export function buildLedgerContentHash(input: {
  accountId: string
  amountPaise: number
  direction: string
  entryClass: string
  businessDate: string
  transactionId: string
  recordScope: string
  openingSessionId?: string | null
  openingGenerationId?: string | null
}): string {
  return [
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
}

/** Read phase: prepare ledger lines (all reads). */
export async function prepareLedgerLinesInTx(
  tx: Transaction,
  db: Firestore,
  lines: Array<Omit<PreparedLedgerLine, 'contentHash' | 'existsWithSameHash' | 'conflict'> & { contentHash?: string }>,
): Promise<PreparedLedgerLine[]> {
  const prepared: PreparedLedgerLine[] = []
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountPaise) || line.amountPaise < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid ledger amount.')
    }
    if (line.amountPaise === 0) continue
    const contentHash =
      line.contentHash ??
      buildLedgerContentHash(line)
    const snap = await tx.get(db.collection('financialLedger').doc(line.entryId))
    if (snap.exists) {
      const existing = snap.data() ?? {}
      prepared.push({
        ...line,
        contentHash,
        existsWithSameHash: existing.contentHash === contentHash,
        conflict: existing.contentHash !== contentHash,
      })
    } else {
      prepared.push({
        ...line,
        contentHash,
        existsWithSameHash: false,
        conflict: false,
      })
    }
  }
  return prepared
}

/** Write phase: commit prepared ledger lines (writes only). */
export function commitLedgerLinesInTx(
  tx: Transaction,
  db: Firestore,
  prepared: PreparedLedgerLine[],
  actorUid: string,
): void {
  for (const line of prepared) {
    if (line.conflict) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Ledger integrity conflict for ${line.entryId}.`,
      )
    }
    if (line.existsWithSameHash) continue
    tx.set(db.collection('financialLedger').doc(line.entryId), {
      accountId: line.accountId,
      amountPaise: line.amountPaise,
      direction: line.direction,
      entryClass: line.entryClass,
      businessDate: line.businessDate,
      transactionId: line.transactionId,
      recordScope: line.recordScope,
      openingSessionId: line.openingSessionId ?? null,
      openingGenerationId: line.openingGenerationId ?? null,
      customerId: line.customerId ?? null,
      obligationId: line.obligationId ?? null,
      relatedTransactionId: line.relatedTransactionId ?? null,
      idempotencyKey: line.idempotencyKey ?? null,
      reversalOfEntryId: line.reversalOfEntryId ?? null,
      contentHash: line.contentHash,
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
    })
  }
}

export type BalanceDelta = { accountId: string; deltaPaise: number; transactionId: string }

export async function prepareBalanceDocsInTx(
  tx: Transaction,
  db: Firestore,
  accountIds: string[],
): Promise<Map<string, DocumentData | null>> {
  const map = new Map<string, DocumentData | null>()
  for (const accountId of accountIds) {
    const snap = await tx.get(db.collection('financialBalances').doc(accountId))
    map.set(accountId, snap.exists ? snap.data() ?? null : null)
  }
  return map
}

export function commitBalanceDeltasInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    balances: Map<string, DocumentData | null>
    deltas: BalanceDelta[]
    publishedSessionId: string
    publishedGenerationId: string
    allowNegative?: boolean
  },
): void {
  const merged = new Map<string, number>()
  for (const delta of input.deltas) {
    merged.set(delta.accountId, (merged.get(delta.accountId) ?? 0) + delta.deltaPaise)
  }
  for (const [accountId, deltaPaise] of merged) {
    const bal = input.balances.get(accountId)
    if (!bal) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Financial balance is missing for ${accountId}.`,
      )
    }
    if (
      bal.publishedSessionId !== input.publishedSessionId ||
      bal.publishedGenerationId !== input.publishedGenerationId
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Balance publication identifiers do not match the pointer.',
      )
    }
    const next = Number(bal.balancePaise ?? 0) + deltaPaise
    if (!Number.isSafeInteger(next)) {
      throw new functions.https.HttpsError('failed-precondition', 'Balance overflow.')
    }
    const needsReconciliation = next < 0 ? true : bal.needsReconciliation === true
    tx.update(db.collection('financialBalances').doc(accountId), {
      balancePaise: next,
      needsReconciliation,
      reconciliationReason:
        next < 0 ? bal.reconciliationReason ?? 'godown_reversal_overdraw' : bal.reconciliationReason ?? null,
      updatedByTransactionId: input.deltas.find((d) => d.accountId === accountId)?.transactionId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
