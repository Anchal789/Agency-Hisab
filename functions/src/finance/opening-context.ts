import { createHash } from 'crypto'
import { FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import type { OpeningGateState, OpeningSessionState } from '../../../shared/models/finance'

export const GATE_DOC = 'financialOpeningGate/default'
export const PUBLICATION_DOC = 'financePublication/current'

export function gateRef() {
  return getFirestore().doc(GATE_DOC)
}

export function publicationRef() {
  return getFirestore().doc(PUBLICATION_DOC)
}

export function sessionRef(sessionId: string) {
  return getFirestore().collection('openingSessions').doc(sessionId)
}

export function planRef(sessionId: string, generationId: string) {
  return getFirestore().collection('openingPlans').doc(`${sessionId}_${generationId}`)
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashSaleIds(saleIds: readonly string[]): string {
  return sha256Hex(saleIds.join(','))
}

export type OpeningWorkerContext = {
  sessionId: string
  generationId: string
  fence: number
  mutationEpoch: number
  expectedStates: OpeningSessionState[]
}

export async function loadOpeningWorkerGuardsInTx(
  tx: Transaction,
  ctx: OpeningWorkerContext,
): Promise<{ session: DocumentData; gate: DocumentData }> {
  const [sessionSnap, gateSnap] = await Promise.all([
    tx.get(sessionRef(ctx.sessionId)),
    tx.get(gateRef()),
  ])
  if (!sessionSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Opening session not found.')
  }
  if (!gateSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening gate is missing.')
  }
  const session = sessionSnap.data() ?? {}
  const gate = gateSnap.data() ?? {}

  if (session.generationId !== ctx.generationId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Opening generation is stale. Rebuild the plan.',
    )
  }
  if (Number(session.fence) !== ctx.fence) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Opening fence is stale. The seal may have been abandoned.',
    )
  }
  if (Number(gate.mutationEpoch) !== ctx.mutationEpoch) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Mutation epoch changed. Rebuild the opening plan.',
    )
  }
  if (!ctx.expectedStates.includes(session.state as OpeningSessionState)) {
    const current = String(session.state ?? 'unknown')
    const hint =
      current === 'ready_to_publish' && ctx.expectedStates.includes('preparing')
        ? ' Setup is ready to publish — finish publishing, or cancel setup before changing preparation steps.'
        : ''
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Opening session state must be one of: ${ctx.expectedStates.join(', ')}.${hint}`,
    )
  }
  if (session.state === 'abandoned') {
    throw new functions.https.HttpsError('failed-precondition', 'Opening session was abandoned.')
  }
  return { session, gate }
}

export async function getGateState(): Promise<{
  state: OpeningGateState
  mutationEpoch: number
  activeSessionId: string | null
}> {
  const snap = await gateRef().get()
  if (!snap.exists) {
    return { state: 'not_opened', mutationEpoch: 0, activeSessionId: null }
  }
  const data = snap.data() ?? {}
  const state = (data.state as OpeningGateState) || 'not_opened'
  return {
    state,
    mutationEpoch: Number(data.mutationEpoch ?? 0),
    activeSessionId: typeof data.activeSessionId === 'string' ? data.activeSessionId : null,
  }
}

export async function getPublicationPointer(): Promise<{
  publishedSessionId: string | null
  publishedGenerationId: string | null
}> {
  const snap = await publicationRef().get()
  if (!snap.exists) {
    return { publishedSessionId: null, publishedGenerationId: null }
  }
  const data = snap.data() ?? {}
  return {
    publishedSessionId: typeof data.publishedSessionId === 'string' ? data.publishedSessionId : null,
    publishedGenerationId:
      typeof data.publishedGenerationId === 'string' ? data.publishedGenerationId : null,
  }
}

/** Invalidate current generation during sealing after a Godown mutation. */
export function invalidateOpeningGenerationInTx(
  tx: Transaction,
  input: { actorUid: string; reason: string },
): void {
  const gRef = gateRef()
  tx.set(
    gRef,
    {
      mutationEpoch: FieldValue.increment(1),
      lastInvalidationReason: input.reason,
      lastInvalidatedBy: input.actorUid,
      lastInvalidatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

export function newGenerationId(): string {
  return `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
