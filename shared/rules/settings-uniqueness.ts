/**
 * Category-aware uniqueness for Settings configuration lists.
 *
 * General rule: same normalized name + same category key = duplicate.
 * Same name in a different category (or unrelated Settings section) is allowed.
 */

export function normalizeConfigName(value: string): string {
  return value.trim().toLowerCase()
}

/** Composite uniqueness key: normalized name + category/type discriminator. */
export function configNameCategoryKey(name: string, category: string): string {
  return `${normalizeConfigName(name)}::${category}`
}

/** Detect duplicates within a full replacement list (payment methods / destinations). */
export function findDuplicateConfigKeyInList<T extends { id: string }>(
  items: readonly T[],
  keyFor: (item: T) => string,
): { id: string; key: string } | null {
  const seen = new Map<string, string>()
  for (const item of items) {
    const key = keyFor(item)
    const previous = seen.get(key)
    if (previous && previous !== item.id) {
      return { id: item.id, key }
    }
    seen.set(key, item.id)
  }
  return null
}

/** True when another item (excluding candidate.id) already owns the same composite key. */
export function isDuplicateAmong<T extends { id: string }>(
  items: readonly T[],
  candidate: { id?: string },
  keyForCandidate: string,
  keyFor: (item: T) => string,
): boolean {
  return items.some(
    (item) => item.id !== candidate.id && keyFor(item) === keyForCandidate,
  )
}

export function paymentMethodUniquenessKey(item: { name: string; kind: string }): string {
  return configNameCategoryKey(item.name, item.kind)
}

export function receivingAccountUniquenessKey(item: { name: string; kind: string }): string {
  return configNameCategoryKey(item.name, item.kind)
}

export function locationUniquenessKey(item: { name: string; kind: string }): string {
  return configNameCategoryKey(item.name, item.kind)
}

export function productNameUniquenessKey(item: { name: string; kind: string }): string {
  return configNameCategoryKey(item.name, item.kind)
}

export function productCodeUniquenessKey(code: string): string {
  return normalizeConfigName(code)
}

/** Price labels are unique per product (category = productId). */
export function priceRuleUniquenessKey(item: { label: string; productId: string }): string {
  return configNameCategoryKey(item.label, item.productId)
}
