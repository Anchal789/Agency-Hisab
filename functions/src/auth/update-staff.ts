import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { normalizePermissions } from '../../../shared/rules/permissions'
import { updateStaffAccessSchema } from '../shared/staff-schema'
import { requireAdmin } from './guards'

export const updateStaffAccess = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = updateStaffAccessSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', 'The access update is incomplete.')
    }

    const userRef = getFirestore().collection('users').doc(parsed.data.uid)
    const snapshot = await userRef.get()
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found.')
    }
    const current = snapshot.data()
    if (current?.role !== 'staff') {
      throw new functions.https.HttpsError('failed-precondition', 'Only staff access can be changed here.')
    }

    const nextStatus = parsed.data.status ?? current.status
    const nextPermissions = normalizePermissions(parsed.data.permissions ?? current.permissions)

    await getAuth().updateUser(parsed.data.uid, { disabled: nextStatus === 'disabled' })
    await userRef.update({
      status: nextStatus,
      permissions: nextPermissions,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await getFirestore().collection('auditLogs').add({
      action: 'staff.access_updated',
      actorUid,
      targetUid: parsed.data.uid,
      status: nextStatus,
      permissions: nextPermissions,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { uid: parsed.data.uid, status: nextStatus, permissions: nextPermissions }
  })
