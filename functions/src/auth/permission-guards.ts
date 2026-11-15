import * as functions from 'firebase-functions/v1'
import type { CallableContext } from 'firebase-functions/v1/https'
import { getFirestore } from 'firebase-admin/firestore'
import { hasStaffPermission, isAdminRole, normalizePermissions, type StaffPermission } from '../../../shared/rules/permissions'

export async function requirePermission(context: CallableContext, permission: StaffPermission): Promise<string> {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  }
  const uid = context.auth.uid
  if (isAdminRole(context.auth.token.role)) {
    return uid
  }
  if (context.auth.token.role !== 'staff') {
    throw new functions.https.HttpsError('permission-denied', 'You do not have permission to do that.')
  }
  const snapshot = await getFirestore().collection('users').doc(uid).get()
  if (!snapshot.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'User profile is missing. After an emulator reset, run npm run bootstrap:admin, or ask an administrator to recreate your staff account.',
    )
  }
  if (snapshot.data()?.status === 'disabled') {
    throw new functions.https.HttpsError('permission-denied', 'You do not have permission to do that.')
  }
  const permissions = normalizePermissions(snapshot.data()?.permissions)
  if (!hasStaffPermission(permissions, permission)) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have permission to do that.')
  }
  return uid
}
