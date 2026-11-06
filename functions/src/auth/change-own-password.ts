import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { phoneToAuthEmail } from '../../../shared/auth/phone'
import { changeOwnPasswordSchema } from '../shared/staff-schema'

export const changeOwnPassword = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
    }

    const parsed = changeOwnPasswordSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', 'Check the current and new passwords.')
    }

    const uid = context.auth.uid
    const userRef = getFirestore().collection('users').doc(uid)
    const snapshot = await userRef.get()
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'User profile not found.')
    }

    const phoneE164 = snapshot.data()?.phoneE164
    if (typeof phoneE164 !== 'string' || !phoneE164) {
      throw new functions.https.HttpsError('failed-precondition', 'Phone number is missing on the profile.')
    }

    // Verify current password by attempting a REST sign-in against the Auth API/emulator.
    const verified = await verifyPassword(phoneToAuthEmail(phoneE164), parsed.data.currentPassword)
    if (!verified) {
      throw new functions.https.HttpsError('permission-denied', 'Current password is incorrect.')
    }

    await getAuth().updateUser(uid, { password: parsed.data.newPassword })
    await userRef.update({
      mustChangePassword: false,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await getFirestore().collection('auditLogs').add({
      action: 'user.password_changed',
      actorUid: uid,
      targetUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { ok: true }
  })

async function verifyPassword(email: string, password: string): Promise<boolean> {
  const apiKey = process.env.GCLOUD_PROJECT ? process.env.FIREBASE_WEB_API_KEY : undefined
  const key = apiKey || process.env.VITE_FIREBASE_API_KEY || 'fake-api-key'
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  const base = emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1'

  const response = await fetch(`${base}/accounts:signInWithPassword?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  return response.ok
}
