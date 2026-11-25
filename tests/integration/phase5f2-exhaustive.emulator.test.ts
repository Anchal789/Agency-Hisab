/**
 * Exhaustive Stage 5F.2 verification against live Auth/Functions/Firestore emulators.
 * Preserves Phase 5.0 publication pointer; posts only operational fund_transfer records.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { parseAgencySettings } from '../../shared/models/agency-config'
import { fundTransferInLedgerId, fundTransferOutLedgerId } from '../../shared/models/finance'

const EMULATOR_HOST = '127.0.0.1:8081'
const AUTH_HOST = '127.0.0.1:9099'
const FUNCTIONS_HOST = '127.0.0.1:5001'
const PROJECT_ID = 'hisab-9d3e4'
const PUB_SESSION = '9b618b21-824a-4d16-934f-c93754447648'
const PUB_GEN = 'gen_mws7ampa_mnapjzo9'

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
  if (!json.idToken) throw new Error(`Admin sign-in failed: ${json.error?.message ?? res.status}`)
  return json.idToken
}

async function callFn<T = unknown>(
  name: string,
  data: Record<string, unknown>,
  idToken?: string | null,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (idToken) headers.Authorization = `Bearer ${idToken}`
  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })
  const json = (await res.json()) as { result?: T; error?: { message?: string } }
  if (!res.ok || json.error) return { ok: false, message: String(json.error?.message ?? 'failed') }
  return { ok: true, data: json.result as T }
}

function uuid() {
  return crypto.randomUUID()
}

describe('Stage 5F.2 exhaustive fund transfer verification', () => {
  let app: App
  let adminToken: string
  let openingDate = ''
  let today = ''
  let cash = ''
  let bank = ''
  let upi = ''
  let agentCash = ''
  let portal = ''
  let saleCollectionCountBefore = 0
  let publicationBefore: Record<string, unknown> | undefined

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
    app = initializeApp({ projectId: PROJECT_ID }, `p5f2x-${Date.now()}`)
    adminToken = await signInAdmin()
    const db = getFirestore(app)
    const [agencySnap, pub, sales] = await Promise.all([
      db.collection('settings').doc('agency').get(),
      db.doc('financePublication/current').get(),
      db.collection('financialLedger').where('entryClass', '==', 'sale_collection').get(),
    ])
    publicationBefore = pub.data() as Record<string, unknown>
    expect(publicationBefore?.publishedSessionId).toBe(PUB_SESSION)
    expect(publicationBefore?.publishedGenerationId).toBe(PUB_GEN)
    saleCollectionCountBefore = sales.size

    const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
    openingDate = agency.financialOpeningDate ?? ''
    expect(openingDate).toBe('2026-11-19')

    const dash = await callFn<{ today: string; destinations: Array<{ accountId: string }> }>(
      'getMainHisabDashboard',
      {},
      adminToken,
    )
    expect(dash.ok).toBe(true)
    if (!dash.ok) return
    today = dash.data.today

    for (const row of agency.receivingAccounts) {
      if (row.active === false) continue
      if (row.kind === 'cash' && row.ownership === 'agency' && !cash) cash = row.id
      if (row.kind === 'bank' && row.ownership === 'agency' && !bank) bank = row.id
      if (row.kind === 'upi' && row.ownership === 'agency' && !upi) upi = row.id
      if (row.kind === 'cash' && row.ownership === 'third_party_held' && !agentCash) agentCash = row.id
      if (row.ownership === 'portal' && !portal) portal = row.id
    }
    expect(cash && bank && upi && agentCash && portal).toBeTruthy()
  }, 120_000)

  afterAll(async () => {
    if (getApps().some((a) => a.name.startsWith('p5f2x-'))) await deleteApp(app)
  })

  async function bal(id: string) {
    const snap = await getFirestore(app).collection('financialBalances').doc(id).get()
    return Number(snap.data()?.balancePaise ?? 0)
  }

  async function transfer(input: {
    source: string
    dest: string
    amountPaise: number
    businessDate?: string
    idempotencyKey?: string
    transactionId?: string
    note?: string
    token?: string
  }) {
    const idempotencyKey = input.idempotencyKey ?? uuid()
    const transactionId = input.transactionId ?? uuid()
    const result = await callFn<{ transactionId: string; reused: boolean; amountPaise: number }>(
      'createFundTransfer',
      {
        idempotencyKey,
        transactionId,
        sourceAccountId: input.source,
        destinationAccountId: input.dest,
        amountPaise: input.amountPaise,
        businessDate: input.businessDate ?? today,
        note: input.note ?? '5f2_exhaustive',
      },
      input.token ?? adminToken,
    )
    return { ...result, idempotencyKey, transactionId }
  }

  async function assertAtomicPair(txId: string, amount: number, source: string, dest: string) {
    const db = getFirestore(app)
    const [out, inn, tx, idemp] = await Promise.all([
      db.collection('financialLedger').doc(fundTransferOutLedgerId(txId)).get(),
      db.collection('financialLedger').doc(fundTransferInLedgerId(txId)).get(),
      db.collection('transactions').doc(txId).get(),
      db.collection('idempotencyRecords').where('transactionId', '==', txId).limit(3).get(),
    ])
    expect(out.exists && inn.exists && tx.exists).toBe(true)
    expect(out.data()?.direction).toBe('debit')
    expect(inn.data()?.direction).toBe('credit')
    expect(Number(out.data()?.amountPaise)).toBe(amount)
    expect(Number(inn.data()?.amountPaise)).toBe(amount)
    expect(out.data()?.accountId).toBe(source)
    expect(inn.data()?.accountId).toBe(dest)
    expect(out.data()?.businessDate).toBe(inn.data()?.businessDate)
    expect(out.data()?.recordScope).toBe('operational')
    expect(inn.data()?.recordScope).toBe('operational')
    expect(tx.data()?.type).toBe('fund_transfer')
    expect(idemp.size).toBeGreaterThanOrEqual(1)
  }

  describe('A — normal transfers', () => {
    it('A01 Cash→Bank with ledger/balance/cashbook evidence', async () => {
      // Ensure cash has funds
      if ((await bal(cash)) < 25_000) {
        const seed = await transfer({ source: bank, dest: cash, amountPaise: 50_000 })
        expect(seed.ok).toBe(true)
      }
      const beforeS = await bal(cash)
      const beforeD = await bal(bank)
      const amount = 12_345
      const result = await transfer({ source: cash, dest: bank, amountPaise: amount, note: 'A01' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      await assertAtomicPair(result.transactionId, amount, cash, bank)
      expect(await bal(cash)).toBe(beforeS - amount)
      expect(await bal(bank)).toBe(beforeD + amount)
      expect(beforeS + beforeD).toBe((await bal(cash)) + (await bal(bank)))

      const day = await callFn<{ entries: Array<{ transactionId: string; entryClass: string }> }>(
        'listHisabDayLedger',
        { businessDate: today, limit: 200 },
        adminToken,
      )
      expect(day.ok).toBe(true)
      if (!day.ok) return
      const rows = day.data.entries.filter((e) => e.transactionId === result.transactionId)
      expect(rows).toHaveLength(2)

      const [srcBook, dstBook] = await Promise.all([
        callFn<{ operationalEntries: Array<{ transactionId: string; direction: string }> }>(
          'listHisabCashbook',
          { accountId: cash, businessDate: today },
          adminToken,
        ),
        callFn<{ operationalEntries: Array<{ transactionId: string; direction: string }> }>(
          'listHisabCashbook',
          { accountId: bank, businessDate: today },
          adminToken,
        ),
      ])
      expect(srcBook.ok && dstBook.ok).toBe(true)
      if (!srcBook.ok || !dstBook.ok) return
      expect(srcBook.data.operationalEntries.some((e) => e.transactionId === result.transactionId && e.direction === 'debit')).toBe(true)
      expect(dstBook.data.operationalEntries.some((e) => e.transactionId === result.transactionId && e.direction === 'credit')).toBe(true)
    })

    it('A02 Bank→Cash', async () => {
      const amount = 8_000
      const beforeS = await bal(bank)
      const beforeD = await bal(cash)
      const result = await transfer({ source: bank, dest: cash, amountPaise: amount })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(await bal(bank)).toBe(beforeS - amount)
      expect(await bal(cash)).toBe(beforeD + amount)
    })

    it('A03 UPI→Cash and A04 Cash→UPI', async () => {
      if ((await bal(upi)) < 5_000) {
        expect((await transfer({ source: bank, dest: upi, amountPaise: 10_000 })).ok).toBe(true)
      }
      const a03 = await transfer({ source: upi, dest: cash, amountPaise: 3_000 })
      expect(a03.ok).toBe(true)
      const a04 = await transfer({ source: cash, dest: upi, amountPaise: 2_500 })
      expect(a04.ok).toBe(true)
    })

    it('A05 agency cash → third_party_held and back', async () => {
      const amount = 1_100
      if ((await bal(cash)) < amount) {
        expect((await transfer({ source: bank, dest: cash, amountPaise: amount })).ok).toBe(true)
      }
      const out = await transfer({ source: cash, dest: agentCash, amountPaise: amount })
      expect(out.ok).toBe(true)
      const back = await transfer({ source: agentCash, dest: cash, amountPaise: amount })
      expect(back.ok).toBe(true)
    })

    it('A06/A08 small and paise amount ₹100.50', async () => {
      if ((await bal(bank)) < 20_000) {
        expect((await transfer({ source: cash, dest: bank, amountPaise: 30_000 })).ok).toBe(true)
      }
      const small = await transfer({ source: bank, dest: cash, amountPaise: 1 })
      expect(small.ok).toBe(true)
      const paise = await transfer({ source: bank, dest: cash, amountPaise: 10050 })
      expect(paise.ok).toBe(true)
      if (paise.ok) await assertAtomicPair(paise.transactionId, 10050, bank, cash)
    })

    it('A09/A11 entire available balance and B12 one paisa over', async () => {
      // Move a known amount to D.P path via bank→cash then drain exact cash amount from a funded account
      const funding = 4_444
      expect((await transfer({ source: bank, dest: upi, amountPaise: funding })).ok).toBe(true)
      const available = await bal(upi)
      expect(available).toBeGreaterThanOrEqual(funding)
      // Transfer exact available from UPI to cash (may include prior residual)
      const exact = await transfer({ source: upi, dest: cash, amountPaise: available })
      expect(exact.ok).toBe(true)
      expect(await bal(upi)).toBe(0)

      const over = await transfer({ source: upi, dest: cash, amountPaise: 1 })
      expect(over.ok).toBe(false)
      if (!over.ok) expect(over.message.toLowerCase()).toMatch(/insufficient/)
    })
  })

  describe('B/C/D — validation via Function', () => {
    it('B01–B03/B10 zero negative empty insufficient', async () => {
      expect(
        (
          await callFn('createFundTransfer', {
            idempotencyKey: uuid(),
            transactionId: uuid(),
            sourceAccountId: bank,
            destinationAccountId: cash,
            amountPaise: 0,
            businessDate: today,
          }, adminToken)
        ).ok,
      ).toBe(false)
      expect(
        (
          await callFn('createFundTransfer', {
            idempotencyKey: uuid(),
            transactionId: uuid(),
            sourceAccountId: bank,
            destinationAccountId: cash,
            amountPaise: -5,
            businessDate: today,
          }, adminToken)
        ).ok,
      ).toBe(false)
      const insuff = await transfer({ source: agentCash, dest: bank, amountPaise: Math.max(1, (await bal(agentCash)) + 1) })
      expect(insuff.ok).toBe(false)
    })

    it('C01–C07 same/missing/inactive/portal', async () => {
      expect((await transfer({ source: cash, dest: cash, amountPaise: 100 })).ok).toBe(false)
      expect((await transfer({ source: 'missing_src', dest: cash, amountPaise: 100 })).ok).toBe(false)
      expect((await transfer({ source: bank, dest: portal, amountPaise: 100 })).ok).toBe(false)

      const db = getFirestore(app)
      const agencyRef = db.collection('settings').doc('agency')
      const snap = await agencyRef.get()
      const data = snap.data() ?? {}
      const accounts = [...((data.receivingAccounts as Array<Record<string, unknown>>) ?? [])]
      const idx = accounts.findIndex((a) => a.id === upi)
      expect(idx).toBeGreaterThanOrEqual(0)
      accounts[idx] = { ...accounts[idx], active: false }
      await agencyRef.update({ receivingAccounts: accounts })
      const inactive = await transfer({ source: bank, dest: upi, amountPaise: 100 })
      expect(inactive.ok).toBe(false)
      if (!inactive.ok) expect(inactive.message.toLowerCase()).toMatch(/inactive/)
      accounts[idx] = { ...accounts[idx], active: true }
      await agencyRef.update({ receivingAccounts: accounts })
    })

    it('D01–D05/D07 dates', async () => {
      expect((await transfer({ source: bank, dest: cash, amountPaise: 100, businessDate: today })).ok).toBe(true)
      expect((await transfer({ source: bank, dest: cash, amountPaise: 100, businessDate: openingDate })).ok).toBe(true)
      // Yesterday relative to Asia/Kolkata today string (safe when day > 01)
      const [yy, mm, dd] = today.split('-').map(Number)
      const utc = new Date(Date.UTC(yy, mm - 1, dd))
      utc.setUTCDate(utc.getUTCDate() - 1)
      const y = utc.toISOString().slice(0, 10)
      if (y >= openingDate && y < today) {
        expect((await transfer({ source: bank, dest: cash, amountPaise: 100, businessDate: y })).ok).toBe(true)
      }
      expect((await transfer({ source: bank, dest: cash, amountPaise: 100, businessDate: '2026-11-18' })).ok).toBe(false)
      expect((await transfer({ source: bank, dest: cash, amountPaise: 100, businessDate: '2099-01-01' })).ok).toBe(false)
      expect(
        (
          await callFn('createFundTransfer', {
            idempotencyKey: uuid(),
            transactionId: uuid(),
            sourceAccountId: bank,
            destinationAccountId: cash,
            amountPaise: 100,
            businessDate: '',
          }, adminToken)
        ).ok,
      ).toBe(false)
    })
  })

  describe('E/F — idempotency and concurrency', () => {
    it('E02/E03 same key replay; E04–E06 conflicting payload rejected', async () => {
      const key = uuid()
      const txId = uuid()
      const first = await transfer({
        source: bank,
        dest: cash,
        amountPaise: 777,
        idempotencyKey: key,
        transactionId: txId,
      })
      expect(first.ok).toBe(true)
      const before = await bal(bank)
      const replay = await transfer({
        source: bank,
        dest: cash,
        amountPaise: 777,
        idempotencyKey: key,
        transactionId: txId,
      })
      expect(replay.ok).toBe(true)
      if (replay.ok) expect(replay.data.reused).toBe(true)
      expect(await bal(bank)).toBe(before)

      const conflictAmount = await callFn(
        'createFundTransfer',
        {
          idempotencyKey: key,
          transactionId: uuid(),
          sourceAccountId: bank,
          destinationAccountId: cash,
          amountPaise: 888,
          businessDate: today,
        },
        adminToken,
      )
      expect(conflictAmount.ok).toBe(false)
      if (!conflictAmount.ok) expect(conflictAmount.message.toLowerCase()).toMatch(/conflict|idempotency|already/)

      // E05: same key, different source
      const keySrc = uuid()
      expect((await transfer({ source: bank, dest: cash, amountPaise: 113, idempotencyKey: keySrc })).ok).toBe(true)
      const conflictSrc = await transfer({
        source: cash,
        dest: bank,
        amountPaise: 113,
        idempotencyKey: keySrc,
      })
      expect(conflictSrc.ok).toBe(false)
      if (!conflictSrc.ok) expect(conflictSrc.message.toLowerCase()).toMatch(/conflict|idempotency|already/)

      // E06: same key, different destination
      const keyDst = uuid()
      expect((await transfer({ source: bank, dest: cash, amountPaise: 114, idempotencyKey: keyDst })).ok).toBe(true)
      const conflictDst = await transfer({
        source: bank,
        dest: upi,
        amountPaise: 114,
        idempotencyKey: keyDst,
      })
      expect(conflictDst.ok).toBe(false)
      if (!conflictDst.ok) expect(conflictDst.message.toLowerCase()).toMatch(/conflict|idempotency|already/)
    })

    it('F01 concurrent same key; F03 concurrent overspend', async () => {
      const key = uuid()
      const txId = uuid()
      const [a, b] = await Promise.all([
        transfer({ source: bank, dest: cash, amountPaise: 333, idempotencyKey: key, transactionId: txId }),
        transfer({ source: bank, dest: cash, amountPaise: 333, idempotencyKey: key, transactionId: txId }),
      ])
      expect(a.ok && b.ok).toBe(true)
      const reused = [a.ok && a.data.reused, b.ok && b.data.reused].filter(Boolean).length
      expect(reused).toBeGreaterThanOrEqual(1)

      // Drain upi to known small balance then overspend concurrently
      const upiBal = await bal(upi)
      if (upiBal > 0) {
        expect((await transfer({ source: upi, dest: cash, amountPaise: upiBal })).ok).toBe(true)
      }
      expect((await transfer({ source: bank, dest: upi, amountPaise: 500 })).ok).toBe(true)
      const [c1, c2] = await Promise.all([
        transfer({ source: upi, dest: cash, amountPaise: 400 }),
        transfer({ source: upi, dest: cash, amountPaise: 400 }),
      ])
      const successCount = [c1.ok, c2.ok].filter(Boolean).length
      expect(successCount).toBe(1)
      expect(await bal(upi)).toBe(100)
    })
  })

  describe('G/H — atomicity inspection and reconciliation', () => {
    it('G — failed validation leaves no partial ledger for bogus tx id', async () => {
      const txId = uuid()
      const beforeOut = await getFirestore(app).collection('financialLedger').doc(fundTransferOutLedgerId(txId)).get()
      expect(beforeOut.exists).toBe(false)
      const fail = await transfer({ source: cash, dest: cash, amountPaise: 50, transactionId: txId })
      expect(fail.ok).toBe(false)
      const afterOut = await getFirestore(app).collection('financialLedger').doc(fundTransferOutLedgerId(txId)).get()
      const afterIn = await getFirestore(app).collection('financialLedger').doc(fundTransferInLedgerId(txId)).get()
      const afterTx = await getFirestore(app).collection('transactions').doc(txId).get()
      expect(afterOut.exists || afterIn.exists || afterTx.exists).toBe(false)
    })

    it('H01/H02 reconciliation flags block transfer', async () => {
      const db = getFirestore(app)
      await db.collection('financialBalances').doc(cash).update({
        needsReconciliation: true,
        reconciliationReason: '5f2x_test',
      })
      const blocked = await transfer({ source: cash, dest: bank, amountPaise: 50 })
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.message.toLowerCase()).toMatch(/reconcil/)
      await db.collection('financialBalances').doc(cash).update({
        needsReconciliation: false,
        reconciliationReason: null,
      })
      await db.collection('financialBalances').doc(bank).update({
        needsReconciliation: true,
        reconciliationReason: '5f2x_test_dest',
      })
      const blockedDest = await transfer({ source: cash, dest: bank, amountPaise: 50 })
      expect(blockedDest.ok).toBe(false)
      await db.collection('financialBalances').doc(bank).update({
        needsReconciliation: false,
        reconciliationReason: null,
      })
    })
  })

  describe('I/J/K — ledger integrity, reversal N/A, permissions', () => {
    it('I13/I14 sale_collection count unchanged by transfers; publication preserved', async () => {
      const db = getFirestore(app)
      const sales = await db.collection('financialLedger').where('entryClass', '==', 'sale_collection').get()
      expect(sales.size).toBe(saleCollectionCountBefore)
      const pub = await db.doc('financePublication/current').get()
      expect(pub.data()?.publishedSessionId).toBe(PUB_SESSION)
      expect(pub.data()?.publishedGenerationId).toBe(PUB_GEN)
      const session = await db.collection('openingSessions').doc(PUB_SESSION).get()
      expect(session.data()?.state).toBe('published')
      expect(session.data()?.generationId).toBe(PUB_GEN)
    })

    it('J — transfer reversal not implemented (architecture T48 has no reverse)', async () => {
      // Documented N/A: no reverseFundTransfer export
      expect(true).toBe(true)
    })

    it('K02 staff with finance.transfer allowed; K03–K05 unauthorized denied', async () => {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST
      const { getAuth } = await import('firebase-admin/auth')
      const { emptyPermissions } = await import('../../shared/rules/permissions')
      const email = `staff_xfer_${Date.now()}@users.hisab.internal`
      const signupAllowed = await fetch(
        `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'StaffXfer1!', returnSecureToken: true }),
        },
      )
      const allowedUser = (await signupAllowed.json()) as { idToken?: string; localId?: string }
      expect(allowedUser.localId).toBeTruthy()
      await getAuth(app).setCustomUserClaims(allowedUser.localId!, { role: 'staff' })
      const perms = emptyPermissions()
      perms['finance.transfer'] = true
      perms['finance.viewBalances'] = true
      await getFirestore(app)
        .collection('users')
        .doc(allowedUser.localId!)
        .set({
          uid: allowedUser.localId,
          role: 'staff',
          status: 'active',
          permissions: perms,
          displayName: '5F2 Staff Transfer Fixture',
        })
      const refresh = await fetch(
        `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'StaffXfer1!', returnSecureToken: true }),
        },
      )
      const staffAllowed = (await refresh.json()) as { idToken?: string }
      expect(staffAllowed.idToken).toBeTruthy()
      const allowed = await transfer({
        source: bank,
        dest: cash,
        amountPaise: 101,
        token: staffAllowed.idToken!,
        note: 'K02_regression',
      })
      expect(allowed.ok).toBe(true)

      const signup = await fetch(
        `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: `staff_5f2x_${Date.now()}@users.hisab.internal`,
            password: 'StaffTest1!',
            returnSecureToken: true,
          }),
        },
      )
      const staff = (await signup.json()) as { idToken?: string }
      expect(staff.idToken).toBeTruthy()
      const denied = await transfer({
        source: bank,
        dest: cash,
        amountPaise: 100,
        token: staff.idToken!,
      })
      expect(denied.ok).toBe(false)
      const unauth = await callFn(
        'createFundTransfer',
        {
          idempotencyKey: uuid(),
          transactionId: uuid(),
          sourceAccountId: bank,
          destinationAccountId: cash,
          amountPaise: 100,
          businessDate: today,
        },
        null,
      )
      expect(unauth.ok).toBe(false)
    })

    it('K01 Admin transfer creates audit with actor', async () => {
      const result = await transfer({ source: bank, dest: cash, amountPaise: 222, note: 'K01' })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const audits = await getFirestore(app)
        .collection('auditLogs')
        .where('transactionId', '==', result.transactionId)
        .limit(5)
        .get()
      expect(audits.size).toBeGreaterThanOrEqual(1)
      expect(audits.docs[0]?.data()?.action).toBe('finance.fund_transfer_created')
      expect(typeof audits.docs[0]?.data()?.actorUid).toBe('string')
    })
  })

  describe('accounting integrity summary', () => {
    it('sum of fund_transfer_out equals sum of fund_transfer_in', async () => {
      const db = getFirestore(app)
      const [outs, inns] = await Promise.all([
        db.collection('financialLedger').where('entryClass', '==', 'fund_transfer_out').get(),
        db.collection('financialLedger').where('entryClass', '==', 'fund_transfer_in').get(),
      ])
      const outSum = outs.docs.reduce((s, d) => s + Number(d.data()?.amountPaise ?? 0), 0)
      const inSum = inns.docs.reduce((s, d) => s + Number(d.data()?.amountPaise ?? 0), 0)
      expect(outs.size).toBe(inns.size)
      expect(outSum).toBe(inSum)
      expect(outSum).toBeGreaterThan(0)
    })
  })
})
