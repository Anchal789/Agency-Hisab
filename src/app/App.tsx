import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { canAccessDashboard, canAccessSettings, defaultAuthenticatedPath } from '@shared/rules/permissions'
import { AppShell } from '@/app/layouts/AppShell'
import { AppProviders } from '@/app/providers/AppProviders'
import { useAuth } from '@/app/providers/AuthProvider'
import { AdminRoute } from '@/app/routes/AdminRoute'
import { GuestRoute } from '@/app/routes/GuestRoute'
import { PermissionRoute } from '@/app/routes/PermissionRoute'
import { ProtectedRoute } from '@/app/routes/ProtectedRoute'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { AccountPage } from '@/modules/account/AccountPage'
import { AccessDeniedPage } from '@/modules/auth/AccessDeniedPage'
import { ChangePasswordPage } from '@/modules/auth/ChangePasswordPage'
import { ForgotPasswordPage } from '@/modules/auth/ForgotPasswordPage'
import { LoginPage } from '@/modules/auth/LoginPage'
import { MissingConfigPage } from '@/modules/auth/MissingConfigPage'
import { DashboardPage } from '@/modules/dashboard/DashboardPage'
import { SettingsPage } from '@/modules/settings/SettingsPage'
import { UsersPage } from '@/modules/users/UsersPage'
import { missingFirebaseEnv } from '@/services/firebase/client'

function HomeRedirect() {
  const { role, profile, status } = useAuth()
  if (status === 'anonymous') return <Navigate to="/login" replace />
  if (!role || !profile) return <Navigate to="/access-denied" replace />
  return <Navigate to={defaultAuthenticatedPath(role, profile.permissions)} replace />
}

function DashboardGate() {
  const { role, profile } = useAuth()
  const allow = Boolean(role && profile && canAccessDashboard(role, profile.permissions))
  return <PermissionRoute allow={allow} />
}

function SettingsGate() {
  const { role } = useAuth()
  return <PermissionRoute allow={canAccessSettings(role ?? 'staff')} />
}

export function App() {
  if (missingFirebaseEnv().length > 0) {
    return (
      <ErrorBoundary>
        <MissingConfigPage />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <AppProviders>
        <BrowserRouter>
          <Routes>
            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>
            <Route path="/access-denied" element={<AccessDeniedPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="change-password" element={<ChangePasswordPage />} />
              <Route element={<AppShell />}>
                <Route path="account" element={<AccountPage />} />
                <Route element={<DashboardGate />}>
                  <Route index element={<DashboardPage />} />
                </Route>
                <Route element={<SettingsGate />}>
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route path="users" element={<UsersPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </BrowserRouter>
      </AppProviders>
    </ErrorBoundary>
  )
}
