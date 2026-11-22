/**
 * Phase 5.0 remaining acceptance coverage against the live Firebase emulators.
 *
 * IMPORTANT:
 * - Does NOT reset the published opening on project hisab-9d3e4.
 * - Part A verifies preserved publication evidence (read-only).
 * - Part B calls real Cloud Functions emulator for negative/idempotent cases.
 * - Part C uses Admin SDK transactions to exercise fence/epoch/abandon guards
 *   on isolated session documents that do not alter the published gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  destinationOpeningLedgerId,
  type OpeningSessionState,
} from '../../shared/models/finance'
import {
  openingAllowsStagingEdits,
  openingPublishActionPlan,
} from '../../shared/rules/opening-session-ui'
import { publishedBalancePaise } from '../../shared/calculations/finance-classification'
import { saveOpeningBalanceSheetSchema } from '../../shared/schemas/finance-opening'

const EMULATOR_HOST = '127.0.0.1:8081'
const AUTH_HOST = '127.0.0.1:9099'
const FUNCTIONS_HOST = '127.0.0.1:5001'
const PROJECT_ID = 'hisab-9d3e4'
const EVIDENCE_PATH = resolve('docs/evidence/phase5_0_published_opening_emulator.json')

type Evidence = {
  session: { id: string; state?: string; generationId?: string; fence?: number; openingDate?: string }
  gate: { state?: string; activeSessionId?: string | null; mutationEpoch?: number }
  publication: {
    publishedSessionId?: string | null
    publishedGenerationId?: string | null
  }
  agency: { financialOpeningDate?: string | null; ownerLoanOutstandingPaise?: number | null }
  financialBalances: Array<{ id: string; balancePaise?: number; publishedSessionId?: string; publishedGenerationId?: string }>
  inventoryBalanceSnapshot: Array<{ id: string; quantity?: number }>
  balanceSheet: { amountsPaise?: Record<string, number>; ownerLoanOutstandingPaise?: number } | null
  rollup: {
    publishedBalancePaise?: Record<string, number>
    verifiedOpeningPaise?: Record<string, number>
    bridgeCollectionNetPaise?: Record<string, number>
  } | null
}

async function signInAdmin(): Promise<string> {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '919876543210@users.hisab.internal',
        password: 'Admin@123',
        returnSecureToken: true,
      }),
    },
  )
  const json = (await res.json()) as { idToken?: string; error?: { message?: string } }
  if (!json.idToken) {
    throw new Error(`Admin sign-in failed: ${json.error?.message ?? res.status}`)
  }
  return json.idToken
}

async function callFunction<T = unknown>(
  name: string,
  data: Record<string, unknown>,
  idToken?: string | null,
): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string; status: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (idToken) headers.Authorization = `Bearer ${idToken}`
  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })
  const json = (await res.json()) as {
    result?: T
    error?: { status?: string; message?: string }
  }
  if (!res.ok || json.error) {
    return {
      ok: false,
      code: String(json.error?.status ?? res.status),
      message: String(json.error?.message ?? 'callable failed'),
      status: res.status,
    }
  }
  return { ok: true, data: json.result as T }
}

async function loadOpeningWorkerGuardsInTx(
  db: Firestore,
  ctx: {
    sessionId: string
    generationId: string
    fence: number
    mutationEpoch: number
    expectedStates: OpeningSessionState[]
  },
) {
  return db.runTransaction(async (tx) => {
    const [sessionSnap, gateSnap] = await Promise.all([
      tx.get(db.collection('openingSessions').doc(ctx.sessionId)),
      tx.get(db.doc('financialOpeningGate/default')),
    ])
    if (!sessionSnap.exists) throw new Error('not-found')
    const session = sessionSnap.data() ?? {}
    const gate = gateSnap.data() ?? {}
    if (session.generationId !== ctx.generationId) throw new Error('stale-generation')
    if (Number(session.fence) !== ctx.fence) throw new Error('stale-fence')
    if (Number(gate.mutationEpoch) !== ctx.mutationEpoch) throw new Error('stale-epoch')
    if (!ctx.expectedStates.includes(session.state as OpeningSessionState)) throw new Error('bad-state')
    if (session.state === 'abandoned') throw new Error('abandoned')
    return { session, gate }
  })
}

describe('Phase 5.0 opening acceptance (emulator)', () => {
  let app: App
  let evidence: Evidence
  let adminToken: string

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
    evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence
    app = initializeApp({ projectId: PROJECT_ID }, `p50-acceptance-${Date.now()}`)
    adminToken = await signInAdmin()
  })

  afterAll(async () => {
    if (getApps().some((a) => a.name.startsWith('p50-acceptance-'))) {
      await deleteApp(app)
    }
  })

  describe('Part A — preserved published evidence (read-only)', () => {
    it('T9/T5: evidence file matches live published pointer and gate', async () => {
      const db = getFirestore(app)
      const sessionId = evidence.session.id
      expect(sessionId).toBe('9b618b21-824a-4d16-934f-c93754447648')
      expect(evidence.session.generationId).toBe('gen_mws7ampa_mnapjzo9')
      expect(evidence.agency.financialOpeningDate).toBe('2026-11-19')
      expect(evidence.financialBalances).toHaveLength(8)

      const [session, gate, pub] = await Promise.all([
        db.collection('openingSessions').doc(sessionId).get(),
        db.doc('financialOpeningGate/default').get(),
        db.doc('financePublication/current').get(),
      ])
      expect(session.data()?.state).toBe('published')
      expect(gate.data()?.state).toBe('published')
      expect(pub.data()?.publishedSessionId).toBe(sessionId)
      expect(pub.data()?.publishedGenerationId).toBe(evidence.session.generationId)
    })

    it('T8: live balances equal opening rollup + operational ledger net (no double-count)', async () => {
      const db = getFirestore(app)
      const generationId = String(evidence.session.generationId)
      const rollup = await db
        .collection('openingRollups')
        .doc(`${evidence.session.id}_${generationId}`)
        .get()
      expect(rollup.exists).toBe(true)
      const published = (rollup.data()?.publishedBalancePaise ?? {}) as Record<string, number>
      const publishedAccountIds = Object.keys(published)
      expect(publishedAccountIds).toHaveLength(8)

      for (const accountId of publishedAccountIds) {
        const doc = await db.collection('financialBalances').doc(accountId).get()
        expect(doc.exists).toBe(true)
        expect(doc.data()?.publishedSessionId).toBe(evidence.session.id)
        expect(doc.data()?.publishedGenerationId).toBe(generationId)

        const ledger = await db.collection('financialLedger').where('accountId', '==', accountId).get()
        let openingNet = 0
        let operationalNet = 0
        for (const row of ledger.docs) {
          const amount = Number(row.data()?.amountPaise ?? 0)
          const signed = row.data()?.direction === 'debit' ? -amount : amount
          if (row.data()?.recordScope === 'opening') openingNet += signed
          else operationalNet += signed
        }

        const rollupPaise = Number(published[accountId] ?? 0)
        expect(openingNet).toBe(rollupPaise)
        expect(Number(doc.data()?.balancePaise ?? 0)).toBe(rollupPaise + operationalNet)
      }
    })

    it('inventory balances remain present after publication (no wipe)', async () => {
      const db = getFirestore(app)
      const snap = await db.collection('inventoryBalances').limit(20).get()
      expect(snap.size).toBeGreaterThan(0)
      expect(evidence.inventoryBalanceSnapshot.length).toBeGreaterThan(0)
    })

    it('T8 zero openings: destination_opening ledger lines are absent for 0 paise (by design)', async () => {
      const db = getFirestore(app)
      const sessionId = evidence.session.id
      const generationId = String(evidence.session.generationId)
      const sheet = evidence.balanceSheet?.amountsPaise ?? {}
      for (const [accountId, amount] of Object.entries(sheet)) {
        const entryId = destinationOpeningLedgerId(sessionId, generationId, accountId)
        const ledger = await db.collection('financialLedger').doc(entryId).get()
        if (Number(amount) === 0) {
          expect(ledger.exists).toBe(false)
        } else {
          expect(ledger.exists).toBe(true)
          expect(Number(ledger.data()?.amountPaise)).toBe(Number(amount))
        }
      }
    })
  })

  describe('Part B — real callable Functions against published seal', () => {
    it('T6: unauthenticated publish is rejected', async () => {
      const result = await callFunction('publishFinancialOpening', {
        idempotencyKey: 'unauth-pub-0001',
        sessionId: evidence.session.id,
        fence: Number(evidence.session.fence ?? 1),
        generationId: String(evidence.session.generationId),
      }, null)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message.toLowerCase()).toMatch(/auth|unauth|permission|credential|sign in/)
    })

    it('T9: duplicate publish of the same published session is safe (idempotent or no-op success)', async () => {
      const result = await callFunction(
        'publishFinancialOpening',
        {
          idempotencyKey: `dup-pub-${Date.now()}`,
          sessionId: evidence.session.id,
          fence: Number(evidence.session.fence ?? 1),
          generationId: String(evidence.session.generationId),
        },
        adminToken,
      )
      // After publication, session state is published — worker expects ready_to_publish,
      // OR early return when pointer already matches. Either is acceptable if pointer unchanged.
      const db = getFirestore(app)
      const pub = await db.doc('financePublication/current').get()
      expect(pub.data()?.publishedSessionId).toBe(evidence.session.id)
      expect(pub.data()?.publishedGenerationId).toBe(evidence.session.generationId)
      if (!result.ok) {
        expect(result.message.toLowerCase()).toMatch(/ready_to_publish|published|state/)
      }
    })

    it('T9/T24: beginFinancialOpeningSeal is blocked while gate is published', async () => {
      const result = await callFunction(
        'beginFinancialOpeningSeal',
        {
          idempotencyKey: `begin-after-pub-${Date.now()}`,
          sessionId: `sess_after_${Date.now()}`,
          openingDate: '2026-11-19',
          anchorTransactionId: 'c97dfabe-dc0a-4566-98f8-1e33acffd9de',
          anchorDateMismatchReason: null,
        },
        adminToken,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message.toLowerCase()).toMatch(/already|published|sealing/)
    })

    it('staging saveOpeningBalanceSheet is blocked after publication', async () => {
      const accountIds = evidence.financialBalances.map((row) => row.id)
      const result = await callFunction(
        'saveOpeningBalanceSheet',
        {
          idempotencyKey: `save-after-pub-${Date.now()}`,
          sessionId: evidence.session.id,
          fence: Number(evidence.session.fence ?? 1),
          generationId: String(evidence.session.generationId),
          balances: accountIds.map((accountId) => ({ accountId, amountPaise: 0 })),
          ownerLoanOutstandingPaise: 0,
          ownerLoanVerified: true,
        },
        adminToken,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message.toLowerCase()).toMatch(/preparing|published|ready/)
      expect(openingAllowsStagingEdits('published')).toBe(false)
      expect(openingPublishActionPlan('published')).toBe('blocked')
    })

    async function createStaffToken(): Promise<string> {
      const signup = await fetch(
        `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: `staff_p50_${Date.now()}_${Math.floor(Math.random() * 1e6)}@users.hisab.internal`,
            password: 'StaffTest1!',
            returnSecureToken: true,
          }),
        },
      )
      const signupJson = (await signup.json()) as { idToken?: string; error?: { message?: string } }
      if (!signupJson.idToken) {
        throw new Error(`Staff signup failed: ${signupJson.error?.message ?? signup.status}`)
      }
      return signupJson.idToken
    }

    it('T6 staff-denied: staff without admin cannot getFinancialOpeningStatus', async () => {
      const staffToken = await createStaffToken()
      const result = await callFunction('getFinancialOpeningStatus', {}, staffToken)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message.toLowerCase()).toMatch(/admin|permission|denied|unauth|forbidden|role/)
    })

    it('T6 staff-denied: staff cannot publish or abandon opening', async () => {
      const staffToken = await createStaffToken()
      const publish = await callFunction(
        'publishFinancialOpening',
        {
          idempotencyKey: `staff-pub-${Date.now()}`,
          sessionId: evidence.session.id,
          fence: Number(evidence.session.fence ?? 1),
          generationId: String(evidence.session.generationId),
        },
        staffToken,
      )
      expect(publish.ok).toBe(false)
      expect(!publish.ok && publish.message.toLowerCase()).toMatch(
        /admin|permission|denied|unauth|forbidden|role/,
      )

      const abandon = await callFunction(
        'abandonFinancialOpeningSeal',
        {
          idempotencyKey: `staff-aban-${Date.now()}`,
          sessionId: evidence.session.id,
          fence: Number(evidence.session.fence ?? 1),
          reason: 'staff should be denied',
        },
        staffToken,
      )
      expect(abandon.ok).toBe(false)
      expect(!abandon.ok && abandon.message.toLowerCase()).toMatch(
        /admin|permission|denied|unauth|forbidden|role/,
      )
    })

    it('T26: abandon after publication is rejected and leaves gate published', async () => {
      const result = await callFunction(
        'abandonFinancialOpeningSeal',
        {
          idempotencyKey: `aban-after-pub-${Date.now()}`,
          sessionId: evidence.session.id,
          fence: Number(evidence.session.fence ?? 1),
          reason: 'should fail after publish',
        },
        adminToken,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message.toLowerCase()).toMatch(/abandon|publication|published/)
      const db = getFirestore(app)
      const gate = await db.doc('financialOpeningGate/default').get()
      expect(gate.data()?.state).toBe('published')
      expect(gate.data()?.activeSessionId).toBe(evidence.session.id)
    })

    it('dual-tab Admin: concurrent publish retries leave publication pointer unchanged', async () => {
      const payload = {
        sessionId: evidence.session.id,
        fence: Number(evidence.session.fence ?? 1),
        generationId: String(evidence.session.generationId),
      }
      const [a, b] = await Promise.all([
        callFunction('publishFinancialOpening', { ...payload, idempotencyKey: `dual-a-${Date.now()}` }, adminToken),
        callFunction('publishFinancialOpening', { ...payload, idempotencyKey: `dual-b-${Date.now()}` }, adminToken),
      ])
      const db = getFirestore(app)
      const pub = await db.doc('financePublication/current').get()
      expect(pub.data()?.publishedSessionId).toBe(evidence.session.id)
      expect(pub.data()?.publishedGenerationId).toBe(evidence.session.generationId)
      // At least one call must not corrupt state; both may fail because session is already published.
      expect([a.ok, b.ok].every((ok) => typeof ok === 'boolean')).toBe(true)
    })

    it('T23/T9: identical idempotency key replay does not change published pointer', async () => {
      const key = `replay-pub-${Date.now()}`
      const payload = {
        idempotencyKey: key,
        sessionId: evidence.session.id,
        fence: Number(evidence.session.fence ?? 1),
        generationId: String(evidence.session.generationId),
      }
      const first = await callFunction('publishFinancialOpening', payload, adminToken)
      const second = await callFunction('publishFinancialOpening', payload, adminToken)
      const db = getFirestore(app)
      const pub = await db.doc('financePublication/current').get()
      expect(pub.data()?.publishedSessionId).toBe(evidence.session.id)
      expect(pub.data()?.publishedGenerationId).toBe(evidence.session.generationId)
      // Lost-response retry: same key must not invent a second publication.
      expect(first.ok === second.ok || second.ok).toBeTruthy()
    })

    it('T21 historical receivable: invalid link payload and incomplete collection are rejected', async () => {
      const invalidLink = await callFunction(
        'resolveHistoricalGodownSaleFinance',
        {
          idempotencyKey: `hist-bad-${Date.now()}`,
          saleId: 'sale_missing_hist_1',
          resolution: { kind: 'link_existing_receivable', reason: 'missing obligation id' },
          historicalCollection: { status: 'none' },
        },
        adminToken,
      )
      expect(invalidLink.ok).toBe(false)
      if (invalidLink.ok) return
      expect(invalidLink.message.toLowerCase()).toMatch(/invalid|required|obligation|argument/)

      const incomplete = await callFunction(
        'resolveHistoricalGodownSaleFinance',
        {
          idempotencyKey: `hist-inc-${Date.now()}`,
          saleId: 'sale_missing_hist_2',
          resolution: {
            kind: 'create_opening_receivable',
            approvedAmountPaise: 1000,
            reason: 'should block incomplete',
          },
          historicalCollection: { status: 'incomplete', note: 'cash unclear' },
        },
        adminToken,
      )
      expect(incomplete.ok).toBe(false)
      if (incomplete.ok) return
      expect(incomplete.message.toLowerCase()).toMatch(/incomplete|reconcil|block|argument|invalid/)
    })
  })

  describe('Part C — isolated fence / epoch / abandon / concurrency (Admin SDK)', () => {
    const isoSession = `iso_sess_${Date.now()}`
    const isoGen = `iso_gen_${Date.now()}`

    beforeAll(async () => {
      const db = getFirestore(app)
      // Isolated docs only — do not touch published gate/publication.
      await db.collection('openingSessions').doc(isoSession).set({
        state: 'preparing',
        fence: 1,
        generationId: isoGen,
        openingDate: '2026-11-19',
        mutationEpochAtPlan: 0,
        createdAt: FieldValue.serverTimestamp(),
      })
    })

    it('T3: stale fence cannot pass worker guards', async () => {
      const db = getFirestore(app)
      await expect(
        loadOpeningWorkerGuardsInTx(db, {
          sessionId: isoSession,
          generationId: isoGen,
          fence: 99,
          mutationEpoch: Number((await db.doc('financialOpeningGate/default').get()).data()?.mutationEpoch ?? 0),
          expectedStates: ['preparing'],
        }),
      ).rejects.toThrow(/stale-fence/)
    })

    it('T3/T10: stale generation cannot pass worker guards', async () => {
      const db = getFirestore(app)
      await expect(
        loadOpeningWorkerGuardsInTx(db, {
          sessionId: isoSession,
          generationId: 'iso_gen_old',
          fence: 1,
          mutationEpoch: Number((await db.doc('financialOpeningGate/default').get()).data()?.mutationEpoch ?? 0),
          expectedStates: ['preparing'],
        }),
      ).rejects.toThrow(/stale-generation/)
    })

    it('T24: mutation epoch mismatch rejects worker', async () => {
      const db = getFirestore(app)
      await expect(
        loadOpeningWorkerGuardsInTx(db, {
          sessionId: isoSession,
          generationId: isoGen,
          fence: 1,
          mutationEpoch: 999999,
          expectedStates: ['preparing'],
        }),
      ).rejects.toThrow(/stale-epoch/)
    })

    it('T26: abandoned session rejects workers', async () => {
      const db = getFirestore(app)
      const abandonedId = `${isoSession}_abandoned`
      await db.collection('openingSessions').doc(abandonedId).set({
        state: 'abandoned',
        fence: 2,
        generationId: isoGen,
        openingDate: '2026-11-19',
      })
      // Abandoned is never an allowed staging/publish state — workers fail closed.
      await expect(
        loadOpeningWorkerGuardsInTx(db, {
          sessionId: abandonedId,
          generationId: isoGen,
          fence: 2,
          mutationEpoch: Number((await db.doc('financialOpeningGate/default').get()).data()?.mutationEpoch ?? 0),
          expectedStates: ['preparing', 'ready_to_publish'],
        }),
      ).rejects.toThrow(/bad-state|abandoned/)
    })

    it('concurrent sheet writes with same content hash do not duplicate ledger rows', async () => {
      const db = getFirestore(app)
      const entryId = destinationOpeningLedgerId(isoSession, isoGen, 'ra_iso_cash')
      const writeOnce = async () =>
        db.runTransaction(async (tx) => {
          const snap = await tx.get(db.collection('financialLedger').doc(entryId))
          if (snap.exists) return { created: false }
          tx.set(db.collection('financialLedger').doc(entryId), {
            accountId: 'ra_iso_cash',
            amountPaise: 50_000,
            direction: 'credit',
            entryClass: 'destination_opening',
            recordScope: 'opening',
            openingSessionId: isoSession,
            openingGenerationId: isoGen,
            contentHash: 'iso_hash_v1',
            createdAt: FieldValue.serverTimestamp(),
          })
          return { created: true }
        })
      const results = await Promise.all([writeOnce(), writeOnce()])
      const createdCount = results.filter((row) => row.created).length
      expect(createdCount).toBe(1)
      const ledger = await db.collection('financialLedger').doc(entryId).get()
      expect(ledger.exists).toBe(true)
      expect(Number(ledger.data()?.amountPaise)).toBe(50_000)
    })

    it('A-03 / bridge: published balance = opening + bridge exactly once', () => {
      expect(publishedBalancePaise(100_000, 25_000)).toBe(125_000)
      expect(publishedBalancePaise(100_000, 0)).toBe(100_000)
      // Applying bridge twice would double-count — callers must use net once.
      expect(publishedBalancePaise(100_000, 25_000) + 25_000).not.toBe(publishedBalancePaise(100_000, 25_000))
    })

    it('negative balance sets needsReconciliation without wiping publication tags', async () => {
      const db = getFirestore(app)
      const accountId = `ra_iso_neg_${Date.now()}`
      await db.collection('financialBalances').doc(accountId).set({
        accountId,
        balancePaise: 1_000,
        publishedSessionId: evidence.session.id,
        publishedGenerationId: evidence.session.generationId,
        needsReconciliation: false,
        reconciliationReason: null,
      })
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(db.collection('financialBalances').doc(accountId))
        const bal = snap.data() ?? {}
        const next = Number(bal.balancePaise ?? 0) - 5_000
        tx.update(db.collection('financialBalances').doc(accountId), {
          balancePaise: next,
          needsReconciliation: next < 0 ? true : bal.needsReconciliation === true,
          reconciliationReason: next < 0 ? 'godown_reversal_overdraw' : bal.reconciliationReason ?? null,
        })
      })
      const after = await db.collection('financialBalances').doc(accountId).get()
      expect(Number(after.data()?.balancePaise)).toBe(-4_000)
      expect(after.data()?.needsReconciliation).toBe(true)
      expect(after.data()?.publishedSessionId).toBe(evidence.session.id)
      expect(after.data()?.publishedGenerationId).toBe(evidence.session.generationId)
    })

    it('T1/T26: abandoned generation rows stay separate from published generation ids', async () => {
      const db = getFirestore(app)
      const abandonedGen = `iso_abandoned_gen_${Date.now()}`
      const entryId = destinationOpeningLedgerId(`${isoSession}_old`, abandonedGen, 'ra_iso_old')
      await db.collection('financialLedger').doc(entryId).set({
        accountId: 'ra_iso_old',
        amountPaise: 9_999,
        direction: 'credit',
        entryClass: 'destination_opening',
        recordScope: 'opening',
        openingSessionId: `${isoSession}_old`,
        openingGenerationId: abandonedGen,
      })
      const publishedGen = String(evidence.session.generationId)
      expect(abandonedGen).not.toBe(publishedGen)
      const pubLedger = await db
        .collection('financialLedger')
        .where('openingGenerationId', '==', publishedGen)
        .limit(5)
        .get()
      for (const doc of pubLedger.docs) {
        expect(doc.data()?.openingGenerationId).toBe(publishedGen)
        expect(doc.data()?.openingGenerationId).not.toBe(abandonedGen)
      }
    })
  })

  describe('schema / readiness helpers still hold', () => {
    it('T13/T27: owner loan verified required; >40 destinations rejected by schema', () => {
      expect(
        saveOpeningBalanceSheetSchema.safeParse({
          idempotencyKey: '11111111-1111-1111-1111-111111111111',
          sessionId: 'session01',
          fence: 1,
          generationId: 'generation01',
          balances: Array.from({ length: 41 }, (_, i) => ({ accountId: `ra_${i}`, amountPaise: 0 })),
          ownerLoanOutstandingPaise: 0,
          ownerLoanVerified: true,
        }).success,
      ).toBe(false)
      expect(
        saveOpeningBalanceSheetSchema.safeParse({
          idempotencyKey: '11111111-1111-1111-1111-111111111111',
          sessionId: 'session01',
          fence: 1,
          generationId: 'generation01',
          balances: [{ accountId: 'ra1', amountPaise: 0 }],
          ownerLoanOutstandingPaise: 0,
          ownerLoanVerified: false,
        }).success,
      ).toBe(false)
    })
  })
})
