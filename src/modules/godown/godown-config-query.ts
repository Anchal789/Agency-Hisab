import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import {
  parseAgencySettings,
  parseLocation,
  parseProduct,
  type AgencySettingsDoc,
  type LocationDoc,
  type ProductDoc,
} from '@shared/models/agency-config'
import { getFirebase } from '@/services/firebase/client'

export type GodownConfig = {
  agency: AgencySettingsDoc
  products: ProductDoc[]
  locations: LocationDoc[]
}

export async function fetchGodownConfig(): Promise<GodownConfig> {
  const db = getFirebase().db
  const [agencySnap, productsSnap, locationsSnap] = await Promise.all([
    getDoc(doc(db, 'settings', 'agency')),
    getDocs(query(collection(db, 'products'), orderBy('name'))),
    getDocs(query(collection(db, 'locations'), orderBy('name'))),
  ])

  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const products = productsSnap.docs
    .map((snap) => parseProduct(snap.id, snap.data() as Record<string, unknown>))
    .filter((row): row is ProductDoc => row !== null && row.active && row.kind === 'cylinder')
  const locations = locationsSnap.docs
    .map((snap) => parseLocation(snap.id, snap.data() as Record<string, unknown>))
    .filter((row): row is LocationDoc => row !== null && row.active)

  return { agency, products, locations }
}
