/** Phase 1 agency configuration models reused by later operational modules. */

export const AGENCY_TIMEZONES = ['Asia/Kolkata'] as const
export const AGENCY_CURRENCIES = ['INR'] as const

export type ReceivingAccountKind = 'cash' | 'upi' | 'bank' | 'portal' | 'other'
export type LocationKind = 'godown' | 'other'
export type ProductKind = 'cylinder' | 'accessory' | 'other'

export type NamedConfigItem = {
  id: string
  name: string
  active: boolean
}

export type ReceivingAccount = NamedConfigItem & {
  kind: ReceivingAccountKind
}

export type AgencySettingsDoc = {
  name: string
  timezone: string
  currency: string
  paymentMethods: NamedConfigItem[]
  receivingAccounts: ReceivingAccount[]
  expenseCategories: NamedConfigItem[]
  inventoryStates: string[]
  negativeStockAllowed: boolean
  historicalCorrectionRequiresSecondAdmin: boolean
}

export type LocationDoc = {
  id: string
  name: string
  kind: LocationKind
  active: boolean
}

export type ProductDoc = {
  id: string
  name: string
  code: string
  kind: ProductKind
  unit: string
  active: boolean
}

export type PriceRuleDoc = {
  id: string
  productId: string
  label: string
  amountPaise: number
  active: boolean
}

export function newConfigId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}`
}

function asNamedList(input: unknown): NamedConfigItem[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      if (!id || !name) return null
      return { id, name, active: row.active !== false }
    })
    .filter((item): item is NamedConfigItem => item !== null)
}

function asReceivingAccounts(input: unknown): ReceivingAccount[] {
  if (!Array.isArray(input)) return []
  const kinds: ReceivingAccountKind[] = ['cash', 'upi', 'bank', 'portal', 'other']
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const kind = kinds.includes(row.kind as ReceivingAccountKind) ? (row.kind as ReceivingAccountKind) : null
      if (!id || !name || !kind) return null
      return { id, name, kind, active: row.active !== false }
    })
    .filter((item): item is ReceivingAccount => item !== null)
}

export function parseAgencySettings(data: Record<string, unknown> | undefined): AgencySettingsDoc {
  const source = data ?? {}
  return {
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Miragpur Indane Gas Agency',
    timezone: typeof source.timezone === 'string' && source.timezone.trim() ? source.timezone.trim() : 'Asia/Kolkata',
    currency: typeof source.currency === 'string' && source.currency.trim() ? source.currency.trim() : 'INR',
    paymentMethods: asNamedList(source.paymentMethods),
    receivingAccounts: asReceivingAccounts(source.receivingAccounts),
    expenseCategories: asNamedList(source.expenseCategories),
    inventoryStates: Array.isArray(source.inventoryStates)
      ? source.inventoryStates.filter((value): value is string => typeof value === 'string')
      : ['filled', 'empty', 'damaged'],
    negativeStockAllowed: source.negativeStockAllowed === true,
    historicalCorrectionRequiresSecondAdmin: source.historicalCorrectionRequiresSecondAdmin === true,
  }
}

export function parseLocation(id: string, data: Record<string, unknown>): LocationDoc | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const kind = data.kind === 'godown' || data.kind === 'other' ? data.kind : null
  if (!name || !kind) return null
  return { id, name, kind, active: data.active !== false }
}

export function parseProduct(id: string, data: Record<string, unknown>): ProductDoc | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const code = typeof data.code === 'string' ? data.code.trim() : ''
  const unit = typeof data.unit === 'string' ? data.unit.trim() : 'cylinder'
  const kind =
    data.kind === 'cylinder' || data.kind === 'accessory' || data.kind === 'other' ? data.kind : null
  if (!name || !code || !kind) return null
  return { id, name, code, kind, unit: unit || 'cylinder', active: data.active !== false }
}

export function parsePriceRule(id: string, data: Record<string, unknown>): PriceRuleDoc | null {
  const productId = typeof data.productId === 'string' ? data.productId.trim() : ''
  const label = typeof data.label === 'string' ? data.label.trim() : ''
  const amountPaise = typeof data.amountPaise === 'number' && Number.isSafeInteger(data.amountPaise) ? data.amountPaise : NaN
  if (!productId || !label || !Number.isSafeInteger(amountPaise) || amountPaise < 0) return null
  return { id, productId, label, amountPaise, active: data.active !== false }
}
