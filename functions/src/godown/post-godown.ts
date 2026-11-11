import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '../../../shared/calculations/business-date'
import {
  parseAgencySettings,
  parseLocation,
  parseProduct,
  type PaymentMethod,
  type ReceivingAccount,
} from '../../../shared/models/agency-config'
import { normalizeWhitespace } from '../../../shared/models/customer'
import { obligationStatusFromQuantities } from '../../../shared/models/transaction'
import {
  destinationsForPaymentMethod,
  isDestinationCompatibleWithPaymentMethod,
} from '../../../shared/rules/payment-destinations'
import { requireAdmin } from '../auth/guards'
import { requirePermission } from '../auth/permission-guards'
import {
  amountsFromReceivedAndDue,
  createGodownSaleSchema,
  derivedSaleQuantities,
  recordEmptyReturnSchema,
  reverseGodownSaleSchema,
  updateGodownSaleSchema,
  type CreateGodownSaleInput,
  type UpdateGodownSaleInput,
} from '../shared/godown-schema'

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'Check the godown form and try again.'
}

function requireActiveById<T extends { id: string; active: boolean }>(
  items: readonly T[],
  id: string | null | undefined,
  label: string,
): T | null {
  if (!id) return null
  const found = items.find((item) => item.id === id)
  if (!found || !found.active) {
    throw new functions.https.HttpsError('invalid-argument', `Select a valid ${label}.`)
  }
  return found
}

function assertTodayBusinessDate(businessDate: string): void {
  const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)
  if (businessDate !== today) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Only entries for today’s business date can be changed or deleted this way.',
    )
  }
}

async function loadAgencyLookups() {
  const db = getFirestore()
  const [agencySnap, productsSnap, locationsSnap] = await Promise.all([
    db.collection('settings').doc('agency').get(),
    db.collection('products').get(),
    db.collection('locations').get(),
  ])
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const products = productsSnap.docs
    .map((doc) => parseProduct(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is NonNullable<typeof row> => row !== null)
  const locations = locationsSnap.docs
    .map((doc) => parseLocation(doc.id, doc.data() as Record<string, unknown>))
    .filter((row): row is NonNullable<typeof row> => row !== null)
  return { agency, products, locations }
}

async function resolveCustomerSnapshot(
  input: Pick<CreateGodownSaleInput, 'customerKind' | 'customerId' | 'customCustomerName'>,
): Promise<{
  customerId: string | null
  customerKind: 'registered' | 'custom'
  customerSnapshot: {
    name: string
    consumerNumber: string | null
    address: string
    city: string
    lastRefillDate: string | null
  }
}> {
  if (input.customerKind === 'custom') {
    const name = normalizeWhitespace(input.customCustomerName ?? '')
    if (!name) {
      throw new functions.https.HttpsError('invalid-argument', 'Enter the custom customer name.')
    }
    return {
      customerId: null,
      customerKind: 'custom',
      customerSnapshot: {
        name,
        consumerNumber: null,
        address: '',
        city: '',
        lastRefillDate: null,
      },
    }
  }

  const customerId = input.customerId
  if (!customerId) {
    throw new functions.https.HttpsError('invalid-argument', 'Select a registered customer.')
  }
  const snap = await getFirestore().collection('customers').doc(customerId).get()
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Customer not found.')
  }
  const data = snap.data() ?? {}
  if (data.status === 'inactive') {
    throw new functions.https.HttpsError('failed-precondition', 'That customer is inactive.')
  }
  const name =
    typeof data.displayName === 'string' && data.displayName.trim()
      ? normalizeWhitespace(data.displayName)
      : normalizeWhitespace(`${data.firstName ?? ''} ${data.lastName ?? ''}`)
  if (!name) {
    throw new functions.https.HttpsError('failed-precondition', 'Customer name is missing.')
  }
  return {
    customerId,
    customerKind: 'registered',
    customerSnapshot: {
      name,
      consumerNumber: typeof data.consumerNumber === 'string' ? data.consumerNumber : null,
      address: typeof data.address === 'string' ? data.address : '',
      city: typeof data.city === 'string' ? data.city : '',
      lastRefillDate:
        typeof data.lastRefillDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.lastRefillDate)
          ? data.lastRefillDate
          : null,
    },
  }
}

async function buildSaleDocument(input: CreateGodownSaleInput | UpdateGodownSaleInput, actorUid: string) {
  const { agency, products, locations } = await loadAgencyLookups()
  const product = products.find((row) => row.id === input.productId && row.active && row.kind === 'cylinder')
  if (!product) {
    throw new functions.https.HttpsError('invalid-argument', 'Select a valid cylinder type.')
  }

  let locationId: string | null = input.locationId ?? null
  if (locationId) {
    const location = locations.find((row) => row.id === locationId && row.active)
    if (!location) {
      throw new functions.https.HttpsError('invalid-argument', 'Select a valid location.')
    }
  } else {
    const defaultGodown = locations.find((row) => row.active && row.kind === 'godown')
    locationId = defaultGodown?.id ?? null
  }

  const paymentMethod: PaymentMethod | null = requireActiveById(
    agency.paymentMethods,
    input.paymentMethodId ?? null,
    'payment method',
  )
  const receivingAccount: ReceivingAccount | null = requireActiveById(
    agency.receivingAccounts,
    input.receivingAccountId ?? null,
    'payment destination',
  )

  if (input.receivedPaise > 0 && !paymentMethod) {
    throw new functions.https.HttpsError('invalid-argument', 'Select a payment method.')
  }
  if (input.receivedPaise > 0 && paymentMethod) {
    const compatible = destinationsForPaymentMethod(paymentMethod, agency.receivingAccounts)
    if (compatible.length === 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `No payment destination is configured for ${paymentMethod.name}. Add one in Settings.`,
      )
    }
    if (!receivingAccount || !isDestinationCompatibleWithPaymentMethod(paymentMethod, receivingAccount)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Select a ${paymentMethod.kind} payment destination for ${paymentMethod.name}.`,
      )
    }
  } else if (
    paymentMethod &&
    receivingAccount &&
    !isDestinationCompatibleWithPaymentMethod(paymentMethod, receivingAccount)
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Payment destination does not match the selected payment method.',
    )
  }

  const customer = await resolveCustomerSnapshot(input)
  const quantities = derivedSaleQuantities(input.filledIssued, input.emptyReceived)
  if (!Number.isSafeInteger(quantities.emptyOutstanding)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Empty cylinders received cannot exceed filled cylinders issued.',
    )
  }
  const amountsPaise = amountsFromReceivedAndDue(input.receivedPaise, input.duePaise)
  if (amountsPaise.salePaise !== input.salePaise) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Total sale must equal amount received plus amount due.',
    )
  }

  return {
    type: 'godown_sale' as const,
    status: 'posted' as const,
    approval: 'not_required' as const,
    businessDate: input.businessDate,
    timezone: agency.timezone || AGENCY_TIME_ZONE,
    customerKind: customer.customerKind,
    customerId: customer.customerId,
    customerSnapshot: customer.customerSnapshot,
    locationId,
    productId: product.id,
    productName: product.name,
    quantities,
    amountsPaise,
    paymentMethodId: paymentMethod?.id ?? null,
    paymentMethodName: paymentMethod?.name ?? null,
    receivingAccountId: receivingAccount?.id ?? null,
    receivingAccountName: receivingAccount?.name ?? null,
    bookingStatus: input.bookingStatus,
    note: input.note ?? '',
    originTransactionId: null,
    reversalOf: null,
    reversedByTransactionId: null,
    reverseReason: null,
    updatedBy: actorUid,
  }
}

async function findReturnCountForOrigin(tx: Transaction, originId: string): Promise<number> {
  const snap = await tx.get(
    getFirestore().collection('transactions').where('originTransactionId', '==', originId).where('type', '==', 'empty_return').limit(1),
  )
  return snap.size
}

export const createGodownSale = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'godown.create')
  const parsed = createGodownSaleSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const saleFields = await buildSaleDocument(input, actorUid)
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(input.transactionId)
  const idemRef = db.collection('idempotencyRecords').doc(input.idempotencyKey)
  const obligationRef = db.collection('obligations').doc()

  const result = await db.runTransaction(async (tx) => {
    const readRefs: DocumentReference[] = [txRef, idemRef]
    let customerRef: DocumentReference | null = null
    if (saleFields.customerId) {
      customerRef = db.collection('customers').doc(saleFields.customerId)
      readRefs.push(customerRef)
    }
    const snaps = await Promise.all(readRefs.map((ref) => tx.get(ref)))
    const existingTx = snaps[0]!
    const existingIdem = snaps[1]!
    if (existingIdem.exists) {
      const previousId = existingIdem.data()?.transactionId
      if (typeof previousId === 'string') return { id: previousId, reused: true }
      throw new functions.https.HttpsError('aborted', 'Idempotency record is incomplete.')
    }
    if (existingTx.exists) {
      throw new functions.https.HttpsError('already-exists', 'A transaction with this id already exists.')
    }
    if (customerRef && !snaps[2]?.exists) {
      throw new functions.https.HttpsError('not-found', 'Customer not found.')
    }

    const outstanding = saleFields.quantities.emptyOutstanding
    tx.set(txRef, {
      ...saleFields,
      idempotencyKey: input.idempotencyKey,
      obligationId: outstanding > 0 ? obligationRef.id : null,
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (outstanding > 0) {
      tx.set(obligationRef, {
        kind: 'empty_cylinder',
        status: 'open',
        customerId: saleFields.customerId,
        customerKind: saleFields.customerKind,
        customerName: saleFields.customerSnapshot.name,
        originTransactionId: txRef.id,
        productId: saleFields.productId,
        locationId: saleFields.locationId,
        businessDate: saleFields.businessDate,
        originalQuantity: outstanding,
        settledQuantity: 0,
        outstanding,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    tx.set(idemRef, {
      transactionId: txRef.id,
      actorUid,
      requestHash: 'godown_sale',
      createdAt: FieldValue.serverTimestamp(),
    })

    if (customerRef) {
      tx.update(customerRef, {
        lastRefillDate: saleFields.businessDate,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      })
    }

    tx.set(db.collection('auditLogs').doc(), {
      action: 'godown_sale.created',
      actorUid,
      transactionId: txRef.id,
      businessDate: saleFields.businessDate,
      approval: 'not_required',
      createdAt: FieldValue.serverTimestamp(),
    })

    return { id: txRef.id, reused: false }
  })

  return result
})

export const updateGodownSale = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'godown.edit')
  const parsed = updateGodownSaleSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const saleFields = await buildSaleDocument(input, actorUid)
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(input.transactionId)

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(txRef)
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', 'Transaction not found.')
    }
    const current = existing.data() ?? {}
    if (current.type !== 'godown_sale') {
      throw new functions.https.HttpsError('failed-precondition', 'Only godown sales can be edited here.')
    }
    if (current.status !== 'posted') {
      throw new functions.https.HttpsError('failed-precondition', 'Only posted entries can be edited.')
    }
    if (current.approval !== 'not_required') {
      throw new functions.https.HttpsError('failed-precondition', 'Godown entries must remain approval not_required.')
    }
    assertTodayBusinessDate(String(current.businessDate ?? ''))
    if (saleFields.businessDate !== current.businessDate) {
      throw new functions.https.HttpsError('failed-precondition', 'Transaction date cannot move off today’s business date.')
    }

    const returnCount = await findReturnCountForOrigin(tx, txRef.id)
    if (returnCount > 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Empty returns already exist against this sale. Reverse those first or use historical correction later.',
      )
    }

    let obligationRef: DocumentReference | null = null
    let obligationExists = false
    if (typeof current.obligationId === 'string' && current.obligationId) {
      obligationRef = db.collection('obligations').doc(current.obligationId)
      const obligationSnap = await tx.get(obligationRef)
      obligationExists = obligationSnap.exists
      if (obligationExists) {
        const settled = Number(obligationSnap.data()?.settledQuantity ?? 0)
        if (settled > 0) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'This sale has settled empty cylinders and cannot be edited.',
          )
        }
      }
    }

    let customerRef: DocumentReference | null = null
    if (saleFields.customerId) {
      customerRef = db.collection('customers').doc(saleFields.customerId)
      const customerSnap = await tx.get(customerRef)
      if (!customerSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Customer not found.')
      }
    }

    const outstanding = saleFields.quantities.emptyOutstanding
    const nextObligationId =
      outstanding > 0 ? (obligationRef?.id ?? db.collection('obligations').doc().id) : null
    if (outstanding > 0 && !obligationRef) {
      obligationRef = db.collection('obligations').doc(nextObligationId!)
      obligationExists = false
    }

    tx.update(txRef, {
      ...saleFields,
      obligationId: nextObligationId,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (outstanding > 0 && obligationRef) {
      const obligationPayload = {
        kind: 'empty_cylinder' as const,
        status: 'open' as const,
        customerId: saleFields.customerId,
        customerKind: saleFields.customerKind,
        customerName: saleFields.customerSnapshot.name,
        originTransactionId: txRef.id,
        productId: saleFields.productId,
        locationId: saleFields.locationId,
        businessDate: saleFields.businessDate,
        originalQuantity: outstanding,
        settledQuantity: 0,
        outstanding,
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (obligationExists) {
        tx.update(obligationRef, obligationPayload)
      } else {
        tx.set(obligationRef, {
          ...obligationPayload,
          createdBy: typeof current.createdBy === 'string' ? current.createdBy : actorUid,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
    } else if (obligationRef && obligationExists) {
      tx.update(obligationRef, {
        status: 'reversed',
        outstanding: 0,
        originalQuantity: 0,
        settledQuantity: 0,
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    if (customerRef) {
      tx.update(customerRef, {
        lastRefillDate: saleFields.businessDate,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      })
    }

    tx.set(db.collection('auditLogs').doc(), {
      action: 'godown_sale.updated',
      actorUid,
      transactionId: txRef.id,
      businessDate: saleFields.businessDate,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return { id: input.transactionId }
})

export const reverseGodownSale = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = reverseGodownSaleSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Confirm deletion with a reason.')
  }
  const input = parsed.data
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(input.transactionId)

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(txRef)
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', 'Transaction not found.')
    }
    const current = existing.data() ?? {}
    if (current.type !== 'godown_sale') {
      throw new functions.https.HttpsError('failed-precondition', 'Only godown sales can be deleted here.')
    }
    if (current.status !== 'posted') {
      throw new functions.https.HttpsError('failed-precondition', 'This entry is already reversed or not posted.')
    }
    assertTodayBusinessDate(String(current.businessDate ?? ''))

    const returnCount = await findReturnCountForOrigin(tx, txRef.id)
    if (returnCount > 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Empty returns exist against this sale. It cannot be deleted from the normal UI.',
      )
    }

    if (typeof current.obligationId === 'string' && current.obligationId) {
      const obligationRef = db.collection('obligations').doc(current.obligationId)
      const obligationSnap = await tx.get(obligationRef)
      if (obligationSnap.exists) {
        const settled = Number(obligationSnap.data()?.settledQuantity ?? 0)
        if (settled > 0) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'This sale has settled empty cylinders and cannot be deleted from the normal UI.',
          )
        }
        tx.update(obligationRef, {
          status: 'reversed',
          outstanding: 0,
          updatedBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }

    tx.update(txRef, {
      status: 'reversed',
      reverseReason: input.reason,
      reversedByTransactionId: null,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    })

    tx.set(db.collection('auditLogs').doc(), {
      action: 'godown_sale.reversed',
      actorUid,
      transactionId: txRef.id,
      reason: input.reason,
      businessDate: current.businessDate,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return { id: input.transactionId }
})

export const recordEmptyReturn = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'godown.create')
  const parsed = recordEmptyReturnSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Check the empty return form and try again.')
  }
  const input = parsed.data
  const db = getFirestore()
  const txRef = db.collection('transactions').doc(input.transactionId)
  const idemRef = db.collection('idempotencyRecords').doc(input.idempotencyKey)
  const originRef = db.collection('transactions').doc(input.originTransactionId)

  const result = await db.runTransaction(async (tx) => {
    const [existingTx, existingIdem, originSnap] = await Promise.all([
      tx.get(txRef),
      tx.get(idemRef),
      tx.get(originRef),
    ])
    if (existingIdem.exists) {
      const previousId = existingIdem.data()?.transactionId
      if (typeof previousId === 'string') return { id: previousId, reused: true }
      throw new functions.https.HttpsError('aborted', 'Idempotency record is incomplete.')
    }
    if (existingTx.exists) {
      throw new functions.https.HttpsError('already-exists', 'A transaction with this id already exists.')
    }
    if (!originSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Original sale not found.')
    }
    const origin = originSnap.data() ?? {}
    if (origin.type !== 'godown_sale' || origin.status !== 'posted') {
      throw new functions.https.HttpsError('failed-precondition', 'Empty returns must reference a posted godown sale.')
    }
    if (origin.approval !== 'not_required') {
      throw new functions.https.HttpsError('failed-precondition', 'Godown entries must remain approval not_required.')
    }
    const obligationId = typeof origin.obligationId === 'string' ? origin.obligationId : null
    if (!obligationId) {
      throw new functions.https.HttpsError('failed-precondition', 'This sale has no outstanding empty cylinders.')
    }
    const obligationRef = db.collection('obligations').doc(obligationId)
    const obligationSnap = await tx.get(obligationRef)
    if (!obligationSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Empty-cylinder obligation not found.')
    }
    const obligation = obligationSnap.data() ?? {}
    if (obligation.status === 'reversed' || obligation.status === 'settled') {
      throw new functions.https.HttpsError('failed-precondition', 'There is no open empty-cylinder obligation.')
    }
    const outstanding = Number(obligation.outstanding ?? 0)
    if (!Number.isSafeInteger(outstanding) || outstanding < 1) {
      throw new functions.https.HttpsError('failed-precondition', 'There is no open empty-cylinder obligation.')
    }
    if (input.emptyReturned > outstanding) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Only ${outstanding} empty cylinder(s) are still outstanding.`,
      )
    }

    const settledQuantity = Number(obligation.settledQuantity ?? 0) + input.emptyReturned
    const originalQuantity = Number(obligation.originalQuantity ?? 0)
    const nextOutstanding = originalQuantity - settledQuantity
    const nextStatus = obligationStatusFromQuantities(originalQuantity, settledQuantity)

    const originBusinessDate =
      typeof origin.businessDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(origin.businessDate)
        ? origin.businessDate
        : null

    tx.set(txRef, {
      type: 'empty_return',
      status: 'posted',
      approval: 'not_required',
      businessDate: input.businessDate,
      timezone: typeof origin.timezone === 'string' ? origin.timezone : AGENCY_TIME_ZONE,
      customerKind: origin.customerKind,
      customerId: origin.customerId ?? null,
      customerSnapshot: origin.customerSnapshot,
      locationId: origin.locationId ?? null,
      productId: origin.productId,
      productName: origin.productName,
      quantities: {
        filledIssued: 0,
        emptyReceived: input.emptyReturned,
        emptyOutstanding: 0,
      },
      amountsPaise: {
        salePaise: 0,
        receivedPaise: 0,
        duePaise: 0,
      },
      paymentMethodId: null,
      paymentMethodName: null,
      receivingAccountId: null,
      receivingAccountName: null,
      bookingStatus: origin.bookingStatus ?? 'no',
      note: input.note ?? '',
      idempotencyKey: input.idempotencyKey,
      originTransactionId: originRef.id,
      originBusinessDate,
      remainingOutstandingAfter: nextOutstanding,
      obligationId,
      reversalOf: null,
      reversedByTransactionId: null,
      reverseReason: null,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    tx.update(obligationRef, {
      settledQuantity,
      outstanding: nextOutstanding,
      status: nextStatus,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Keep the origin sale's displayed outstanding in sync for register totals.
    const originQuantities = origin.quantities ?? {}
    const originOutstanding = Number(originQuantities.emptyOutstanding ?? 0)
    if (Number.isSafeInteger(originOutstanding)) {
      tx.update(originRef, {
        'quantities.emptyOutstanding': Math.max(0, originOutstanding - input.emptyReturned),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      })
    }

    tx.set(idemRef, {
      transactionId: txRef.id,
      actorUid,
      requestHash: 'empty_return',
      createdAt: FieldValue.serverTimestamp(),
    })

    tx.set(db.collection('auditLogs').doc(), {
      action: 'empty_return.created',
      actorUid,
      transactionId: txRef.id,
      originTransactionId: originRef.id,
      businessDate: input.businessDate,
      approval: 'not_required',
      createdAt: FieldValue.serverTimestamp(),
    })

    return { id: txRef.id, reused: false }
  })

  return result
})
