import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { parseLocation, parseProduct, type LocationDoc, type ProductDoc } from '@shared/models/agency-config'
import {
  parseInventoryBalance,
  parseInventoryLedger,
  parseInventoryOpening,
  summarizeBalancesByState,
  type InventoryBalanceDoc,
  type InventoryLedgerLine,
  type InventoryOpeningDoc,
  type InventoryTransactionType,
} from '@shared/models/inventory'
import { isInventoryTxType, parseTransaction, type TransactionDoc } from '@shared/models/transaction'
import { getFirebase } from '@/services/firebase/client'

export async function fetchInventoryBalances(): Promise<InventoryBalanceDoc[]> {
  const snapshot = await getDocs(collection(getFirebase().db, 'inventoryBalances'))
  return snapshot.docs
    .map((doc) => parseInventoryBalance(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is InventoryBalanceDoc => row !== null)
}

export async function fetchInventoryOpenings(): Promise<InventoryOpeningDoc[]> {
  const snapshot = await getDocs(collection(getFirebase().db, 'inventoryOpenings'))
  return snapshot.docs
    .map((doc) => parseInventoryOpening(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is InventoryOpeningDoc => row !== null)
}

export async function fetchInventoryLedger(filters: {
  businessDate?: string
  fromDate?: string
  toDate?: string
  locationId?: string
} = {}): Promise<InventoryLedgerLine[]> {
  const db = getFirebase().db
  const locationId = filters.locationId || undefined
  const ranged = Boolean(filters.fromDate && filters.toDate && filters.fromDate !== filters.toDate)
  const singleDate =
    filters.businessDate ||
    (filters.fromDate && filters.toDate && filters.fromDate === filters.toDate ? filters.fromDate : undefined)

  let snapshot
  if (ranged && locationId && filters.fromDate && filters.toDate) {
    snapshot = await getDocs(
      query(
        collection(db, 'inventoryLedger'),
        where('locationId', '==', locationId),
        where('businessDate', '>=', filters.fromDate),
        where('businessDate', '<=', filters.toDate),
        orderBy('businessDate', 'asc'),
        limit(400),
      ),
    )
  } else if (ranged && filters.fromDate && filters.toDate) {
    snapshot = await getDocs(
      query(
        collection(db, 'inventoryLedger'),
        where('businessDate', '>=', filters.fromDate),
        where('businessDate', '<=', filters.toDate),
        orderBy('businessDate', 'asc'),
        orderBy('createdAt', 'desc'),
        limit(400),
      ),
    )
  } else if (locationId && singleDate) {
    snapshot = await getDocs(
      query(
        collection(db, 'inventoryLedger'),
        where('locationId', '==', locationId),
        where('businessDate', '==', singleDate),
        limit(200),
      ),
    )
  } else if (singleDate) {
    snapshot = await getDocs(
      query(
        collection(db, 'inventoryLedger'),
        where('businessDate', '==', singleDate),
        orderBy('createdAt', 'desc'),
        limit(200),
      ),
    )
  } else if (locationId) {
    snapshot = await getDocs(
      query(collection(db, 'inventoryLedger'), where('locationId', '==', locationId), limit(200)),
    )
  } else {
    snapshot = await getDocs(query(collection(db, 'inventoryLedger'), orderBy('createdAt', 'desc'), limit(100)))
  }
  return snapshot.docs
    .map((doc) => parseInventoryLedger(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is InventoryLedgerLine => row !== null)
}

export async function fetchPendingInventoryTransactions(): Promise<TransactionDoc[]> {
  const types: InventoryTransactionType[] = [
    'stock_opening',
    'stock_receipt',
    'stock_return_distributor',
    'stock_transfer',
    'stock_reconciliation',
  ]
  const results: TransactionDoc[] = []
  for (const type of types) {
    const snapshot = await getDocs(
      query(
        collection(getFirebase().db, 'transactions'),
        where('status', '==', 'pending_approval'),
        where('type', '==', type),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
    )
    for (const doc of snapshot.docs) {
      const row = parseTransaction(doc.id, doc.data() as Record<string, unknown>)
      if (row && isInventoryTxType(row.type)) results.push(row)
    }
  }
  return results.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
}

/** Posted plant receipts eligible for Financial Opening anchor selection. */
export async function fetchPostedStockReceipts(limitCount = 100): Promise<TransactionDoc[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebase().db, 'transactions'),
      where('status', '==', 'posted'),
      where('type', '==', 'stock_receipt'),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    ),
  )
  return snapshot.docs
    .map((doc) => parseTransaction(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is TransactionDoc => row !== null && row.type === 'stock_receipt')
}

export async function fetchInventoryMasterData(): Promise<{
  locations: LocationDoc[]
  products: ProductDoc[]
}> {
  const db = getFirebase().db
  const [locationsSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, 'locations')),
    getDocs(collection(db, 'products')),
  ])
  const locations = locationsSnap.docs
    .map((doc) => parseLocation(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is LocationDoc => row !== null && row.active)
  const products = productsSnap.docs
    .map((doc) => parseProduct(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is ProductDoc => row !== null && row.active && row.kind === 'cylinder')
  return { locations, products }
}

export async function fetchOpenEmptyObligationsTotal(): Promise<{ customerOutstanding: number }> {
  const snapshot = await getDocs(
    query(collection(getFirebase().db, 'obligations'), where('kind', '==', 'empty_cylinder'), limit(500)),
  )
  let customerOutstanding = 0
  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (data.status === 'open' || data.status === 'partial') {
      const outstanding = Number(data.outstanding ?? 0)
      if (Number.isSafeInteger(outstanding) && outstanding > 0) customerOutstanding += outstanding
    }
  }
  return { customerOutstanding }
}

export function dashboardFromBalances(
  balances: InventoryBalanceDoc[],
  locations: LocationDoc[],
): {
  totals: ReturnType<typeof summarizeBalancesByState>
  byKind: Record<string, ReturnType<typeof summarizeBalancesByState>>
  hasAnyBalance: boolean
} {
  const locationKind = new Map(locations.map((row) => [row.id, row.kind]))
  const byKind: Record<string, ReturnType<typeof summarizeBalancesByState>> = {
    godown: { filled: 0, empty: 0, damaged: 0 },
    vehicle: { filled: 0, empty: 0, damaged: 0 },
    agent: { filled: 0, empty: 0, damaged: 0 },
    csc: { filled: 0, empty: 0, damaged: 0 },
    other: { filled: 0, empty: 0, damaged: 0 },
  }
  for (const row of balances) {
    const kind = locationKind.get(row.locationId) ?? 'other'
    if (!byKind[kind]) byKind[kind] = { filled: 0, empty: 0, damaged: 0 }
    byKind[kind][row.state] += row.quantity
  }
  return {
    totals: summarizeBalancesByState(balances),
    byKind,
    hasAnyBalance: balances.length > 0,
  }
}
