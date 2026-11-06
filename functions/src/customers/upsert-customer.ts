import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { requirePermission } from '../auth/permission-guards'
import { createCustomerSchema, customerWriteFields, updateCustomerSchema } from '../shared/customer-schema'

async function assertConsumerAvailable(consumerNumber: string, exceptId?: string): Promise<void> {
  const snap = await getFirestore()
    .collection('customers')
    .where('consumerNumberLower', '==', consumerNumber.toLowerCase())
    .limit(5)
    .get()
  if (snap.docs.some((doc) => doc.id !== exceptId)) {
    throw new functions.https.HttpsError('already-exists', 'A customer with this consumer number already exists.')
  }
}

export const createCustomer = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'customers.create')
  const parsed = createCustomerSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Check the customer form and try again.')
  }

  const fields = customerWriteFields(parsed.data)
  await assertConsumerAvailable(fields.consumerNumber)
  const ref = getFirestore().collection('customers').doc()
  await ref.set({
    ...fields,
    importBatchId: null,
    importSource: 'manual',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedBy: actorUid,
  })
  await getFirestore().collection('auditLogs').add({
    action: 'customer.created',
    actorUid,
    customerId: ref.id,
    consumerNumber: fields.consumerNumber,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
})

export const updateCustomer = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'customers.edit')
  const parsed = updateCustomerSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Check the customer form and try again.')
  }

  const ref = getFirestore().collection('customers').doc(parsed.data.id)
  const existing = await ref.get()
  if (!existing.exists) {
    throw new functions.https.HttpsError('not-found', 'Customer not found.')
  }

  const fields = customerWriteFields(parsed.data)
  await assertConsumerAvailable(fields.consumerNumber, parsed.data.id)
  await ref.update({
    ...fields,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  })
  await getFirestore().collection('auditLogs').add({
    action: 'customer.updated',
    actorUid,
    customerId: ref.id,
    consumerNumber: fields.consumerNumber,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
})
