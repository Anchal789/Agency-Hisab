import { useQuery } from '@tanstack/react-query'
import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '@shared/calculations/business-date'
import { FormField } from '@/components/forms/FormField'
import { Input } from '@/components/ui/input'
import { fetchInventoryMasterData } from './inventory-query'

export function useInventoryMasters() {
  return useQuery({ queryKey: ['inventory-master'], queryFn: fetchInventoryMasterData })
}

export function todayBusinessDate(): string {
  return businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)
}

export function QtyFields({
  filled,
  empty,
  damaged,
  onChange,
}: {
  filled: string
  empty: string
  damaged: string
  onChange: (next: { filled?: string; empty?: string; damaged?: string }) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField label="Filled">
        <Input inputMode="numeric" value={filled} onChange={(e) => onChange({ filled: e.target.value })} />
      </FormField>
      <FormField label="Empty">
        <Input inputMode="numeric" value={empty} onChange={(e) => onChange({ empty: e.target.value })} />
      </FormField>
      <FormField label="Damaged">
        <Input inputMode="numeric" value={damaged} onChange={(e) => onChange({ damaged: e.target.value })} />
      </FormField>
    </div>
  )
}

export function LocationProductFields({
  locationId,
  productId,
  locations,
  products,
  onLocation,
  onProduct,
  locationLabel = 'Location',
}: {
  locationId: string
  productId: string
  locations: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string }>
  onLocation: (id: string) => void
  onProduct: (id: string) => void
  locationLabel?: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={locationLabel}>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={locationId}
          onChange={(e) => onLocation(e.target.value)}
        >
          <option value="">Select…</option>
          {locations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Cylinder type">
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={productId}
          onChange={(e) => onProduct(e.target.value)}
        >
          <option value="">Select…</option>
          {products.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </FormField>
    </div>
  )
}
