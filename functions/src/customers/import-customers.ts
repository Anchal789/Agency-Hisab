import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { requirePermission } from '../auth/permission-guards'
import { checkConsumerNumbersSchema, commitCustomerImportSchema, customerWriteFields } from '../shared/customer-schema'

export const checkCustomerConsumerNumbers = functions.region('asia-south1').https.onCall(async (data, context) => {
  await requirePermission(context, 'customers.view')
  const parsed = checkConsumerNumbersSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Provide consumer numbers to check.')
  }

  const existing: string[] = []
  const unique = [...new Set(parsed.data.consumerNumbers.map((value) => value.trim().toLowerCase()).filter(Boolean))]
  const chunkSize = 30
  const db = getFirestore()
  for (let index = 0; index < unique.length; index += chunkSize) {
    const chunk = unique.slice(index, index + chunkSize)
    const snap = await db.collection('customers').where('consumerNumberLower', 'in', chunk).get()
    for (const docSnap of snap.docs) {
      const value = docSnap.data().consumerNumber
      if (typeof value === 'string') existing.push(value)
    }
  }
  return { existing }
})

export const commitCustomerImport = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'customers.create')
  const parsed = commitCustomerImportSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', 'Import payload is invalid.')
  }

  const db = getFirestore()
  const batchRef = db.collection('customerImportBatches').doc(parsed.data.batchId)
  const existingBatch = await batchRef.get()
  if (existingBatch.exists && existingBatch.data()?.status === 'committed') {
    return {
      batchId: parsed.data.batchId,
      createdCount: Number(existingBatch.data()?.createdCount ?? 0),
      skippedCount: Number(existingBatch.data()?.skippedCount ?? 0),
      skipped: [] as Array<{ rowNumber: number; consumerNumber: string; reason: string }>,
      duplicate: true,
    }
  }

  const lowers = [...new Set(parsed.data.records.map((record) => record.consumerNumber.trim().toLowerCase()))]
  const existingLower = new Set<string>()
  for (let index = 0; index < lowers.length; index += 30) {
    const chunk = lowers.slice(index, index + 30)
    const snap = await db.collection('customers').where('consumerNumberLower', 'in', chunk).get()
    for (const docSnap of snap.docs) {
      const lower = docSnap.data().consumerNumberLower
      if (typeof lower === 'string') existingLower.add(lower)
    }
  }

  let createdCount = 0
  let skippedCount = 0
  const skipped: Array<{ rowNumber: number; consumerNumber: string; reason: string }> = []
  const writer = db.batch()

  for (const record of parsed.data.records) {
    const fields = customerWriteFields(record)
    if (existingLower.has(fields.consumerNumberLower)) {
      skippedCount += 1
      skipped.push({
        rowNumber: record.rowNumber,
        consumerNumber: fields.consumerNumber,
        reason: 'Consumer number already exists.',
      })
      continue
    }

    const ref = db.collection('customers').doc()
    writer.set(ref, {
      ...fields,
      importBatchId: parsed.data.batchId,
      importSource: 'excel',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedBy: actorUid,
    })
    existingLower.add(fields.consumerNumberLower)
    createdCount += 1
  }

  writer.set(
    batchRef,
    {
      fileName: parsed.data.fileName,
      uploadedBy: actorUid,
      status: 'committed',
      rowCount: parsed.data.records.length,
      createdCount,
      skippedCount,
      conflictCount: skippedCount,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  await writer.commit()
  await db.collection('auditLogs').add({
    action: 'customer.import_committed',
    actorUid,
    batchId: parsed.data.batchId,
    createdCount,
    skippedCount,
    createdAt: FieldValue.serverTimestamp(),
  })

  return { batchId: parsed.data.batchId, createdCount, skippedCount, skipped, duplicate: false }
})
