import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { manageAgencyConfigSchema } from '../shared/agency-schema'
import { requireAdmin } from '../auth/guards'

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase()
}

async function assertUniqueLocationName(name: string, exceptId?: string): Promise<void> {
  const snap = await getFirestore().collection('locations').where('nameLower', '==', normalizeNameKey(name)).limit(5).get()
  if (snap.docs.some((doc) => doc.id !== exceptId)) {
    throw new functions.https.HttpsError('already-exists', 'A location with this name already exists.')
  }
}

async function assertUniqueProductCode(code: string, exceptId?: string): Promise<void> {
  const snap = await getFirestore().collection('products').where('codeLower', '==', normalizeNameKey(code)).limit(5).get()
  if (snap.docs.some((doc) => doc.id !== exceptId)) {
    throw new functions.https.HttpsError('already-exists', 'A product with this code already exists.')
  }
}

export const manageAgencyConfig = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = manageAgencyConfigSchema.safeParse(data)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'form'}: ${issue.message}`)
        .join('; ')
      throw new functions.https.HttpsError(
        'invalid-argument',
        detail ? `Check the settings form and try again: ${detail}` : 'Check the settings form and try again.',
      )
    }

    const db = getFirestore()
    const agencyRef = db.doc('settings/agency')
    const action = parsed.data.action

    if (action === 'updateProfile') {
      const { name, timezone, currency } = parsed.data.payload
      await agencyRef.set(
        {
          name,
          timezone,
          currency,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true },
      )
      return { ok: true, action }
    }

    if (action === 'setPaymentMethods') {
      // Persist canonical kinds (schema already normalizes legacy "portal" → indane_portal).
      await agencyRef.set(
        {
          paymentMethods: parsed.data.payload.items.map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            active: item.active,
          })),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true },
      )
      return { ok: true, action }
    }

    if (action === 'setReceivingAccounts') {
      await agencyRef.set(
        {
          receivingAccounts: parsed.data.payload.items.map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            active: item.active,
          })),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true },
      )
      return { ok: true, action }
    }

    if (action === 'upsertLocation') {
      const payload = parsed.data.payload
      const id = payload.id ?? db.collection('locations').doc().id
      await assertUniqueLocationName(payload.name, id)
      await db
        .collection('locations')
        .doc(id)
        .set(
          {
            name: payload.name,
            nameLower: normalizeNameKey(payload.name),
            kind: payload.kind,
            active: payload.active,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid,
            ...(payload.id ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actorUid }),
          },
          { merge: true },
        )
      return { ok: true, action, id }
    }

    if (action === 'deleteLocation') {
      await db.collection('locations').doc(parsed.data.payload.id).delete()
      return { ok: true, action }
    }

    if (action === 'upsertProduct') {
      const payload = parsed.data.payload
      const id = payload.id ?? db.collection('products').doc().id
      await assertUniqueProductCode(payload.code, id)
      await db
        .collection('products')
        .doc(id)
        .set(
          {
            name: payload.name,
            code: payload.code,
            codeLower: normalizeNameKey(payload.code),
            kind: payload.kind,
            unit: payload.unit,
            active: payload.active,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid,
            ...(payload.id ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actorUid }),
          },
          { merge: true },
        )
      return { ok: true, action, id }
    }

    if (action === 'deleteProduct') {
      const productId = parsed.data.payload.id
      const linked = await db.collection('priceRules').where('productId', '==', productId).limit(1).get()
      if (!linked.empty) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Remove price rules for this cylinder type before deleting it.',
        )
      }
      await db.collection('products').doc(productId).delete()
      return { ok: true, action }
    }

    if (action === 'upsertPriceRule') {
      const payload = parsed.data.payload
      const product = await db.collection('products').doc(payload.productId).get()
      if (!product.exists) {
        throw new functions.https.HttpsError('not-found', 'Select an existing cylinder type for this price.')
      }
      const id = payload.id ?? db.collection('priceRules').doc().id
      await db
        .collection('priceRules')
        .doc(id)
        .set(
          {
            productId: payload.productId,
            label: payload.label,
            amountPaise: payload.amountPaise,
            active: payload.active,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actorUid,
            ...(payload.id ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: actorUid }),
          },
          { merge: true },
        )
      return { ok: true, action, id }
    }

    if (action === 'deletePriceRule') {
      await db.collection('priceRules').doc(parsed.data.payload.id).delete()
      return { ok: true, action }
    }

    throw new functions.https.HttpsError('invalid-argument', 'Unsupported settings action.')
  })
