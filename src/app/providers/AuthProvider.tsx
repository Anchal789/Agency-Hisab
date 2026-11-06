import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { normalizeIndianMobile, phoneToAuthEmail, PhoneValidationError } from '@shared/auth/phone'
import { parseUserProfile, type UserProfile } from '@shared/models/user'
import type { AppRole } from '@shared/rules/permissions'
import { setDocumentLanguage } from '@/i18n'
import i18n from '@/i18n'
import { isUserDisabledError } from '@/services/errors'
import { getFirebase } from '@/services/firebase/client'

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unprovisioned' | 'disabled'

type AuthContextValue = {
  status: AuthStatus
  profile: UserProfile | null
  role: AppRole | null
  signIn: (phone: string, password: string) => Promise<void>
  signOutUser: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function profileFromSnapshot(
  user: User,
  snapshot: DocumentSnapshot,
): Promise<{ status: AuthStatus; profile: UserProfile | null; role: AppRole | null }> {
  const token = await user.getIdTokenResult()
  if (!snapshot.exists()) return { status: 'unprovisioned', profile: null, role: null }
  const profile = parseUserProfile(user.uid, snapshot.data() as Record<string, unknown>, token.claims.role)
  if (!profile) return { status: 'unprovisioned', profile: null, role: null }
  if (profile.status === 'disabled') return { status: 'disabled', profile, role: profile.role }
  await i18n.changeLanguage(profile.language)
  setDocumentLanguage(profile.language)
  return { status: 'authenticated', profile, role: profile.role }
}

function applyProfileResult(
  next: { status: AuthStatus; profile: UserProfile | null; role: AppRole | null },
  setStatus: (value: AuthStatus) => void,
  setProfile: (value: UserProfile | null) => void,
  setRole: (value: AppRole | null) => void,
) {
  setStatus(next.status)
  setProfile(next.profile)
  setRole(next.role)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [role, setRole] = useState<AppRole | null>(null)
  const [authUser, setAuthUser] = useState<User | null>(null)

  useEffect(() => {
    const auth = getFirebase().auth
    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user)
      if (!user) {
        setStatus('anonymous')
        setProfile(null)
        setRole(null)
      }
    })
  }, [])

  useEffect(() => {
    if (!authUser) return

    setStatus('loading')
    const userRef = doc(getFirebase().db, 'users', authUser.uid)
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        void profileFromSnapshot(authUser, snapshot)
          .then((next) => applyProfileResult(next, setStatus, setProfile, setRole))
          .catch(() => {
            setStatus('unprovisioned')
            setProfile(null)
            setRole(null)
          })
      },
      () => {
        setStatus('unprovisioned')
        setProfile(null)
        setRole(null)
      },
    )
    return unsubscribe
  }, [authUser])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      profile,
      role,
      signIn: async (phone, password) => {
        let phoneE164: string
        try {
          phoneE164 = normalizeIndianMobile(phone)
        } catch (error) {
          if (error instanceof PhoneValidationError) {
            throw Object.assign(new Error(error.message), { code: 'auth/invalid-phone' })
          }
          throw error
        }
        try {
          await signInWithEmailAndPassword(getFirebase().auth, phoneToAuthEmail(phoneE164), password)
        } catch (error) {
          if (isUserDisabledError(error)) {
            throw Object.assign(new Error('account-disabled'), { code: 'auth/user-disabled' })
          }
          const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
          if (code === 'auth/network-request-failed') {
            throw Object.assign(new Error('network'), { code: 'auth/network-request-failed' })
          }
          if (code === 'auth/too-many-requests') {
            throw Object.assign(new Error('too-many-requests'), { code: 'auth/too-many-requests' })
          }
          throw Object.assign(new Error('invalid-credential'), { code: 'auth/invalid-credential' })
        }
      },
      signOutUser: async () => {
        await signOut(getFirebase().auth)
      },
      refreshProfile: async () => {
        // Live profile is driven by onSnapshot; forcing a token refresh covers claim changes.
        if (!authUser) return
        await authUser.getIdToken(true)
      },
    }),
    [authUser, profile, role, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
