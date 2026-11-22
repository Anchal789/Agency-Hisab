import { httpsCallable } from 'firebase/functions'
import { getFirebase } from '@/services/firebase/client'

export async function getFinancialOpeningStatus() {
  const callable = httpsCallable<Record<string, never>, Record<string, unknown>>(
    getFirebase().functions,
    'getFinancialOpeningStatus',
  )
  const result = await callable({})
  return result.data
}

export async function beginFinancialOpeningSeal(input: {
  idempotencyKey: string
  sessionId: string
  openingDate: string
  anchorTransactionId: string
  anchorDateMismatchReason?: string | null
}) {
  const callable = httpsCallable(getFirebase().functions, 'beginFinancialOpeningSeal')
  const result = await callable(input)
  return result.data as { sessionId: string; generationId: string | null; reused: boolean }
}

export async function saveOpeningBalanceSheet(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'saveOpeningBalanceSheet')
  return (await callable(input)).data
}

export async function planFinancialOpening(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'planFinancialOpening')
  return (await callable(input)).data as {
    ok: true
    expectedPreCount: number
    expectedBridgeCount: number
    expectedFutureCount: number
    expectedChunkCount: number
    chunkIds: string[]
  }
}

export async function prepareOpeningChunk(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'prepareOpeningChunk')
  return (await callable(input)).data
}

export async function verifyOpeningReceivable(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'verifyOpeningReceivable')
  return (await callable(input)).data
}

export async function materializeOpeningReceivables(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'materializeOpeningReceivables')
  return (await callable(input)).data
}

export async function buildOpeningRollup(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'buildOpeningRollup')
  return (await callable(input)).data
}

export async function markOpeningReady(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'markOpeningReady')
  return (await callable(input)).data
}

export async function publishFinancialOpening(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'publishFinancialOpening')
  return (await callable(input)).data
}

export async function abandonFinancialOpeningSeal(input: Record<string, unknown>) {
  const callable = httpsCallable(getFirebase().functions, 'abandonFinancialOpeningSeal')
  return (await callable(input)).data
}

export async function listOpeningReviews(input: {
  sessionId: string
  generationId: string
  limit?: number
}) {
  const callable = httpsCallable(getFirebase().functions, 'listOpeningReviews')
  return (await callable(input)).data as { reviews: Array<Record<string, unknown>> }
}

export async function persistDestinationOwnership(
  accounts: Array<{
    id: string
    name: string
    kind: string
    active: boolean
    ownership?: string
  }>,
) {
  const callable = httpsCallable(getFirebase().functions, 'manageAgencyConfig')
  return (
    await callable({
      action: 'setReceivingAccounts',
      payload: { items: accounts },
    })
  ).data
}
