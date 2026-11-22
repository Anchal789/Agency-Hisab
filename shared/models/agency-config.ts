/** Phase 1 agency configuration models reused by later operational modules. */

export const AGENCY_TIMEZONES = ['Asia/Kolkata'] as const
export const AGENCY_CURRENCIES = ['INR'] as const

/** Canonical payment method / destination categories used across Settings and Godown. */
export const PAYMENT_CATEGORIES = ['cash', 'upi', 'bank', 'indane_portal', 'other'] as const
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number]
/** @deprecated Prefer PaymentCategory — kept as an alias for existing imports. */
export type ReceivingAccountKind = PaymentCategory

export const LOCATION_KINDS = ['godown', 'vehicle', 'agent', 'csc', 'other'] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]
export type ProductKind = 'cylinder' | 'accessory' | 'other'

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  godown: 'Godown',
  vehicle: 'Vehicle',
  agent: 'Agent',
  csc: 'CSC point',
  other: 'Other',
}

export type NamedConfigItem = {
  id: string
  name: string
  active: boolean
}

export type PaymentMethod = NamedConfigItem & {
  kind: PaymentCategory
}

export type ReceivingAccountOwnership = 'agency' | 'third_party_held' | 'portal'

export type ReceivingAccount = NamedConfigItem & {
  /**
   * Primary category for display and legacy Godown filtering.
   * Prefer `compatiblePaymentMethodIds` when present.
   */
  kind: PaymentCategory
  /** Phase 5 destination ownership. Required on every active destination before financial opening. */
  ownership?: ReceivingAccountOwnership
  /**
   * Payment method IDs this destination accepts.
   * Empty/absent = legacy behaviour: match by `kind` only.
   */
  compatiblePaymentMethodIds?: string[]
}

export type AgencySettingsDoc = {
  name: string
  timezone: string
  currency: string
  paymentMethods: PaymentMethod[]
  receivingAccounts: ReceivingAccount[]
  expenseCategories: NamedConfigItem[]
  inventoryStates: string[]
  /** YYYY-MM-DD; null until inventory opening cutover is established. */
  inventoryCutoverDate: string | null
  /** YYYY-MM-DD; set when financial opening is published. */
  financialOpeningDate: string | null
  /** Owner loan liability in paise; verified at financial opening. */
  ownerLoanOutstandingPaise: number
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

export const PAYMENT_CATEGORY_LABELS: Record<PaymentCategory, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank',
  indane_portal: 'Indane Portal',
  other: 'Other',
}

export function newConfigId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}`
}

/** Normalize stored/legacy category strings to the canonical set. */
export function normalizePaymentCategory(value: unknown): PaymentCategory | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'portal' || normalized === 'indane_portal' || normalized === 'indaneportal') {
    return 'indane_portal'
  }
  if (
    normalized === 'cash' ||
    normalized === 'upi' ||
    normalized === 'bank' ||
    normalized === 'other'
  ) {
    return normalized
  }
  return null
}

/** Infer category from a free-form Settings payment-method name (legacy rows). */
export function inferPaymentCategoryFromName(name: string): PaymentCategory {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return 'other'
  if (normalized === 'cash' || normalized.startsWith('cash ')) return 'cash'
  if (normalized === 'upi' || normalized.includes('upi') || normalized === 'online' || normalized.includes('online')) {
    return 'upi'
  }
  if (normalized.includes('bank')) return 'bank'
  if (normalized.includes('portal') || normalized.includes('indane')) return 'indane_portal'
  return 'other'
}

function canonicalizePaymentMethodName(name: string, kind: PaymentCategory): string {
  const trimmed = name.trim()
  const key = trimmed.toLowerCase()
  const aliases: Record<PaymentCategory, string[]> = {
    cash: ['cash'],
    upi: ['upi', 'online'],
    bank: ['bank', 'bank transfer'],
    indane_portal: ['portal', 'indane portal', 'indane'],
    other: ['other'],
  }
  if (aliases[kind].includes(key)) return PAYMENT_CATEGORY_LABELS[kind]
  return trimmed
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

function asPaymentMethods(input: unknown): PaymentMethod[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const rawName = typeof row.name === 'string' ? row.name.trim() : ''
      if (!id || !rawName) return null
      const kind = normalizePaymentCategory(row.kind) ?? inferPaymentCategoryFromName(rawName)
      return {
        id,
        name: canonicalizePaymentMethodName(rawName, kind),
        kind,
        active: row.active !== false,
      }
    })
    .filter((item): item is PaymentMethod => item !== null)
}

function asOwnership(value: unknown): ReceivingAccountOwnership | undefined {
  if (value === 'agency' || value === 'third_party_held' || value === 'portal') return value
  return undefined
}

function asCompatibleMethodIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return ids.length > 0 ? [...new Set(ids)] : undefined
}

function asReceivingAccounts(input: unknown): ReceivingAccount[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      // Legacy rows may omit kind or use "portal"; also infer from name as last resort.
      const kind =
        normalizePaymentCategory(row.kind) ??
        (name ? inferPaymentCategoryFromName(name) : null)
      if (!id || !name || !kind) return null
      const ownership = asOwnership(row.ownership)
      const compatiblePaymentMethodIds = asCompatibleMethodIds(row.compatiblePaymentMethodIds)
      return {
        id,
        name,
        kind,
        active: row.active !== false,
        ...(ownership ? { ownership } : {}),
        ...(compatiblePaymentMethodIds ? { compatiblePaymentMethodIds } : {}),
      }
    })
    .filter((item): item is ReceivingAccount => item !== null)
}

export function parseAgencySettings(data: Record<string, unknown> | undefined): AgencySettingsDoc {
  const source = data ?? {}
  return {
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Miragpur Indane Gas Agency',
    timezone: typeof source.timezone === 'string' && source.timezone.trim() ? source.timezone.trim() : 'Asia/Kolkata',
    currency: typeof source.currency === 'string' && source.currency.trim() ? source.currency.trim() : 'INR',
    paymentMethods: asPaymentMethods(source.paymentMethods),
    receivingAccounts: asReceivingAccounts(source.receivingAccounts),
    expenseCategories: asNamedList(source.expenseCategories),
    inventoryStates: Array.isArray(source.inventoryStates)
      ? source.inventoryStates.filter((value): value is string => typeof value === 'string')
      : ['filled', 'empty', 'damaged'],
    inventoryCutoverDate:
      typeof source.inventoryCutoverDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.inventoryCutoverDate)
        ? source.inventoryCutoverDate
        : null,
    financialOpeningDate:
      typeof source.financialOpeningDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.financialOpeningDate)
        ? source.financialOpeningDate
        : null,
    ownerLoanOutstandingPaise:
      typeof source.ownerLoanOutstandingPaise === 'number' &&
      Number.isSafeInteger(source.ownerLoanOutstandingPaise) &&
      source.ownerLoanOutstandingPaise >= 0
        ? source.ownerLoanOutstandingPaise
        : 0,
    negativeStockAllowed: source.negativeStockAllowed === true,
    historicalCorrectionRequiresSecondAdmin: source.historicalCorrectionRequiresSecondAdmin === true,
  }
}

export function isLocationKind(value: unknown): value is LocationKind {
  return (
    value === 'godown' ||
    value === 'vehicle' ||
    value === 'agent' ||
    value === 'csc' ||
    value === 'other'
  )
}

export function parseLocation(id: string, data: Record<string, unknown>): LocationDoc | null {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const kind = isLocationKind(data.kind) ? data.kind : null
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
