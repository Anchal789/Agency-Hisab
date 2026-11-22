/**
 * Emulator concurrency tests for Phase 5.0 money-obligation uniqueness claims.
 * Uses the same claim document paths/IDs as functions/src/finance/money-obligation-claims.ts.
 * Requires Firestore emulator at 127.0.0.1:8081.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'hisab-money-claims-test'
const EMULATOR_HOST = '127.0.0.1:8081'

async function createMoneyObligation(
  db: Firestore,
  input: {
    saleId: string
    amountPaise: number
    customerId: string
    actorUid: string
  },
) {
  const obligationId = `money_${input.saleId}`
  return db.runTransaction(async (tx) => {
    const oblRef = db.collection('obligations').doc(obligationId)
    const originRef = db.collection('moneyObligationOriginClaims').doc(input.saleId)
    const linkRef = db.collection('moneyObligationLinkClaims').doc(obligationId)
    const [oblSnap, originSnap, linkSnap] = await Promise.all([
      tx.get(oblRef),
      tx.get(originRef),
      tx.get(linkRef),
    ])

    if (originSnap.exists) {
      const claim = originSnap.data() ?? {}
      if (claim.status === 'claimed' && claim.obligationId !== obligationId) {
        throw new Error('sale already claimed')
      }
    }
    if (linkSnap.exists) {
      const claim = linkSnap.data() ?? {}
      if (claim.status === 'claimed' && claim.saleId !== input.saleId) {
        throw new Error('obligation already linked')
      }
    }
    if (oblSnap.exists) {
      const existing = oblSnap.data() ?? {}
      if (existing.kind !== 'money') throw new Error('non-money conflict')
      if (existing.status === 'reversed') throw new Error('reversed money obligation')
      if (
        Number(existing.originalAmountPaise) === input.amountPaise &&
        existing.originTransactionId === input.saleId
      ) {
        return { obligationId, created: false }
      }
      throw new Error('different money obligation already exists')
    }

    tx.set(originRef, {
      obligationId,
      saleId: input.saleId,
      status: 'claimed',
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.set(linkRef, {
      saleId: input.saleId,
      obligationId,
      status: 'claimed',
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.set(oblRef, {
      kind: 'money',
      status: 'open',
      customerId: input.customerId,
      originTransactionId: input.saleId,
      originalAmountPaise: input.amountPaise,
      settledAmountPaise: 0,
      outstandingAmountPaise: input.amountPaise,
      recordScope: 'operational',
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { obligationId, created: true }
  })
}

async function linkMoneyObligation(
  db: Firestore,
  input: { saleId: string; obligationId: string; actorUid: string },
) {
  return db.runTransaction(async (tx) => {
    const oblRef = db.collection('obligations').doc(input.obligationId)
    const originRef = db.collection('moneyObligationOriginClaims').doc(input.saleId)
    const linkRef = db.collection('moneyObligationLinkClaims').doc(input.obligationId)
    const [oblSnap, originSnap, linkSnap] = await Promise.all([
      tx.get(oblRef),
      tx.get(originRef),
      tx.get(linkRef),
    ])
    if (!oblSnap.exists) throw new Error('not found')
    const obl = oblSnap.data() ?? {}
    if (obl.kind !== 'money') throw new Error('not money')
    if (obl.status === 'settled' || obl.status === 'reversed') throw new Error('settled/reversed')

    if (originSnap.exists && originSnap.data()?.status === 'claimed') {
      if (originSnap.data()?.obligationId === input.obligationId) {
        return { linked: false }
      }
      throw new Error('sale already claimed')
    }
    if (linkSnap.exists && linkSnap.data()?.status === 'claimed') {
      if (linkSnap.data()?.saleId === input.saleId) {
        return { linked: false }
      }
      throw new Error('obligation already linked')
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
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { linked: true }
  })
}

describe('money obligation uniqueness (emulator)', () => {
  let app: App

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
    process.env.GCLOUD_PROJECT = PROJECT_ID
    app = initializeApp({ projectId: PROJECT_ID }, 'money-claims-test')
  })

  afterAll(async () => {
    if (getApps().some((a) => a.name === 'money-claims-test')) {
      await deleteApp(app)
    }
  })

  beforeEach(async () => {
    const db = getFirestore(app)
    for (const name of [
      'obligations',
      'moneyObligationOriginClaims',
      'moneyObligationLinkClaims',
    ]) {
      const snap = await db.collection(name).limit(400).get()
      if (snap.empty) continue
      const batch = db.batch()
      snap.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
    }
  })

  it('1 concurrent creates for same sale yield one money obligation', async () => {
    const db = getFirestore(app)
    const saleId = 'sale_concurrent_1'
    const input = { saleId, amountPaise: 10_000, customerId: 'cust1', actorUid: 'admin1' }

    const results = await Promise.allSettled([
      createMoneyObligation(db, input),
      createMoneyObligation(db, input),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)

    const obl = await db.collection('obligations').doc(`money_${saleId}`).get()
    expect(obl.exists).toBe(true)
    expect(obl.data()?.kind).toBe('money')

    const origin = await db.collection('moneyObligationOriginClaims').doc(saleId).get()
    expect(origin.exists).toBe(true)
    expect(origin.data()?.status).toBe('claimed')
    expect(origin.data()?.obligationId).toBe(`money_${saleId}`)
  })

  it('2 two sales cannot claim the same existing obligation', async () => {
    const db = getFirestore(app)
    await db.collection('obligations').doc('money_manual_shared').set({
      kind: 'money',
      status: 'open',
      customerId: 'cust1',
      originalAmountPaise: 50_000,
      settledAmountPaise: 0,
      outstandingAmountPaise: 50_000,
    })

    const results = await Promise.allSettled([
      linkMoneyObligation(db, {
        saleId: 'sale_A',
        obligationId: 'money_manual_shared',
        actorUid: 'admin1',
      }),
      linkMoneyObligation(db, {
        saleId: 'sale_B',
        obligationId: 'money_manual_shared',
        actorUid: 'admin1',
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)

    const link = await db.collection('moneyObligationLinkClaims').doc('money_manual_shared').get()
    expect(link.data()?.status).toBe('claimed')
    expect(['sale_A', 'sale_B']).toContain(link.data()?.saleId)
  })

  it('3 identical create retries are idempotent', async () => {
    const db = getFirestore(app)
    const input = {
      saleId: 'sale_retry',
      amountPaise: 12_000,
      customerId: 'cust1',
      actorUid: 'admin1',
    }
    const first = await createMoneyObligation(db, input)
    const second = await createMoneyObligation(db, input)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.obligationId).toBe(first.obligationId)
  })

  it('4 different amount cannot bypass existing claim', async () => {
    const db = getFirestore(app)
    const saleId = 'sale_conflict'
    await createMoneyObligation(db, {
      saleId,
      amountPaise: 10_000,
      customerId: 'cust1',
      actorUid: 'admin1',
    })
    await expect(
      createMoneyObligation(db, {
        saleId,
        amountPaise: 11_000,
        customerId: 'cust1',
        actorUid: 'admin1',
      }),
    ).rejects.toThrow(/different money obligation/)
  })

  it('5 reverse keeps claim claimed so recreate is blocked', async () => {
    const db = getFirestore(app)
    const saleId = 'sale_rev'
    await createMoneyObligation(db, {
      saleId,
      amountPaise: 10_000,
      customerId: 'cust1',
      actorUid: 'admin1',
    })
    await db.collection('obligations').doc(`money_${saleId}`).update({ status: 'reversed' })
    const claim = await db.collection('moneyObligationOriginClaims').doc(saleId).get()
    expect(claim.data()?.status).toBe('claimed')
    await expect(
      createMoneyObligation(db, {
        saleId,
        amountPaise: 10_000,
        customerId: 'cust1',
        actorUid: 'admin1',
      }),
    ).rejects.toThrow(/reversed money obligation/)
  })

  it('6 empty-cylinder obligations are unaffected by money claim collections', async () => {
    const db = getFirestore(app)
    await db.collection('obligations').doc('empty_saleX').set({
      kind: 'empty_cylinder',
      status: 'open',
      outstanding: 2,
      originTransactionId: 'saleX',
    })
    await createMoneyObligation(db, {
      saleId: 'saleX',
      amountPaise: 5_000,
      customerId: 'cust1',
      actorUid: 'admin1',
    })
    const empty = await db.collection('obligations').doc('empty_saleX').get()
    expect(empty.data()?.kind).toBe('empty_cylinder')
    expect(empty.data()?.outstanding).toBe(2)
    const money = await db.collection('obligations').doc('money_saleX').get()
    expect(money.data()?.kind).toBe('money')
  })
})
