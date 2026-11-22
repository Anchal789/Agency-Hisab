import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import {
  moneyLinkClaimId,
  moneyObligationIdForSale,
  moneyOriginClaimId,
  type MoneyLinkClaimDoc,
  type MoneyOriginClaimDoc,
} from '../../../shared/models/finance'

/**
 * Atomic uniqueness for money obligations (Phase 5.0).
 *
 * Collections:
 * - moneyObligationOriginClaims/{saleId}  → at most one non-reversed money obligation per sale
 * - moneyObligationLinkClaims/{obligationId} → at most one originating sale per money obligation
 *
 * Empty-cylinder obligations never use these claim documents or money_* ids.
 */

export function originClaimRef(db: Firestore, saleId: string) {
  return db.collection('moneyObligationOriginClaims').doc(moneyOriginClaimId(saleId))
}

export function linkClaimRef(db: Firestore, obligationId: string) {
  return db.collection('moneyObligationLinkClaims').doc(moneyLinkClaimId(obligationId))
}

export function moneyObligationRef(db: Firestore, saleId: string) {
  return db.collection('obligations').doc(moneyObligationIdForSale(saleId))
}

type CreateMoneyFromSaleInput = {
  saleId: string
  customerId: string | null
  customerKind: 'registered' | 'custom'
  customerName: string
  businessDate: string
  amountPaise: number
  source: 'opening_receivable' | 'godown_sale' | 'backdated_adjustment' | 'manual_opening_receivable'
  recordScope: 'operational' | 'opening'
  openingSessionId: string | null
  openingGenerationId: string | null
  actorUid: string
  /** When creating a manual receivable without a sale, pass a dedicated obligation id. */
  obligationIdOverride?: string
}

export type PreparedMoneyObligationCreate = {
  input: CreateMoneyFromSaleInput
  obligationId: string
  skip: boolean
  reason?: string
}

/** Read phase for money-obligation create (all reads). */
export async function prepareMoneyObligationForSaleInTx(
  tx: Transaction,
  db: Firestore,
  input: CreateMoneyFromSaleInput,
): Promise<PreparedMoneyObligationCreate> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid receivable amount.')
  }
  const obligationId = input.obligationIdOverride ?? moneyObligationIdForSale(input.saleId)
  const [oblSnap, originSnap, linkSnap] = await Promise.all([
    tx.get(db.collection('obligations').doc(obligationId)),
    tx.get(originClaimRef(db, input.saleId)),
    tx.get(linkClaimRef(db, obligationId)),
  ])

  if (originSnap.exists) {
    const claim = originSnap.data() as MoneyOriginClaimDoc
    if (claim.status === 'claimed' && claim.obligationId !== obligationId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This sale already has a money obligation claim.',
      )
    }
  }
  if (linkSnap.exists) {
    const claim = linkSnap.data() as MoneyLinkClaimDoc
    if (claim.status === 'claimed' && claim.saleId !== input.saleId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This money obligation is already linked to another sale.',
      )
    }
  }
  if (oblSnap.exists) {
    const existing = oblSnap.data() ?? {}
    if (existing.kind !== 'money') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Obligation id conflicts with a non-money obligation.',
      )
    }
    if (existing.status === 'reversed') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'A reversed money obligation exists for this sale; create a new audited adjustment instead.',
      )
    }
    if (
      Number(existing.originalAmountPaise) === input.amountPaise &&
      existing.originTransactionId === input.saleId
    ) {
      return { input, obligationId, skip: true }
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      'A different money obligation already exists for this sale.',
    )
  }
  return { input, obligationId, skip: false }
}

/** Write phase for money-obligation create (writes only). */
export function commitMoneyObligationForSaleInTx(
  tx: Transaction,
  db: Firestore,
  prepared: PreparedMoneyObligationCreate,
): { obligationId: string; created: boolean } {
  if (prepared.skip) return { obligationId: prepared.obligationId, created: false }
  const { input, obligationId } = prepared
  tx.set(originClaimRef(db, input.saleId), {
    obligationId,
    saleId: input.saleId,
    status: 'claimed',
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })
  tx.set(linkClaimRef(db, obligationId), {
    saleId: input.saleId,
    obligationId,
    status: 'claimed',
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })
  tx.set(db.collection('obligations').doc(obligationId), {
    kind: 'money',
    status: input.amountPaise === 0 ? 'settled' : 'open',
    customerId: input.customerId,
    customerKind: input.customerKind,
    customerName: input.customerName,
    originTransactionId: input.saleId,
    source: input.source,
    businessDate: input.businessDate,
    originalAmountPaise: input.amountPaise,
    settledAmountPaise: 0,
    outstandingAmountPaise: input.amountPaise,
    recordScope: input.recordScope,
    openingSessionId: input.openingSessionId,
    openingGenerationId: input.openingGenerationId,
    linkedBackdatedSaleId: input.saleId,
    createdBy: input.actorUid,
    updatedBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { obligationId, created: true }
}

/**
 * Create a sale-originated money obligation with both uniqueness claims in one transaction.
 * Idempotent when the same obligation id already exists with equal amount/source.
 * Must be used only when no prior writes have occurred in the transaction.
 */
export async function createMoneyObligationForSaleInTx(
  tx: Transaction,
  db: Firestore,
  input: CreateMoneyFromSaleInput,
): Promise<{ obligationId: string; created: boolean }> {
  const prepared = await prepareMoneyObligationForSaleInTx(tx, db, input)
  return commitMoneyObligationForSaleInTx(tx, db, prepared)
}

/**
 * Link an existing money obligation to a sale. Claims both directions atomically.
 */
export async function linkMoneyObligationToSaleInTx(
  tx: Transaction,
  db: Firestore,
  input: {
    saleId: string
    obligationId: string
    expectedCustomerId: string | null
    actorUid: string
  },
): Promise<{ obligationId: string; linked: boolean }> {
  const oblRef = db.collection('obligations').doc(input.obligationId)
  const originRef = originClaimRef(db, input.saleId)
  const linkRef = linkClaimRef(db, input.obligationId)

  const [oblSnap, originSnap, linkSnap] = await Promise.all([
    tx.get(oblRef),
    tx.get(originRef),
    tx.get(linkRef),
  ])

  if (!oblSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Money obligation not found.')
  }
  const obl = oblSnap.data() ?? {}
  if (obl.kind !== 'money') {
    throw new functions.https.HttpsError('failed-precondition', 'Only money obligations can be linked.')
  }
  if (obl.status === 'settled' || obl.status === 'reversed') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Cannot link a settled or reversed money obligation.',
    )
  }
  if (input.expectedCustomerId != null && obl.customerId !== input.expectedCustomerId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Obligation customer does not match the sale customer.',
    )
  }

  if (originSnap.exists) {
    const claim = originSnap.data() as MoneyOriginClaimDoc
    if (claim.status === 'claimed') {
      if (claim.obligationId === input.obligationId) {
        return { obligationId: input.obligationId, linked: false }
      }
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This sale already has a different money obligation claim.',
      )
    }
  }

  if (linkSnap.exists) {
    const claim = linkSnap.data() as MoneyLinkClaimDoc
    if (claim.status === 'claimed') {
      if (claim.saleId === input.saleId) {
        return { obligationId: input.obligationId, linked: false }
      }
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This money obligation is already linked to another sale.',
      )
    }
  }

  tx.set(originRef, {
    obligationId: input.obligationId,
    saleId: input.saleId,
    status: 'claimed',
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })
  tx.set(linkRef, {
    saleId: input.saleId,
    obligationId: input.obligationId,
    status: 'claimed',
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })
  tx.update(oblRef, {
    linkedBackdatedSaleId: input.saleId,
    updatedBy: input.actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { obligationId: input.obligationId, linked: true }
}

/** Mark claims released when reversing a money obligation (does not delete claim history). */
export function releaseMoneyClaimsInTx(
  tx: Transaction,
  db: Firestore,
  input: { saleId: string; obligationId: string; actorUid: string },
): void {
  tx.set(
    originClaimRef(db, input.saleId),
    {
      obligationId: input.obligationId,
      saleId: input.saleId,
      status: 'released',
      createdBy: input.actorUid,
      releasedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  tx.set(
    linkClaimRef(db, input.obligationId),
    {
      saleId: input.saleId,
      obligationId: input.obligationId,
      status: 'released',
      createdBy: input.actorUid,
      releasedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}
