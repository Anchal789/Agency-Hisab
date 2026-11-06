import { Navigate, Outlet } from 'react-router'
import { defaultAuthenticatedPath } from '@shared/rules/permissions'
import { useAuth } from '@/app/providers/AuthProvider'
import { LoadingState } from '@/components/common/LoadingState'

export function GuestRoute() {
  const { status, role, profile } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    )
  }

  if (status === 'authenticated' && role && profile) {
    if (profile.mustChangePassword) return <Navigate to="/change-password" replace />
    return <Navigate to={defaultAuthenticatedPath(role, profile.permissions)} replace />
  }

  if (status === 'unprovisioned' || status === 'disabled') {
    return <Navigate to="/access-denied" replace />
  }

  return <Outlet />
}
