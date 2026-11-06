import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { normalizeIndianMobile, phoneToAuthEmail } from '../shared/auth/phone.ts'

const allowProduction = process.env.ALLOW_PRODUCTION_BOOTSTRAP === 'yes'
if (!allowProduction) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
}

if (!process.env.FIRESTORE_EMULATOR_HOST && !allowProduction) {
  console.error('Refusing to bootstrap without the Firestore emulator.')
  process.exit(1)
}

const phoneRaw = process.env.INITIAL_ADMIN_PHONE?.trim()
const password = process.env.INITIAL_ADMIN_PASSWORD
if (!phoneRaw) {
  console.error('Set INITIAL_ADMIN_PHONE in .env.local.')
  process.exit(1)
}
if (!password || password.length < 8) {
  console.error('Set INITIAL_ADMIN_PASSWORD in .env.local (at least 8 characters).')
  process.exit(1)
}

let phoneE164
try {
  phoneE164 = normalizeIndianMobile(phoneRaw)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid INITIAL_ADMIN_PHONE.')
  process.exit(1)
}

const authEmail = phoneToAuthEmail(phoneE164)

initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'hisab-9d3e4' })
const auth = getAuth()
const db = getFirestore()

const existingBootstrap = await db.doc('settings/bootstrap').get()
if (existingBootstrap.exists) {
  console.log(
    `Admin bootstrap already completed for UID ${existingBootstrap.data()?.uid ?? 'unknown'}. Use scripts/migrate-admin-to-phone.mjs to convert an email-based admin without changing the UID.`,
  )
  process.exit(0)
}

const admins = await db.collection('users').where('role', '==', 'admin').limit(1).get()
if (!admins.empty) {
  console.log(
    `An administrator profile already exists (${admins.docs[0].id}). Refusing to create another. Use migration if needed.`,
  )
  process.exit(0)
}

let user
try {
  user = await auth.getUserByEmail(authEmail)
  console.log('Auth user already exists for this phone mapping; linking Firestore profile without changing password.')
} catch (error) {
  if (typeof error === 'object' && error && 'code' in error && error.code === 'auth/user-not-found') {
    user = await auth.createUser({
      email: authEmail,
      password,
      displayName: 'Administrator',
      phoneNumber: phoneE164,
      emailVerified: true,
    })
  } else {
    throw error
  }
}

await auth.setCustomUserClaims(user.uid, { role: 'admin' })

await db.doc('settings/bootstrap').set({
  uid: user.uid,
  phoneE164,
  createdAt: FieldValue.serverTimestamp(),
})

await db.doc(`users/${user.uid}`).set({
  phoneE164,
  authEmail,
  displayName: 'Administrator',
  role: 'admin',
  status: 'active',
  permissions: {},
  language: 'en',
  mustChangePassword: false,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  createdBy: 'bootstrap',
})

const agencyRef = db.doc('settings/agency')
const agency = await agencyRef.get()
if (!agency.exists) {
  await agencyRef.set({
    name: 'Miragpur Indane Gas Agency',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    paymentMethods: [],
    receivingAccounts: [],
    expenseCategories: [],
    inventoryStates: ['filled', 'empty', 'damaged'],
    negativeStockAllowed: false,
    historicalCorrectionRequiresSecondAdmin: false,
    createdAt: FieldValue.serverTimestamp(),
  })
}

console.log(`Administrator ready: ${phoneE164} (uid ${user.uid})`)
