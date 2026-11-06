import * as functions from 'firebase-functions/v1'
import type { CallableContext } from 'firebase-functions/v1/https'

export function requireAdmin(context: CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  }
  if (context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  return context.auth.uid
}
