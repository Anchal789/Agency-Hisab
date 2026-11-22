/**
 * Emulator-backed opening session state checks (Phase 5.0).
 * Requires Firestore emulator at 127.0.0.1:8081.
 *
 * Validates the stuck ready_to_publish scenario that caused:
 * - "Session must be preparing"
 * - "Opening session state must be one of: preparing"
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeApp, deleteApp, type App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  openingAllowsStagingEdits,
  openingPublishActionPlan,
} from '../../shared/rules/opening-session-ui'

const EMULATOR_HOST = '127.0.0.1:8081'
const PROJECT_ID = 'hisab-9d3e4'

describe('financial opening session state (emulator)', () => {
  let app: App

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
    app = initializeApp({ projectId: PROJECT_ID }, `opening-session-${Date.now()}`)
  })

  afterAll(async () => {
    await deleteApp(app)
  })

  it('detects a ready_to_publish seal and requires publish-only / abandon (not balance edits)', async () => {
    const db = getFirestore(app)
    const gateSnap = await db.doc('financialOpeningGate/default').get()
    if (!gateSnap.exists || gateSnap.data()?.state !== 'sealing') {
      // Environment may have been abandoned already — still assert the pure rules.
      expect(openingPublishActionPlan('ready_to_publish')).toBe('publish_only')
      expect(openingAllowsStagingEdits('ready_to_publish')).toBe(false)
      return
    }

    const sessionId = String(gateSnap.data()?.activeSessionId ?? '')
    expect(sessionId.length).toBeGreaterThan(0)
    const sessionSnap = await db.collection('openingSessions').doc(sessionId).get()
    expect(sessionSnap.exists).toBe(true)
    const state = String(sessionSnap.data()?.state ?? '')
    expect(['preparing', 'ready_to_publish']).toContain(state)

    if (state === 'ready_to_publish') {
      expect(openingAllowsStagingEdits(state)).toBe(false)
      expect(openingPublishActionPlan(state)).toBe('publish_only')
      const generationId = String(sessionSnap.data()?.generationId ?? '')
      const sheetId = `${sessionId}_${generationId}`
      const sheet = await db.collection('openingBalanceSheets').doc(sheetId).get()
      // Balances already saved before mark-ready — edits must not be required to publish.
      expect(sheet.exists).toBe(true)
    }
  })

  it('keeps destination opening ledger amounts aligned with the balance sheet when present', async () => {
    const db = getFirestore(app)
    const sessions = await db.collection('openingSessions').limit(5).get()
    for (const doc of sessions.docs) {
      const data = doc.data()
      if (data.state !== 'ready_to_publish' && data.state !== 'preparing') continue
      const generationId = String(data.generationId ?? '')
      if (!generationId) continue
      const sheetSnap = await db.collection('openingBalanceSheets').doc(`${doc.id}_${generationId}`).get()
      if (!sheetSnap.exists) continue
      const amounts = (sheetSnap.data()?.amountsPaise ?? {}) as Record<string, number>
      for (const [accountId, amountPaise] of Object.entries(amounts)) {
        expect(Number.isSafeInteger(amountPaise)).toBe(true)
        const entryId = `${doc.id}_${generationId}_destination_opening_${accountId}`
        const ledger = await db.collection('financialLedger').doc(entryId).get()
        if (!ledger.exists) continue
        expect(Number(ledger.data()?.amountPaise)).toBe(amountPaise)
        expect(ledger.data()?.recordScope).toBe('opening')
      }
    }
  })
})
