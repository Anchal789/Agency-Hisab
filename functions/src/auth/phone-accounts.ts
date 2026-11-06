import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { phoneToAuthEmail } from '../../../shared/auth/phone'

export async function assertPhoneAvailable(phoneE164: string, exceptUid?: string): Promise<void> {
  const authEmail = phoneToAuthEmail(phoneE164)
  const db = getFirestore()

  const byPhone = await db.collection('users').where('phoneE164', '==', phoneE164).limit(2).get()
  const conflict = byPhone.docs.find((doc) => doc.id !== exceptUid)
  if (conflict) {
    throw new Error('PHONE_IN_USE')
  }

  try {
    const existing = await getAuth().getUserByEmail(authEmail)
    if (!exceptUid || existing.uid !== exceptUid) {
      throw new Error('PHONE_IN_USE')
    }
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'auth/user-not-found') {
      return
    }
    if (error instanceof Error && error.message === 'PHONE_IN_USE') throw error
    throw error
  }
}

export async function writeUserPhoneProfile(params: {
  uid: string
  phoneE164: string
  displayName: string
  role: 'admin' | 'staff'
  status: 'active' | 'disabled'
  permissions: Record<string, boolean>
  language?: 'en' | 'hi'
  mustChangePassword: boolean
  createdBy: string
  merge?: boolean
}): Promise<void> {
  const authEmail = phoneToAuthEmail(params.phoneE164)
  const ref = getFirestore().collection('users').doc(params.uid)
  const payload = {
    phoneE164: params.phoneE164,
    authEmail,
    displayName: params.displayName,
    role: params.role,
    status: params.status,
    permissions: params.permissions,
    language: params.language ?? 'en',
    mustChangePassword: params.mustChangePassword,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (params.merge) {
    await ref.set(
      {
        ...payload,
      },
      { merge: true },
    )
    return
  }

  await ref.set({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: params.createdBy,
  })
}
