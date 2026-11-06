import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

const envKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

export function missingFirebaseEnv(): string[] {
  return envKeys.filter((key) => !import.meta.env[key])
}

export type FirebaseServices = {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
  storage: FirebaseStorage
}

let services: FirebaseServices | null = null

export function getFirebase(): FirebaseServices {
  if (services) return services
  const missing = missingFirebaseEnv()
  if (missing.length > 0) {
    throw new Error(`Missing Firebase configuration: ${missing.join(', ')}`)
  }

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
        measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
      })

  const auth = getAuth(app)
  const db = getFirestore(app)
  const functions = getFunctions(app, 'asia-south1')
  const storage = getStorage(app)

  if (import.meta.env.VITE_USE_EMULATORS === 'true' && !globalThis.__HISAB_EMULATORS__) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    connectStorageEmulator(storage, '127.0.0.1', 9199)
    globalThis.__HISAB_EMULATORS__ = true
  }

  services = { app, auth, db, functions, storage }
  return services
}
