import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { normalizeWhitespace } from '@shared/models/customer'
import {
  isGodownTransactionType,
  parseTransaction,
  sortEmptyReturns,
  type BookingStatus,
  type CustomerKind,
  type TransactionDoc,
} from '@shared/models/transaction'
import { getFirebase } from '@/services/firebase/client'

export const GODOWN_PAGE_SIZE = 100

export type GodownFilters = {
  businessDate: string
  search: string
  bookingStatus: 'all' | BookingStatus
  customerKind: 'all' | CustomerKind
  includeReversed: boolean
}

export type GodownPageResult = {
  items: TransactionDoc[]
  hasMore: boolean
}

function mapDocs(docs: Array<QueryDocumentSnapshot<DocumentData>>): TransactionDoc[] {
  return docs
    .map((snap) => parseTransaction(snap.id, snap.data() as Record<string, unknown>))
    .filter((row): row is TransactionDoc => row !== null)
}

function matchesFilters(row: TransactionDoc, filters: GodownFilters): boolean {
  if (!isGodownTransactionType(row.type)) return false
  if (!filters.includeReversed && row.status === 'reversed') return false
  if (filters.bookingStatus !== 'all' && row.bookingStatus !== filters.bookingStatus) return false
  if (filters.customerKind !== 'all' && row.customerKind !== filters.customerKind) return false
  const search = normalizeWhitespace(filters.search).toLowerCase()
  if (!search) return true
  const haystack = [
    row.customerSnapshot.name,
    row.customerSnapshot.consumerNumber ?? '',
    row.productName,
    row.note,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(search)
}

async function enrichEmptyReturnOrigins(items: TransactionDoc[]): Promise<TransactionDoc[]> {
  const missingOriginIds = [
    ...new Set(
      items
        .filter(
          (row) =>
            row.type === 'empty_return' &&
            row.originTransactionId &&
            !row.originBusinessDate,
        )
        .map((row) => row.originTransactionId as string),
    ),
  ]
  if (missingOriginIds.length === 0) return items

  const origins = await Promise.all(missingOriginIds.map((id) => fetchGodownTransaction(id)))
  const byId = new Map(
    origins.filter((row): row is TransactionDoc => row !== null).map((row) => [row.id, row]),
  )

  return items.map((row) => {
    if (row.type !== 'empty_return' || !row.originTransactionId || row.originBusinessDate) return row
    const origin = byId.get(row.originTransactionId)
    if (!origin) return row
    return {
      ...row,
      originBusinessDate: origin.businessDate,
    }
  })
}

export async function fetchGodownDay(filters: GodownFilters): Promise<GodownPageResult> {
  const db = getFirebase().db
  const snapshot = await getDocs(
    query(
      collection(db, 'transactions'),
      where('businessDate', '==', filters.businessDate),
      orderBy('createdAt', 'desc'),
      limit(GODOWN_PAGE_SIZE + 1),
    ),
  )
  const docs = snapshot.docs
  const pageDocs = docs.slice(0, GODOWN_PAGE_SIZE)
  const items = await enrichEmptyReturnOrigins(
    mapDocs(pageDocs).filter((row) => matchesFilters(row, filters)),
  )
  return {
    items,
    hasMore: docs.length > GODOWN_PAGE_SIZE,
  }
}

export async function fetchGodownTransaction(id: string): Promise<TransactionDoc | null> {
  const snapshot = await getDoc(doc(getFirebase().db, 'transactions', id))
  if (!snapshot.exists()) return null
  return parseTransaction(snapshot.id, snapshot.data() as Record<string, unknown>)
}

export async function fetchEmptyReturnsForSale(originTransactionId: string): Promise<TransactionDoc[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebase().db, 'transactions'),
      where('type', '==', 'empty_return'),
      where('originTransactionId', '==', originTransactionId),
      limit(100),
    ),
  )
  return sortEmptyReturns(mapDocs(snapshot.docs).filter((row) => row.status !== 'reversed'))
}

export async function fetchUserDisplayName(uid: string): Promise<string | null> {
  if (!uid) return null
  try {
    const snapshot = await getDoc(doc(getFirebase().db, 'users', uid))
    if (!snapshot.exists()) return null
    const name = snapshot.data()?.displayName
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    // Staff may only read their own users/{uid}; fall back to uid in the UI.
    return null
  }
}

export async function fetchLocationName(locationId: string): Promise<string | null> {
  if (!locationId) return null
  try {
    const snapshot = await getDoc(doc(getFirebase().db, 'locations', locationId))
    if (!snapshot.exists()) return null
    const name = snapshot.data()?.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    return null
  }
}
