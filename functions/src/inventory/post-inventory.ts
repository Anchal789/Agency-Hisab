import { FieldValue, getFirestore, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { parseAgencySettings, parseLocation, parseProduct } from '../../../shared/models/agency-config'
import {
  inventoryBalanceId,
  isInventoryTransactionType,
  reconciliationDeltas,
  type InventoryState,
} from '../../../shared/models/inventory'
import { isAdminRole } from '../../../shared/rules/permissions'
import { requireAdmin } from '../auth/guards'
import { requirePermission } from '../auth/permission-guards'
import {
  applyLedgerAndBalancesInTx,
  loadBalanceMap,
  openingExistsInTx,
  readAgencyInTx,
  setCutoverDateIfUnsetInTx,
  writeOpeningGuardInTx,
  type LedgerWriteSpec,
} from './apply-inventory'
import {
  approveInventoryTransactionSchema,
  createStockOpeningSchema,
  createStockReceiptSchema,
  createStockReconciliationSchema,
  createStockReturnToDistributorSchema,
  createStockTransferSchema,
  rejectInventoryTransactionSchema,
} from '../shared/inventory-schema'

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'Check the inventory form and try again.'
}

function actorIsAdmin(context: functions.https.CallableContext): boolean {
  return Boolean(context.auth && isAdminRole(context.auth.token.role))
}

async function loadLookups() {
  const db = getFirestore()
  const [agencySnap, productsSnap, locationsSnap] = await Promise.all([
    db.collection('settings').doc('agency').get(),
    db.collection('products').get(),
    db.collection('locations').get(),
  ])
  if (!agencySnap.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Agency settings are missing. Run npm run bootstrap:admin, then finish Settings (locations and cylinder types) before recording stock.',
    )
  }
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const products = productsSnap.docs
    .map((doc) => parseProduct(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is NonNullable<typeof row> => row !== null)
  const locations = locationsSnap.docs
    .map((doc) => parseLocation(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is NonNullable<typeof row> => row !== null)
  return { agency, products, locations }
}

function requireCylinderProduct(
  products: Array<NonNullable<ReturnType<typeof parseProduct>>>,
  productId: string,
) {
  const product = products.find((row) => row.id === productId)
  if (!product || !product.active || product.kind !== 'cylinder') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Cylinder product not found or inactive. Add an active cylinder type in Settings, then use that product id.',
    )
  }
  return product
}

function requireActiveLocation(
  locations: Array<NonNullable<ReturnType<typeof parseLocation>>>,
  locationId: string,
) {
  const location = locations.find((row) => row.id === locationId)
  if (!location || !location.active) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Location not found or inactive. Create an active location in Settings, then use that location id.',
    )
  }
  return location
}

function postingDecision(isAdmin: boolean): {
  status: 'posted' | 'pending_approval'
  approval: 'not_required' | 'pending' | 'approved'
} {
  if (isAdmin) return { status: 'posted', approval: 'approved' }
  return { status: 'pending_approval', approval: 'pending' }
}

type QuantityTriple = { filled: number; empty: number; damaged: number }

function quantityLines(
  locationId: string,
  productId: string,
  qty: QuantityTriple,
  movementType: 'opening' | 'distributor_receipt' | 'distributor_return',
  sign: 1 | -1,
): LedgerWriteSpec[] {
  const lines: LedgerWriteSpec[] = []
  let seq = 0
  const push = (state: InventoryState, amount: number) => {
    if (amount < 1) return
    lines.push({
      locationId,
      productId,
      state,
      quantityDelta: sign * amount,
      movementType,
      seq: seq++,
    })
  }
  push('filled', qty.filled)
  push('empty', qty.empty)
  push('damaged', qty.damaged)
  return lines
}

async function createInventoryDocument(input: {
  context: functions.https.CallableContext
  permission:
    | 'inventory.openingStock'
    | 'inventory.receive'
    | 'inventory.transfer'
    | 'inventory.reconcile'
  parsed: {
    transactionId: string
    idempotencyKey: string
    businessDate: string
    note?: string | null
  }
  type:
    | 'stock_opening'
    | 'stock_receipt'
    | 'stock_return_distributor'
    | 'stock_transfer'
    | 'stock_reconciliation'
  buildPendingPayload: (args: {
    actorUid: string
    productName: string
    locationName: string | null
  }) => Record<string, unknown>
  buildLines: () => LedgerWriteSpec[]
  /** Reads and validation only. Must not write. */
  prepareInTx?: (tx: Transaction, actorUid: string) => Promise<void>
  /** Writes only. Runs after all transaction reads (including balances). */
  commitExtrasInTx?: (tx: Transaction, actorUid: string) => void
  locationIdsForBalances: Array<{ locationId: string; productId: string; state: InventoryState }>
  productId: string
  locationIdForProductCheck?: string
}) {
  const actorUid = await requirePermission(input.context, input.permission)
  const isAdmin = actorIsAdmin(input.context)
  const { agency, products, locations } = await loadLookups()
  requireCylinderProduct(products, input.productId)
  const product = products.find((row) => row.id === input.productId)!
  const locationName = input.locationIdForProductCheck
    ? requireActiveLocation(locations, input.locationIdForProductCheck).name
    : null

  const decision = postingDecision(isAdmin)
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(input.parsed.transactionId)
  const idemRef = db.collection('idempotencyRecords').doc(input.parsed.idempotencyKey)
  const lines = input.buildLines()

  const result = await db.runTransaction(async (tx) => {
    // All reads first — Firestore rejects any read after a write in the same transaction.
    const [existingTx, existingIdem] = await Promise.all([tx.get(txRef), tx.get(idemRef)])
    if (existingIdem.exists) {
      const previousId = existingIdem.data()?.transactionId
      if (typeof previousId === 'string') {
        const priorSnap = await tx.get(db.collection('transactions').doc(previousId))
        const priorStatus = priorSnap.exists ? String(priorSnap.data()?.status ?? decision.status) : decision.status
        return { id: previousId, reused: true, status: priorStatus }
      }
      throw new functions.https.HttpsError('aborted', 'Idempotency record is incomplete.')
    }
    if (existingTx.exists) {
      throw new functions.https.HttpsError('already-exists', 'A transaction with this id already exists.')
    }

    if (input.prepareInTx) {
      await input.prepareInTx(tx, actorUid)
    }

    const balances =
      decision.status === 'posted' ? await loadBalanceMap(tx, input.locationIdsForBalances) : null

    // All writes after reads.
    if (decision.status === 'posted' && input.commitExtrasInTx) {
      input.commitExtrasInTx(tx, actorUid)
    }

    const baseDoc = {
      type: input.type,
      status: decision.status,
      approval: decision.approval,
      businessDate: input.parsed.businessDate,
      timezone: agency.timezone || 'Asia/Kolkata',
      productId: product.id,
      productName: product.name,
      note: input.parsed.note ?? '',
      idempotencyKey: input.parsed.idempotencyKey,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...input.buildPendingPayload({
        actorUid,
        productName: product.name,
        locationName,
      }),
    }

    tx.set(txRef, baseDoc)
    tx.set(idemRef, {
      transactionId: txRef.id,
      actorUid,
      requestHash: input.type,
      createdAt: FieldValue.serverTimestamp(),
    })

    if (decision.status === 'posted' && balances) {
      applyLedgerAndBalancesInTx(tx, {
        transactionId: txRef.id,
        businessDate: input.parsed.businessDate,
        actorUid,
        lines,
        currentBalances: balances,
        allowNegative: agency.negativeStockAllowed === true && isAdmin,
      })
    }

    tx.set(db.collection('auditLogs').doc(), {
      action: `${input.type}.created`,
      actorUid,
      transactionId: txRef.id,
      status: decision.status,
      businessDate: input.parsed.businessDate,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { id: txRef.id, reused: false, status: decision.status }
  })

  return result
}

export const createStockOpening = functions.region('asia-south1').https.onCall(async (data, context) => {
  const parsed = createStockOpeningSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const { locations } = await loadLookups()
  const openingLocation = requireActiveLocation(locations, input.locationId)
  if (openingLocation.kind !== 'godown') {
    const reason = (input.note ?? '').trim()
    if (reason.length < 3) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Enter a reason when recording opening stock outside the main godown (existing physical stock exception).',
      )
    }
  }

  let openingAgencyRead: Awaited<ReturnType<typeof readAgencyInTx>> | null = null

  return createInventoryDocument({
    context,
    permission: 'inventory.openingStock',
    parsed: input,
    type: 'stock_opening',
    productId: input.productId,
    locationIdForProductCheck: input.locationId,
    locationIdsForBalances: [
      { locationId: input.locationId, productId: input.productId, state: 'filled' },
      { locationId: input.locationId, productId: input.productId, state: 'empty' },
      { locationId: input.locationId, productId: input.productId, state: 'damaged' },
    ],
    buildLines: () =>
      quantityLines(
        input.locationId,
        input.productId,
        {
          filled: input.filledQuantity,
          empty: input.emptyQuantity,
          damaged: input.damagedQuantity,
        },
        'opening',
        1,
      ),
    buildPendingPayload: () => ({
      locationId: input.locationId,
      quantities: {
        filledIssued: input.filledQuantity,
        emptyReceived: input.emptyQuantity,
        emptyOutstanding: input.damagedQuantity,
      },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      customerKind: 'custom',
      customerId: null,
      customerSnapshot: {
        name: 'Opening stock',
        consumerNumber: null,
        address: '',
        city: '',
        lastRefillDate: null,
      },
      bookingStatus: 'no',
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      originTransactionId: null,
      obligationId: null,
      inventoryPayload: {
        filledQuantity: input.filledQuantity,
        emptyQuantity: input.emptyQuantity,
        damagedQuantity: input.damagedQuantity,
      },
    }),
    prepareInTx: async (tx) => {
      const exists = await openingExistsInTx(tx, input.locationId, input.productId)
      if (exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Opening stock is already recorded for this location and cylinder type.',
        )
      }
      // Pre-read agency for cutover write after balances; must stay in the read phase.
      if (actorIsAdmin(context)) {
        openingAgencyRead = await readAgencyInTx(tx)
      }
    },
    commitExtrasInTx: (tx, actorUid) => {
      if (!actorIsAdmin(context) || !openingAgencyRead) return
      writeOpeningGuardInTx(tx, {
        locationId: input.locationId,
        productId: input.productId,
        openingTransactionId: input.transactionId,
        businessDate: input.businessDate,
        actorUid,
      })
      setCutoverDateIfUnsetInTx(
        tx,
        openingAgencyRead.ref,
        openingAgencyRead.agency.inventoryCutoverDate,
        input.businessDate,
        actorUid,
      )
    },
  })
})

export const createStockReceipt = functions.region('asia-south1').https.onCall(async (data, context) => {
  const parsed = createStockReceiptSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  return createInventoryDocument({
    context,
    permission: 'inventory.receive',
    parsed: input,
    type: 'stock_receipt',
    productId: input.productId,
    locationIdForProductCheck: input.locationId,
    locationIdsForBalances: [
      { locationId: input.locationId, productId: input.productId, state: 'filled' },
      { locationId: input.locationId, productId: input.productId, state: 'empty' },
      { locationId: input.locationId, productId: input.productId, state: 'damaged' },
    ],
    buildLines: () =>
      quantityLines(
        input.locationId,
        input.productId,
        {
          filled: input.filledQuantity,
          empty: input.emptyQuantity,
          damaged: input.damagedQuantity,
        },
        'distributor_receipt',
        1,
      ),
    buildPendingPayload: () => ({
      locationId: input.locationId,
      quantities: {
        filledIssued: input.filledQuantity,
        emptyReceived: input.emptyQuantity,
        emptyOutstanding: input.damagedQuantity,
      },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      customerKind: 'custom',
      customerId: null,
      customerSnapshot: {
        name: 'Plant receipt',
        consumerNumber: null,
        address: '',
        city: '',
        lastRefillDate: null,
      },
      bookingStatus: 'no',
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      originTransactionId: null,
      obligationId: null,
      inventoryPayload: {
        filledQuantity: input.filledQuantity,
        emptyQuantity: input.emptyQuantity,
        damagedQuantity: input.damagedQuantity,
      },
    }),
    prepareInTx: async (tx) => {
      const opened = await openingExistsInTx(tx, input.locationId, input.productId)
      if (!opened) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Record opening stock for this location and product before receiving stock.',
        )
      }
    },
  })
})

export const createStockReturnToDistributor = functions.region('asia-south1').https.onCall(async (data, context) => {
  const parsed = createStockReturnToDistributorSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  return createInventoryDocument({
    context,
    permission: 'inventory.receive',
    parsed: input,
    type: 'stock_return_distributor',
    productId: input.productId,
    locationIdForProductCheck: input.locationId,
    locationIdsForBalances: [
      { locationId: input.locationId, productId: input.productId, state: 'filled' },
      { locationId: input.locationId, productId: input.productId, state: 'empty' },
      { locationId: input.locationId, productId: input.productId, state: 'damaged' },
    ],
    buildLines: () =>
      quantityLines(
        input.locationId,
        input.productId,
        {
          filled: input.filledQuantity,
          empty: input.emptyQuantity,
          damaged: input.damagedQuantity,
        },
        'distributor_return',
        -1,
      ),
    buildPendingPayload: () => ({
      locationId: input.locationId,
      quantities: {
        filledIssued: input.filledQuantity,
        emptyReceived: input.emptyQuantity,
        emptyOutstanding: input.damagedQuantity,
      },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      customerKind: 'custom',
      customerId: null,
      customerSnapshot: {
        name: 'Return to plant',
        consumerNumber: null,
        address: '',
        city: '',
        lastRefillDate: null,
      },
      bookingStatus: 'no',
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      originTransactionId: null,
      obligationId: null,
      inventoryPayload: {
        filledQuantity: input.filledQuantity,
        emptyQuantity: input.emptyQuantity,
        damagedQuantity: input.damagedQuantity,
      },
    }),
    prepareInTx: async (tx) => {
      const opened = await openingExistsInTx(tx, input.locationId, input.productId)
      if (!opened) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Record opening stock for this location and product before returning stock.',
        )
      }
    },
  })
})

export const createStockTransfer = functions.region('asia-south1').https.onCall(async (data, context) => {
  const parsed = createStockTransferSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const { locations } = await loadLookups()
  requireActiveLocation(locations, input.sourceLocationId)
  requireActiveLocation(locations, input.destinationLocationId)

  return createInventoryDocument({
    context,
    permission: 'inventory.transfer',
    parsed: input,
    type: 'stock_transfer',
    productId: input.productId,
    locationIdsForBalances: [
      { locationId: input.sourceLocationId, productId: input.productId, state: input.state },
      { locationId: input.destinationLocationId, productId: input.productId, state: input.state },
    ],
    buildLines: () => [
      {
        locationId: input.sourceLocationId,
        productId: input.productId,
        state: input.state,
        quantityDelta: -input.quantity,
        movementType: 'transfer_out',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        seq: 0,
      },
      {
        locationId: input.destinationLocationId,
        productId: input.productId,
        state: input.state,
        quantityDelta: input.quantity,
        movementType: 'transfer_in',
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        seq: 1,
      },
    ],
    buildPendingPayload: () => ({
      locationId: input.sourceLocationId,
      quantities: {
        filledIssued: input.state === 'filled' ? input.quantity : 0,
        emptyReceived: input.state === 'empty' ? input.quantity : 0,
        emptyOutstanding: input.state === 'damaged' ? input.quantity : 0,
      },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      customerKind: 'custom',
      customerId: null,
      customerSnapshot: {
        name: 'Stock transfer',
        consumerNumber: null,
        address: '',
        city: '',
        lastRefillDate: null,
      },
      bookingStatus: 'no',
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      originTransactionId: null,
      obligationId: null,
      inventoryPayload: {
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        state: input.state,
        quantity: input.quantity,
      },
    }),
    // Available stock is the ledger balance, not inventoryOpenings.
    // Source/destination may have never had an opening row (e.g. agent stock from a prior transfer).
  })
})

export const createStockReconciliation = functions.region('asia-south1').https.onCall(async (data, context) => {
  const parsed = createStockReconciliationSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()

  // Capture system quantities at submit time for the payload.
  const [filledSnap, emptySnap, damagedSnap] = await Promise.all([
    db.collection('inventoryBalances').doc(inventoryBalanceId(input.locationId, input.productId, 'filled')).get(),
    db.collection('inventoryBalances').doc(inventoryBalanceId(input.locationId, input.productId, 'empty')).get(),
    db.collection('inventoryBalances').doc(inventoryBalanceId(input.locationId, input.productId, 'damaged')).get(),
  ])
  const systemFilled = Number(filledSnap.data()?.quantity ?? 0)
  const systemEmpty = Number(emptySnap.data()?.quantity ?? 0)
  const systemDamaged = Number(damagedSnap.data()?.quantity ?? 0)
  const deltas = reconciliationDeltas({
    locationId: input.locationId,
    productId: input.productId,
    systemFilled: Number.isSafeInteger(systemFilled) ? systemFilled : 0,
    systemEmpty: Number.isSafeInteger(systemEmpty) ? systemEmpty : 0,
    systemDamaged: Number.isSafeInteger(systemDamaged) ? systemDamaged : 0,
    actualFilled: input.actualFilled,
    actualEmpty: input.actualEmpty,
    actualDamaged: input.actualDamaged,
  })
  if (deltas.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Physical counts match system stock; nothing to adjust.')
  }

  return createInventoryDocument({
    context,
    permission: 'inventory.reconcile',
    parsed: { ...input, note: input.note ?? input.reason },
    type: 'stock_reconciliation',
    productId: input.productId,
    locationIdForProductCheck: input.locationId,
    locationIdsForBalances: [
      { locationId: input.locationId, productId: input.productId, state: 'filled' },
      { locationId: input.locationId, productId: input.productId, state: 'empty' },
      { locationId: input.locationId, productId: input.productId, state: 'damaged' },
    ],
    buildLines: () =>
      deltas.map((delta, seq) => ({
        locationId: delta.locationId,
        productId: delta.productId,
        state: delta.state,
        quantityDelta: delta.quantityDelta,
        movementType: 'adjustment' as const,
        note: input.reason,
        seq,
      })),
    buildPendingPayload: () => ({
      locationId: input.locationId,
      quantities: {
        filledIssued: input.actualFilled,
        emptyReceived: input.actualEmpty,
        emptyOutstanding: input.actualDamaged,
      },
      amountsPaise: { salePaise: 0, receivedPaise: 0, duePaise: 0 },
      customerKind: 'custom',
      customerId: null,
      customerSnapshot: {
        name: 'Stock reconciliation',
        consumerNumber: null,
        address: '',
        city: '',
        lastRefillDate: null,
      },
      bookingStatus: 'no',
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      originTransactionId: null,
      obligationId: null,
      reverseReason: input.reason,
      inventoryPayload: {
        systemFilled,
        systemEmpty,
        systemDamaged,
        actualFilled: input.actualFilled,
        actualEmpty: input.actualEmpty,
        actualDamaged: input.actualDamaged,
        reason: input.reason,
      },
    }),
    // System quantities come from inventoryBalances; opening is not required after transfer-in stock.
  })
})

function linesFromPendingInventoryDoc(data: DocumentData): LedgerWriteSpec[] {
  const type = data.type
  const payload = (data.inventoryPayload ?? {}) as Record<string, unknown>
  const productId = String(data.productId ?? '')
  const locationId = String(data.locationId ?? '')

  if (type === 'stock_opening' || type === 'stock_receipt' || type === 'stock_return_distributor') {
    const filled = Number(payload.filledQuantity ?? 0)
    const empty = Number(payload.emptyQuantity ?? 0)
    const damaged = Number(payload.damagedQuantity ?? 0)
    const movement =
      type === 'stock_opening'
        ? 'opening'
        : type === 'stock_receipt'
          ? 'distributor_receipt'
          : 'distributor_return'
    const sign = type === 'stock_return_distributor' ? -1 : 1
    return quantityLines(locationId, productId, { filled, empty, damaged }, movement, sign as 1 | -1)
  }

  if (type === 'stock_transfer') {
    const sourceLocationId = String(payload.sourceLocationId ?? '')
    const destinationLocationId = String(payload.destinationLocationId ?? '')
    const state = payload.state as InventoryState
    const quantity = Number(payload.quantity ?? 0)
    return [
      {
        locationId: sourceLocationId,
        productId,
        state,
        quantityDelta: -quantity,
        movementType: 'transfer_out',
        sourceLocationId,
        destinationLocationId,
        seq: 0,
      },
      {
        locationId: destinationLocationId,
        productId,
        state,
        quantityDelta: quantity,
        movementType: 'transfer_in',
        sourceLocationId,
        destinationLocationId,
        seq: 1,
      },
    ]
  }

  if (type === 'stock_reconciliation') {
    const deltas = reconciliationDeltas({
      locationId,
      productId,
      systemFilled: Number(payload.systemFilled ?? 0),
      systemEmpty: Number(payload.systemEmpty ?? 0),
      systemDamaged: Number(payload.systemDamaged ?? 0),
      actualFilled: Number(payload.actualFilled ?? 0),
      actualEmpty: Number(payload.actualEmpty ?? 0),
      actualDamaged: Number(payload.actualDamaged ?? 0),
    })
    return deltas.map((delta, seq) => ({
      locationId: delta.locationId,
      productId: delta.productId,
      state: delta.state,
      quantityDelta: delta.quantityDelta,
      movementType: 'adjustment' as const,
      note: String(payload.reason ?? ''),
      seq,
    }))
  }

  throw new functions.https.HttpsError('failed-precondition', 'Unsupported inventory transaction type.')
}

export const approveInventoryTransaction = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = approveInventoryTransactionSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(parsed.data.transactionId)

  await db.runTransaction(async (tx) => {
    // All reads first — Firestore rejects any read after a write in the same transaction.
    const snap = await tx.get(txRef)
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Transaction not found.')
    const current = snap.data() ?? {}
    if (!isInventoryTransactionType(current.type)) {
      throw new functions.https.HttpsError('failed-precondition', 'Not an inventory transaction.')
    }
    if (current.status !== 'pending_approval') {
      throw new functions.https.HttpsError('failed-precondition', 'Only pending inventory entries can be approved.')
    }

    const lines = linesFromPendingInventoryDoc(current)
    const keys = lines.map((line) => ({
      locationId: line.locationId,
      productId: line.productId,
      state: line.state,
    }))

    let openingAgencyRead: Awaited<ReturnType<typeof readAgencyInTx>> | null = null
    let openingLocationId = ''
    let openingProductId = ''

    if (current.type === 'stock_opening') {
      openingLocationId = String(current.locationId ?? '')
      openingProductId = String(current.productId ?? '')
      const exists = await openingExistsInTx(tx, openingLocationId, openingProductId)
      if (exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Opening stock is already recorded for this location and cylinder type.',
        )
      }
      openingAgencyRead = await readAgencyInTx(tx)
    } else {
      const locationId = String(current.locationId ?? lines[0]?.locationId ?? '')
      const productId = String(current.productId ?? '')
      if (current.type === 'stock_transfer' || current.type === 'stock_reconciliation') {
        // Balance sufficiency is enforced by applyLedgerAndBalancesInTx. Opening is not required.
      } else if (locationId && productId) {
        // Plant receive/return still require an initialized location+product (normally godown opening).
        const opened = await openingExistsInTx(tx, locationId, productId)
        if (!opened) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Opening stock is required before approving this movement.',
          )
        }
      }
      openingAgencyRead = await readAgencyInTx(tx)
    }

    const balances = await loadBalanceMap(tx, keys)

    // All writes after reads.
    if (current.type === 'stock_opening' && openingAgencyRead) {
      writeOpeningGuardInTx(tx, {
        locationId: openingLocationId,
        productId: openingProductId,
        openingTransactionId: txRef.id,
        businessDate: String(current.businessDate),
        actorUid,
      })
      setCutoverDateIfUnsetInTx(
        tx,
        openingAgencyRead.ref,
        openingAgencyRead.agency.inventoryCutoverDate,
        String(current.businessDate),
        actorUid,
      )
    }

    applyLedgerAndBalancesInTx(tx, {
      transactionId: txRef.id,
      businessDate: String(current.businessDate),
      actorUid,
      lines,
      currentBalances: balances,
      allowNegative: openingAgencyRead?.agency.negativeStockAllowed === true,
    })

    tx.update(txRef, {
      status: 'posted',
      approval: 'approved',
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.set(db.collection('auditLogs').doc(), {
      action: 'inventory.approved',
      actorUid,
      transactionId: txRef.id,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return { id: parsed.data.transactionId }
})

export const rejectInventoryTransaction = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = rejectInventoryTransactionSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(parsed.data.transactionId)

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(txRef)
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Transaction not found.')
    const current = snap.data() ?? {}
    if (!isInventoryTransactionType(current.type)) {
      throw new functions.https.HttpsError('failed-precondition', 'Not an inventory transaction.')
    }
    if (current.status !== 'pending_approval') {
      throw new functions.https.HttpsError('failed-precondition', 'Only pending inventory entries can be rejected.')
    }
    tx.update(txRef, {
      status: 'rejected',
      approval: 'rejected',
      reverseReason: parsed.data.reason,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.set(db.collection('auditLogs').doc(), {
      action: 'inventory.rejected',
      actorUid,
      transactionId: txRef.id,
      reason: parsed.data.reason,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return { id: parsed.data.transactionId }
})
