/**
 * Phase 5F.1 — Main Hisab read callables against the live Firebase emulators.
 * Does not reset or alter the published Phase 5.0 opening evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const EMULATOR_HOST = '127.0.0.1:8081'
const AUTH_HOST = '127.0.0.1:9099'
const FUNCTIONS_HOST = '127.0.0.1:5001'
const PROJECT_ID = 'hisab-9d3e4'
const EVIDENCE_PATH = resolve('docs/evidence/phase5_0_published_opening_emulator.json')

type Evidence = {
  session: { id: string; generationId?: string; openingDate?: string }
  publication: { publishedSessionId?: string; publishedGenerationId?: string }
  agency: { financialOpeningDate?: string | null }
  financialBalances: Array<{ id: string }>
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
  if (!json.idToken) throw new Error(`Admin sign-in failed: ${json.error?.message ?? res.status}`)
  return json.idToken
}

async function callFunction<T = unknown>(
  name: string,
  data: Record<string, unknown>,
  idToken?: string | null,
): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (idToken) headers.Authorization = `Bearer ${idToken}`
  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-south1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })
  const json = (await res.json()) as { result?: T; error?: { status?: string; message?: string } }
  if (!res.ok || json.error) {
    return {
      ok: false,
      code: String(json.error?.status ?? res.status),
      message: String(json.error?.message ?? 'callable failed'),
    }
  }
  return { ok: true, data: json.result as T }
}

describe('Phase 5F.1 Main Hisab reads (emulator)', () => {
  let app: App
  let evidence: Evidence
  let adminToken: string

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
    evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8')) as Evidence
    app = initializeApp({ projectId: PROJECT_ID }, `p5f1-${Date.now()}`)
    adminToken = await signInAdmin()
  })

  afterAll(async () => {
    if (getApps().some((a) => a.name.startsWith('p5f1-'))) await deleteApp(app)
  })

  it('preserves published Phase 5.0 pointer', async () => {
    const db = getFirestore(app)
    const pub = await db.doc('financePublication/current').get()
    expect(pub.data()?.publishedSessionId).toBe(evidence.session.id)
    expect(pub.data()?.publishedGenerationId).toBe(evidence.session.generationId)
  })

  it('getMainHisabDashboard returns published destinations for Admin', async () => {
    const result = await callFunction<{
      published: boolean
      destinations: Array<{ accountId: string; balancePaise: number }>
      financialOpeningDate: string
      businessDate: string
      dayActivity: unknown[]
    }>('getMainHisabDashboard', {}, adminToken)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.published).toBe(true)
    expect(result.data.financialOpeningDate).toBe(evidence.agency.financialOpeningDate)
    expect(result.data.destinations.length).toBeGreaterThanOrEqual(1)
    expect(result.data.destinations.length).toBeLessThanOrEqual(40)
    const ids = new Set(result.data.destinations.map((row) => row.accountId))
    for (const row of evidence.financialBalances) expect(ids.has(row.id)).toBe(true)
    expect(result.data.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects future business dates', async () => {
    const result = await callFunction('getMainHisabDashboard', { businessDate: '2099-01-01' }, adminToken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message.toLowerCase()).toMatch(/future|invalid/)
  })

  it('rejects dates before financial opening', async () => {
    const result = await callFunction('getMainHisabDashboard', { businessDate: '2020-01-01' }, adminToken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message.toLowerCase()).toMatch(/opening|before|invalid/)
  })

  it('listHisabCashbook returns destination without creating ledger rows', async () => {
    const accountId = evidence.financialBalances[0]?.id
    expect(accountId).toBeTruthy()
    const first = await callFunction<{
      accountId: string
      balancePaise: number
      openingEntries: unknown[]
      operationalEntries: unknown[]
    }>(
      'listHisabCashbook',
      { accountId, businessDate: evidence.agency.financialOpeningDate },
      adminToken,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.accountId).toBe(accountId)
    expect(Number.isSafeInteger(first.data.balancePaise)).toBe(true)

    const second = await callFunction<{
      openingEntries: unknown[]
      operationalEntries: unknown[]
    }>(
      'listHisabCashbook',
      { accountId, businessDate: evidence.agency.financialOpeningDate },
      adminToken,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.openingEntries).toHaveLength(first.data.openingEntries.length)
    expect(second.data.operationalEntries).toHaveLength(first.data.operationalEntries.length)
  })

  it('unauthenticated dashboard is rejected', async () => {
    const result = await callFunction('getMainHisabDashboard', {}, null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message.toLowerCase()).toMatch(/sign in|auth|unauth/)
  })

  it('staff without finance.viewBalances is denied', async () => {
    const signup = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `staff_5f1_${Date.now()}@users.hisab.internal`,
          password: 'StaffTest1!',
          returnSecureToken: true,
        }),
      },
    )
    const signupJson = (await signup.json()) as { idToken?: string }
    expect(signupJson.idToken).toBeTruthy()
    const result = await callFunction('getMainHisabDashboard', {}, signupJson.idToken!)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message.toLowerCase()).toMatch(/permission|denied|admin|role|sign in/)
  })
})
