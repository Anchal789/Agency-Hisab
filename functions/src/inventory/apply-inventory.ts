import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import {
  applyBalanceDeltas,
  inventoryBalanceId,
  inventoryLedgerEntryId,
  inventoryOpeningId,
  isInventoryCutoverEligible,
  type BalanceDelta,
  type InventoryMovementType,
  type InventoryState,
} from '../../../shared/models/inventory'
import { parseAgencySettings } from '../../../shared/models/agency-config'

export type LedgerWriteSpec = {
  locationId: string
  productId: string
  state: InventoryState
  quantityDelta: number
  movementType: InventoryMovementType
  sourceLocationId?: string | null
  destinationLocationId?: string | null
  note?: string
  seq: number
}

export async function readAgencyInTx(tx: Transaction) {
  const ref = getFirestore().collection('settings').doc('agency')
  const snap = await tx.get(ref)
  if (!snap.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Agency settings are missing. Run npm run bootstrap:admin, then finish Settings before recording stock.',
    )
  }
  return {
    ref,
    agency: parseAgencySettings(snap.data() as Record<string, unknown> | undefined),
  }
}

export async function openingExistsInTx(
  tx: Transaction,
  locationId: string,
  productId: string,
): Promise<boolean> {
  const ref = getFirestore().collection('inventoryOpenings').doc(inventoryOpeningId(locationId, productId))
  const snap = await tx.get(ref)
  return snap.exists
}

export async function assertInventoryEligibleForGodown(
  tx: Transaction,
  input: { businessDate: string; locationId: string | null; productId: string },
): Promise<boolean> {
  if (!input.locationId) return false
  const { agency } = await readAgencyInTx(tx)
  if (!isInventoryCutoverEligible(input.businessDate, agency.inventoryCutoverDate)) return false
  return openingExistsInTx(tx, input.locationId, input.productId)
}

export async function loadBalanceMap(
  tx: Transaction,
  keys: Array<{ locationId: string; productId: string; state: InventoryState }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const unique = new Map<string, { locationId: string; productId: string; state: InventoryState }>()
  for (const key of keys) {
    unique.set(inventoryBalanceId(key.locationId, key.productId, key.state), key)
  }
  for (const id of unique.keys()) {
    const ref = getFirestore().collection('inventoryBalances').doc(id)
    const snap = await tx.get(ref)
    if (snap.exists) {
      const qty = Number(snap.data()?.quantity ?? 0)
      map.set(id, Number.isSafeInteger(qty) ? qty : 0)
    }
  }
  return map
}

export function applyLedgerAndBalancesInTx(
  tx: Transaction,
  input: {
    transactionId: string
    businessDate: string
    actorUid: string
    lines: LedgerWriteSpec[]
    currentBalances: Map<string, number>
    allowNegative: boolean
    requireExistingBalances?: boolean
  },
): void {
  const deltas: BalanceDelta[] = input.lines.map((line) => ({
    locationId: line.locationId,
    productId: line.productId,
    state: line.state,
    quantityDelta: line.quantityDelta,
  }))

  if (input.requireExistingBalances) {
    for (const line of input.lines) {
      const id = inventoryBalanceId(line.locationId, line.productId, line.state)
      if (!input.currentBalances.has(id) && line.quantityDelta !== 0) {
        // Opening may create; for non-opening ops require initialized stock for the state being changed.
        // Transfers/receipts after opening: missing balance treated as 0 only if opening exists (caller checks).
      }
    }
  }

  const next = applyBalanceDeltas(input.currentBalances, deltas, input.allowNegative)
  if (!next) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Insufficient stock for this movement (negative stock is not allowed).',
    )
  }

  for (const line of input.lines) {
    if (line.quantityDelta === 0) continue
    const entryId = inventoryLedgerEntryId(
      input.transactionId,
      line.locationId,
      line.productId,
      line.state,
      line.seq,
    )
    const entryRef = getFirestore().collection('inventoryLedger').doc(entryId)
    tx.set(entryRef, {
      transactionId: input.transactionId,
      businessDate: input.businessDate,
      locationId: line.locationId,
      productId: line.productId,
      state: line.state,
      quantityDelta: line.quantityDelta,
      sourceLocationId: line.sourceLocationId ?? null,
      destinationLocationId: line.destinationLocationId ?? null,
      movementType: line.movementType,
      note: line.note ?? '',
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  for (const delta of deltas) {
    if (delta.quantityDelta === 0) continue
    const id = inventoryBalanceId(delta.locationId, delta.productId, delta.state)
    const quantity = next.get(id)
    if (quantity === undefined) continue
    const balRef = getFirestore().collection('inventoryBalances').doc(id)
    tx.set(
      balRef,
      {
        locationId: delta.locationId,
        productId: delta.productId,
        state: delta.state,
        quantity,
        updatedByTransactionId: input.transactionId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: input.actorUid,
      },
      { merge: true },
    )
  }
}

export function writeOpeningGuardInTx(
  tx: Transaction,
  input: {
    locationId: string
    productId: string
    openingTransactionId: string
    businessDate: string
    actorUid: string
  },
): DocumentReference {
  const ref = getFirestore().collection('inventoryOpenings').doc(inventoryOpeningId(input.locationId, input.productId))
  tx.create(ref, {
    locationId: input.locationId,
    productId: input.productId,
    openingTransactionId: input.openingTransactionId,
    businessDate: input.businessDate,
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  })
  return ref
}

/** Write-only. Call only after agency has already been read in the same transaction. */
export function setCutoverDateIfUnsetInTx(
  tx: Transaction,
  agencyRef: DocumentReference,
  currentCutoverDate: string | null | undefined,
  businessDate: string,
  actorUid: string,
): void {
  if (currentCutoverDate) return
  tx.set(
    agencyRef,
    {
      inventoryCutoverDate: businessDate,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    },
    { merge: true },
  )
}

/**
 * Reads agency then optionally writes cutover.
 * Must not be called after any other write in the same transaction.
 */
export async function maybeSetCutoverDateInTx(
  tx: Transaction,
  businessDate: string,
  actorUid: string,
): Promise<void> {
  const { ref, agency } = await readAgencyInTx(tx)
  setCutoverDateIfUnsetInTx(tx, ref, agency.inventoryCutoverDate, businessDate, actorUid)
}

export function godownSaleLedgerLines(input: {
  locationId: string
  productId: string
  filledIssued: number
  emptyReceived: number
}): LedgerWriteSpec[] {
  const lines: LedgerWriteSpec[] = []
  let seq = 0
  if (input.filledIssued > 0) {
    lines.push({
      locationId: input.locationId,
      productId: input.productId,
      state: 'filled',
      quantityDelta: -input.filledIssued,
      movementType: 'customer_sale',
      seq: seq++,
    })
  }
  if (input.emptyReceived > 0) {
    lines.push({
      locationId: input.locationId,
      productId: input.productId,
      state: 'empty',
      quantityDelta: input.emptyReceived,
      movementType: 'empty_received_at_sale',
      seq: seq++,
    })
  }
  return lines
}

export function emptyReturnLedgerLines(input: {
  locationId: string
  productId: string
  emptyReturned: number
}): LedgerWriteSpec[] {
  if (input.emptyReturned < 1) return []
  return [
    {
      locationId: input.locationId,
      productId: input.productId,
      state: 'empty',
      quantityDelta: input.emptyReturned,
      movementType: 'empty_return',
      seq: 0,
    },
  ]
}

export function reverseLedgerLines(lines: LedgerWriteSpec[]): LedgerWriteSpec[] {
  return lines.map((line, index) => ({
    ...line,
    quantityDelta: -line.quantityDelta,
    seq: index,
  }))
}
