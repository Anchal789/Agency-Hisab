/**
 * Migrates an existing email-based administrator to phone+password mapping
 * while preserving the Firebase Auth UID and custom claims.
 *
 * Usage (emulator):
 *   INITIAL_ADMIN_PHONE=9876543210 npm run migrate:admin-phone
 *
 * Does not change the password unless MIGRATE_SET_PASSWORD is set.
 * Does not delete the account.
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { normalizeIndianMobile, phoneToAuthEmail } from '../shared/auth/phone.ts'

const allowProduction = process.env.ALLOW_PRODUCTION_BOOTSTRAP === 'yes'
if (!allowProduction) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
}

const phoneRaw = process.env.INITIAL_ADMIN_PHONE?.trim()
if (!phoneRaw) {
  console.error('Set INITIAL_ADMIN_PHONE to the verified admin mobile number.')
  process.exit(1)
}

let phoneE164
try {
  phoneE164 = normalizeIndianMobile(phoneRaw)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid phone.')
  process.exit(1)
}

const authEmail = phoneToAuthEmail(phoneE164)
initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'hisab-9d3e4' })
const auth = getAuth()
const db = getFirestore()

const bootstrap = await db.doc('settings/bootstrap').get()
let uid = typeof bootstrap.data()?.uid === 'string' ? bootstrap.data().uid : null

if (!uid) {
  const admins = await db.collection('users').where('role', '==', 'admin').limit(1).get()
  if (admins.empty) {
    console.error('No administrator found to migrate. Run bootstrap:admin instead.')
    process.exit(1)
  }
  uid = admins.docs[0].id
}

const existingUser = await auth.getUser(uid)
console.log(`Migrating admin UID ${uid} (current email: ${existingUser.email ?? 'none'})`)

const phoneClash = await db.collection('users').where('phoneE164', '==', phoneE164).limit(2).get()
const clash = phoneClash.docs.find((doc) => doc.id !== uid)
if (clash) {
  console.error(`Phone ${phoneE164} is already used by UID ${clash.id}. Aborting.`)
  process.exit(1)
}

try {
  const byEmail = await auth.getUserByEmail(authEmail)
  if (byEmail.uid !== uid) {
    console.error(`Synthetic email already belongs to another UID (${byEmail.uid}). Aborting.`)
    process.exit(1)
  }
} catch (error) {
  if (!(typeof error === 'object' && error && 'code' in error && error.code === 'auth/user-not-found')) {
    throw error
  }
}

const updatePayload = {
  email: authEmail,
  emailVerified: true,
  phoneNumber: phoneE164,
}
if (process.env.MIGRATE_SET_PASSWORD) {
  if (process.env.MIGRATE_SET_PASSWORD.length < 8) {
    console.error('MIGRATE_SET_PASSWORD must be at least 8 characters.')
    process.exit(1)
  }
  updatePayload.password = process.env.MIGRATE_SET_PASSWORD
}

await auth.updateUser(uid, updatePayload)
await auth.setCustomUserClaims(uid, { ...(existingUser.customClaims ?? {}), role: 'admin' })

const profileRef = db.doc(`users/${uid}`)
const profile = await profileRef.get()
const displayName = typeof profile.data()?.displayName === 'string' ? profile.data().displayName : 'Administrator'

await profileRef.set(
  {
    phoneE164,
    authEmail,
    displayName,
    role: 'admin',
    status: profile.data()?.status === 'disabled' ? 'disabled' : 'active',
    permissions: profile.data()?.permissions ?? {},
    language: profile.data()?.language === 'hi' ? 'hi' : 'en',
    mustChangePassword: false,
    email: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    migratedToPhoneAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
)

await db.doc('settings/bootstrap').set(
  {
    uid,
    phoneE164,
    migratedFromEmail: existingUser.email ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
)

await db.collection('auditLogs').add({
  action: 'admin.migrated_to_phone',
  actorUid: 'migrate-admin-to-phone',
  targetUid: uid,
  phoneE164,
  preservedUid: true,
  createdAt: FieldValue.serverTimestamp(),
})

console.log(`Migration complete. UID ${uid} preserved. Login phone: ${phoneE164}`)
