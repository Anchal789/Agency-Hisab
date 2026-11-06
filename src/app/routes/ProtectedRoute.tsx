import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/app/providers/AuthProvider'
import { LoadingState } from '@/components/common/LoadingState'

export function ProtectedRoute() {
  const { status, profile } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (status === 'unprovisioned' || status === 'disabled') {
    return <Navigate to="/access-denied" replace />
  }

  if (profile?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return <Outlet />
}
