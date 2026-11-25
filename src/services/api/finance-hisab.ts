import { httpsCallable } from 'firebase/functions'
import { getFirebase } from '@/services/firebase/client'

export type HisabLedgerEntry = {
  id: string
  accountId: string
  amountPaise: number
  direction: 'credit' | 'debit'
  entryClass: string
  businessDate: string | null
  recordScope: 'operational' | 'opening'
  transactionId: string | null
  relatedCustomerId: string | null
  openingSessionId: string | null
  openingGenerationId: string | null
  createdAt: unknown
}

export type HisabDestinationBalance = {
  accountId: string
  name: string
  kind: string | null
  ownership: string | null
  active: boolean
  balancePaise: number
  needsReconciliation: boolean
  reconciliationReason: string | null
  publishedSessionId: string | null
  publishedGenerationId: string | null
}

export type MainHisabDashboard = {
  published: boolean
  needsOpening: boolean
  today: string
  financialOpeningDate: string | null
  businessDate: string
  destinations: HisabDestinationBalance[]
  dayActivity: HisabLedgerEntry[]
  ownerLoanOutstandingPaise: number | null
  gate: { state?: string; activeSessionId?: string | null }
  publication: {
    publishedSessionId?: string | null
    publishedGenerationId?: string | null
  }
}

export async function getMainHisabDashboard(input?: { businessDate?: string }) {
  const callable = httpsCallable(getFirebase().functions, 'getMainHisabDashboard')
  const result = await callable(input ?? {})
  return result.data as MainHisabDashboard
}

export async function listHisabDayLedger(input: { businessDate: string; limit?: number }) {
  const callable = httpsCallable(getFirebase().functions, 'listHisabDayLedger')
  const result = await callable(input)
  return result.data as { businessDate: string; entries: HisabLedgerEntry[] }
}

export async function listHisabCashbook(input: {
  accountId: string
  businessDate?: string
  fromDate?: string
  toDate?: string
  limit?: number
}) {
  const callable = httpsCallable(getFirebase().functions, 'listHisabCashbook')
  const result = await callable(input)
  return result.data as {
    accountId: string
    name: string
    kind: string | null
    ownership: string | null
    balancePaise: number
    needsReconciliation: boolean
    reconciliationReason: string | null
    fromDate: string | null
    toDate: string | null
    openingEntries: HisabLedgerEntry[]
    operationalEntries: HisabLedgerEntry[]
  }
}

export async function createFundTransfer(input: {
  idempotencyKey: string
  transactionId: string
  sourceAccountId: string
  destinationAccountId: string
  amountPaise: number
  businessDate: string
  note?: string
}) {
  const callable = httpsCallable(getFirebase().functions, 'createFundTransfer')
  const result = await callable(input)
  return result.data as {
    ok: true
    transactionId: string
    reused: boolean
    sourceAccountId: string
    destinationAccountId: string
    amountPaise: number
    businessDate: string
  }
}

export async function getFundTransfer(input: { transactionId: string }) {
  const callable = httpsCallable(getFirebase().functions, 'getFundTransfer')
  const result = await callable(input)
  return result.data as {
    id: string
    type: string
    status: string | null
    businessDate: string | null
    amountPaise: number
    sourceAccountId: string | null
    destinationAccountId: string | null
    sourceName: string | null
    destinationName: string | null
    note: string | null
    outEntryId: string | null
    inEntryId: string | null
    createdBy: string | null
    createdAt: unknown
  }
}
