/**
 * Phase 5F.2 fund transfer callables against live emulators.
 * Does not alter Phase 5.0 publication pointer / opening evidence docs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { fundTransferInLedgerId, fundTransferOutLedgerId } from '../../shared/models/finance'
import { parseAgencySettings } from '../../shared/models/agency-config'

const EMULATOR_HOST = '127.0.0.1:8081'
const AUTH_HOST = '127.0.0.1:9099'
const FUNCTIONS_HOST = '127.0.0.1:5001'
const PROJECT_ID = 'hisab-9d3e4'

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

async function callFunction<T = unknown>(
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
  if (!res.ok || json.error) {
    return { ok: false, message: String(json.error?.message ?? 'callable failed') }
  }
  return { ok: true, data: json.result as T }
}

function uuid(): string {
  return crypto.randomUUID()
}

describe('Phase 5F.2 fund transfers (emulator)', () => {
  let app: App
  let adminToken: string
  let cashId = ''
  let bankId = ''
  let upiId = ''
  let portalId = ''
  let openingDate = ''
  let publishedSessionId = ''
  let publishedGenerationId = ''

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
    app = initializeApp({ projectId: PROJECT_ID }, `p5f2-${Date.now()}`)
    adminToken = await signInAdmin()
    const db = getFirestore(app)
    const [agencySnap, pub] = await Promise.all([
      db.collection('settings').doc('agency').get(),
      db.doc('financePublication/current').get(),
    ])
    const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
    openingDate = agency.financialOpeningDate ?? ''
    publishedSessionId = String(pub.data()?.publishedSessionId ?? '')
    publishedGenerationId = String(pub.data()?.publishedGenerationId ?? '')
    expect(publishedSessionId).toBeTruthy()
    expect(openingDate).toBeTruthy()

    for (const row of agency.receivingAccounts) {
      if (row.active === false) continue
      if (row.kind === 'cash' && row.ownership === 'agency' && !cashId) cashId = row.id
      if (row.kind === 'bank' && row.ownership === 'agency' && !bankId) bankId = row.id
      if (row.kind === 'upi' && row.ownership === 'agency' && !upiId) upiId = row.id
      if (row.ownership === 'portal' && !portalId) portalId = row.id
    }
    expect(cashId && bankId && upiId).toBeTruthy()
  })

  afterAll(async () => {
    if (getApps().some((a) => a.name.startsWith('p5f2-'))) await deleteApp(app)
  })

  async function balances() {
    const db = getFirestore(app)
    const [cash, bank, upi] = await Promise.all([
      db.collection('financialBalances').doc(cashId).get(),
      db.collection('financialBalances').doc(bankId).get(),
      db.collection('financialBalances').doc(upiId).get(),
    ])
    return {
      cash: Number(cash.data()?.balancePaise ?? 0),
      bank: Number(bank.data()?.balancePaise ?? 0),
      upi: Number(upi.data()?.balancePaise ?? 0),
      total:
        Number(cash.data()?.balancePaise ?? 0) +
        Number(bank.data()?.balancePaise ?? 0) +
        Number(upi.data()?.balancePaise ?? 0),
    }
  }

  async function transfer(input: {
    sourceAccountId: string
    destinationAccountId: string
    amountPaise: number
    businessDate?: string
    idempotencyKey?: string
    transactionId?: string
  }) {
    const idempotencyKey = input.idempotencyKey ?? uuid()
    const transactionId = input.transactionId ?? uuid()
    return callFunction<{
      transactionId: string
      reused: boolean
      amountPaise: number
    }>(
      'createFundTransfer',
      {
        idempotencyKey,
        transactionId,
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amountPaise: input.amountPaise,
        businessDate: input.businessDate ?? openingDate,
        note: '5f2 test',
      },
      adminToken,
    )
  }

  it('preserves publication pointer before transfers', async () => {
    const db = getFirestore(app)
    const pub = await db.doc('financePublication/current').get()
    expect(pub.data()?.publishedSessionId).toBe(publishedSessionId)
    expect(pub.data()?.publishedGenerationId).toBe(publishedGenerationId)
  })

  it('Bank → Cash: debit/credit once and total unchanged', async () => {
    const before = await balances()
    const amount = 5_000
    // Ensure bank has funds (may already from prior sale_collection)
    if (before.bank < amount) {
      throw new Error(`Bank balance ${before.bank} too low for test; seed or collect first`)
    }
    const result = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: amount,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.reused).toBe(false)

    const db = getFirestore(app)
    const out = await db.collection('financialLedger').doc(fundTransferOutLedgerId(result.data.transactionId)).get()
    const inn = await db.collection('financialLedger').doc(fundTransferInLedgerId(result.data.transactionId)).get()
    expect(out.exists).toBe(true)
    expect(inn.exists).toBe(true)
    expect(out.data()?.direction).toBe('debit')
    expect(inn.data()?.direction).toBe('credit')
    expect(Number(out.data()?.amountPaise)).toBe(amount)
    expect(Number(inn.data()?.amountPaise)).toBe(amount)
    expect(out.data()?.entryClass).toBe('fund_transfer_out')
    expect(inn.data()?.entryClass).toBe('fund_transfer_in')

    const after = await balances()
    expect(after.bank).toBe(before.bank - amount)
    expect(after.cash).toBe(before.cash + amount)
    expect(after.total).toBe(before.total)

    const tx = await db.collection('transactions').doc(result.data.transactionId).get()
    expect(tx.data()?.type).toBe('fund_transfer')
    const audits = await db.collection('auditLogs').where('transactionId', '==', result.data.transactionId).limit(5).get()
    expect(audits.size).toBeGreaterThanOrEqual(1)
  })

  it('Cash → Bank transfer updates both balances', async () => {
    const before = await balances()
    const amount = 2_000
    if (before.cash < amount) {
      const seed = await transfer({
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amountPaise: amount,
      })
      expect(seed.ok).toBe(true)
    }
    const mid = await balances()
    const result = await transfer({
      sourceAccountId: cashId,
      destinationAccountId: bankId,
      amountPaise: amount,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = await balances()
    expect(after.cash).toBe(mid.cash - amount)
    expect(after.bank).toBe(mid.bank + amount)
    expect(after.total).toBe(mid.total)
  })

  it('UPI → Cash after funding UPI from Bank', async () => {
    const amount = 1_500
    const fund = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: upiId,
      amountPaise: amount,
    })
    expect(fund.ok).toBe(true)
    const before = await balances()
    const result = await transfer({
      sourceAccountId: upiId,
      destinationAccountId: cashId,
      amountPaise: amount,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = await balances()
    expect(after.upi).toBe(before.upi - amount)
    expect(after.cash).toBe(before.cash + amount)
    expect(after.total).toBe(before.total)
  })

  it('appears once in day ledger for the transfer business date', async () => {
    const amount = 500
    const result = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: amount,
      businessDate: openingDate,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const day = await callFunction<{ entries: Array<{ transactionId: string; entryClass: string }> }>(
      'listHisabDayLedger',
      { businessDate: openingDate, limit: 200 },
      adminToken,
    )
    expect(day.ok).toBe(true)
    if (!day.ok) return
    const rows = day.data.entries.filter((row) => row.transactionId === result.data.transactionId)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.entryClass).sort()).toEqual(['fund_transfer_in', 'fund_transfer_out'])
  })

  it('shows in both destination cashbooks', async () => {
    const amount = 700
    const result = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: amount,
      businessDate: openingDate,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [srcBook, dstBook] = await Promise.all([
      callFunction<{ operationalEntries: Array<{ transactionId: string }> }>(
        'listHisabCashbook',
        { accountId: bankId, businessDate: openingDate },
        adminToken,
      ),
      callFunction<{ operationalEntries: Array<{ transactionId: string }> }>(
        'listHisabCashbook',
        { accountId: cashId, businessDate: openingDate },
        adminToken,
      ),
    ])
    expect(srcBook.ok && dstBook.ok).toBe(true)
    if (!srcBook.ok || !dstBook.ok) return
    expect(srcBook.data.operationalEntries.some((e) => e.transactionId === result.data.transactionId)).toBe(true)
    expect(dstBook.data.operationalEntries.some((e) => e.transactionId === result.data.transactionId)).toBe(true)
  })

  it('rejects same account, zero/negative via schema path, insufficient, portal, bad dates', async () => {
    const same = await transfer({
      sourceAccountId: cashId,
      destinationAccountId: cashId,
      amountPaise: 100,
    })
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.message.toLowerCase()).toMatch(/different|same/)

    const zero = await callFunction(
      'createFundTransfer',
      {
        idempotencyKey: uuid(),
        transactionId: uuid(),
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amountPaise: 0,
        businessDate: openingDate,
      },
      adminToken,
    )
    expect(zero.ok).toBe(false)

    const negative = await callFunction(
      'createFundTransfer',
      {
        idempotencyKey: uuid(),
        transactionId: uuid(),
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amountPaise: -50,
        businessDate: openingDate,
      },
      adminToken,
    )
    expect(negative.ok).toBe(false)

    const cashSnap = await getFirestore(app).collection('financialBalances').doc(cashId).get()
    const cashBal = Number(cashSnap.data()?.balancePaise ?? 0)
    const over = await transfer({
      sourceAccountId: cashId,
      destinationAccountId: bankId,
      amountPaise: Math.min(1_000_000_000, cashBal + 50_000),
    })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message.toLowerCase()).toMatch(/insufficient|invalid|amount/)

    if (portalId) {
      const portal = await transfer({
        sourceAccountId: bankId,
        destinationAccountId: portalId,
        amountPaise: 100,
      })
      expect(portal.ok).toBe(false)
      if (!portal.ok) expect(portal.message.toLowerCase()).toMatch(/portal/)
    }

    const future = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: 100,
      businessDate: '2099-01-01',
    })
    expect(future.ok).toBe(false)

    const beforeOpen = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: 100,
      businessDate: '2020-01-01',
    })
    expect(beforeOpen.ok).toBe(false)
  })

  it('idempotent retry and concurrent duplicate do not double-post', async () => {
    const before = await balances()
    const amount = 300
    const idempotencyKey = uuid()
    const transactionId = uuid()
    const payload = {
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: amount,
      idempotencyKey,
      transactionId,
    }
    const [a, b] = await Promise.all([transfer(payload), transfer(payload)])
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const reusedCount = [a.data.reused, b.data.reused].filter(Boolean).length
    expect(reusedCount).toBeGreaterThanOrEqual(1)

    const third = await transfer(payload)
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.data.reused).toBe(true)

    const after = await balances()
    expect(after.bank).toBe(before.bank - amount)
    expect(after.cash).toBe(before.cash + amount)
    expect(after.total).toBe(before.total)

    const db = getFirestore(app)
    const out = await db.collection('financialLedger').doc(fundTransferOutLedgerId(transactionId)).get()
    const inn = await db.collection('financialLedger').doc(fundTransferInLedgerId(transactionId)).get()
    expect(out.exists && inn.exists).toBe(true)
  })

  it('unauthorized staff cannot create transfers', async () => {
    const signup = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `staff_5f2_${Date.now()}@users.hisab.internal`,
          password: 'StaffTest1!',
          returnSecureToken: true,
        }),
      },
    )
    const signupJson = (await signup.json()) as { idToken?: string }
    expect(signupJson.idToken).toBeTruthy()
    const result = await callFunction(
      'createFundTransfer',
      {
        idempotencyKey: uuid(),
        transactionId: uuid(),
        sourceAccountId: bankId,
        destinationAccountId: cashId,
        amountPaise: 100,
        businessDate: openingDate,
      },
      signupJson.idToken!,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message.toLowerCase()).toMatch(/permission|denied|admin|role|sign in/)
  })

  it('rejects transfer when source needs reconciliation, then restores flag', async () => {
    const db = getFirestore(app)
    const ref = db.collection('financialBalances').doc(bankId)
    await ref.update({ needsReconciliation: true, reconciliationReason: '5f2_test_flag' })
    const blocked = await transfer({
      sourceAccountId: bankId,
      destinationAccountId: cashId,
      amountPaise: 100,
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.message.toLowerCase()).toMatch(/reconcil/)
    await ref.update({ needsReconciliation: false, reconciliationReason: null })
  })

  it('publication pointer unchanged after transfers', async () => {
    const db = getFirestore(app)
    const pub = await db.doc('financePublication/current').get()
    expect(pub.data()?.publishedSessionId).toBe(publishedSessionId)
    expect(pub.data()?.publishedGenerationId).toBe(publishedGenerationId)
  })
})
