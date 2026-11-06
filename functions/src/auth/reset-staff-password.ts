import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { resetStaffPasswordSchema } from '../shared/staff-schema'
import { requireAdmin } from './guards'

export const resetStaffPassword = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = resetStaffPasswordSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', 'Provide a valid staff account and temporary password.')
    }

    const userRef = getFirestore().collection('users').doc(parsed.data.uid)
    const snapshot = await userRef.get()
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found.')
    }
    const current = snapshot.data()
    if (current?.role !== 'staff') {
      throw new functions.https.HttpsError('failed-precondition', 'Only staff passwords can be reset here.')
    }

    await getAuth().updateUser(parsed.data.uid, { password: parsed.data.temporaryPassword })
    await userRef.update({
      mustChangePassword: true,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await getFirestore().collection('auditLogs').add({
      action: 'staff.password_reset',
      actorUid,
      targetUid: parsed.data.uid,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { uid: parsed.data.uid, mustChangePassword: true }
  })
