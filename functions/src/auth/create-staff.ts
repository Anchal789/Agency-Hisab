import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { phoneToAuthEmail } from '../../../shared/auth/phone'
import { normalizePermissions } from '../../../shared/rules/permissions'
import { createStaffSchema } from '../shared/staff-schema'
import { assertPhoneAvailable, writeUserPhoneProfile } from './phone-accounts'
import { requireAdmin } from './guards'

export const createStaffUser = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = createStaffSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', 'Check the name, phone number, password, and permissions.')
    }

    const phoneE164 = parsed.data.phone
    const authEmail = phoneToAuthEmail(phoneE164)
    const auth = getAuth()
    let uid: string | null = null

    try {
      await assertPhoneAvailable(phoneE164)
      const user = await auth.createUser({
        email: authEmail,
        password: parsed.data.password,
        displayName: parsed.data.displayName,
        phoneNumber: phoneE164,
        disabled: false,
        emailVerified: true,
      })
      uid = user.uid
      await auth.setCustomUserClaims(uid, { role: 'staff' })
      await writeUserPhoneProfile({
        uid,
        phoneE164,
        displayName: parsed.data.displayName,
        role: 'staff',
        status: 'active',
        permissions: normalizePermissions(parsed.data.permissions),
        mustChangePassword: true,
        createdBy: actorUid,
      })
      await getFirestore().collection('auditLogs').add({
        action: 'staff.created',
        actorUid,
        targetUid: uid,
        phoneE164,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { uid }
    } catch (error) {
      if (uid) {
        await auth.deleteUser(uid).catch(() => undefined)
      }
      if (error instanceof Error && error.message === 'PHONE_IN_USE') {
        throw new functions.https.HttpsError('already-exists', 'An account with this phone number already exists.')
      }
      if (typeof error === 'object' && error && 'code' in error && error.code === 'auth/email-already-exists') {
        throw new functions.https.HttpsError('already-exists', 'An account with this phone number already exists.')
      }
      if (typeof error === 'object' && error && 'code' in error && error.code === 'auth/phone-number-already-exists') {
        throw new functions.https.HttpsError('already-exists', 'An account with this phone number already exists.')
      }
      if (error instanceof functions.https.HttpsError) throw error
      throw new functions.https.HttpsError('internal', 'The staff account could not be created.')
    }
  })
