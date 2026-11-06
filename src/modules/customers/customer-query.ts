import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { customerMatchesSearch, normalizeWhitespace, parseCustomer, type CustomerDoc } from '@shared/models/customer'
import { getFirebase } from '@/services/firebase/client'

export const CUSTOMER_PAGE_SIZE = 40

export type CustomerPage = {
  items: CustomerDoc[]
  lastDoc: QueryDocumentSnapshot<DocumentData> | null
  hasMore: boolean
}

function mapDocs(docs: Array<QueryDocumentSnapshot<DocumentData>>): CustomerDoc[] {
  return docs
    .map((docSnap) => parseCustomer(docSnap.id, docSnap.data() as Record<string, unknown>))
    .filter((row): row is CustomerDoc => row !== null)
}

export async function fetchCustomerPage(options: {
  search: string
  cursor?: QueryDocumentSnapshot<DocumentData> | null
}): Promise<CustomerPage> {
  const db = getFirebase().db
  const search = normalizeWhitespace(options.search).toLowerCase()
  const compact = search.replace(/\s+/g, '')

  if (!search) {
    const constraints = [
      orderBy('displayName'),
      ...(options.cursor ? [startAfter(options.cursor)] : []),
      limit(CUSTOMER_PAGE_SIZE + 1),
    ]
    const snapshot = await getDocs(query(collection(db, 'customers'), ...constraints))
    const docs = snapshot.docs
    const pageDocs = docs.slice(0, CUSTOMER_PAGE_SIZE)
    return {
      items: mapDocs(pageDocs),
      lastDoc: pageDocs.at(-1) ?? null,
      hasMore: docs.length > CUSTOMER_PAGE_SIZE,
    }
  }

  // Prefix / token search across the full collection (not the current page).
  const token = compact.slice(0, 24)
  const snapshot = await getDocs(
    query(
      collection(db, 'customers'),
      where('searchTokens', 'array-contains', token),
      orderBy('displayName'),
      limit(300),
    ),
  )
  const matched = mapDocs(snapshot.docs).filter((customer) => customerMatchesSearch(customer, search))
  return {
    items: matched,
    lastDoc: null,
    hasMore: false,
  }
}

export async function fetchCustomerById(id: string): Promise<CustomerDoc | null> {
  const snapshot = await getDoc(doc(getFirebase().db, 'customers', id))
  if (!snapshot.exists()) return null
  return parseCustomer(snapshot.id, snapshot.data() as Record<string, unknown>)
}
