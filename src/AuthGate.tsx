import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell, Providers } from './App';
import { SessionLoading } from './components/AuthLayout';
import { useAuth } from './hooks/useAuth';
import ConfigMissing from './pages/auth/ConfigMissing';
import ForgotPassword from './pages/auth/ForgotPassword';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ResetPassword from './pages/auth/ResetPassword';
import { safeReturnPath } from './utils/auth';

// The door in front of the app. Must be rendered inside a Router (HashRouter in main.tsx, MemoryRouter in tests) and an
// <AuthProvider>.
//
//   not configured   -> a setup screen (never the app, never a fallback)
//   still checking   -> a loading screen (the app is NOT rendered and then redirected away)
//   signed out       -> Log in / Create account / Forgot password / Reset password
//   signed in        -> the app exactly as it was, still on its localStorage data layer
//
// PHASE 1: this only gates who can open the app. The progress data itself is not tied to an account yet (it is
// browser-local), so it is not private between people who share a browser. That comes with Phase 2.

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

// Login / Register / Forgot password are for signed-out people: a signed-in user is sent on into the app.
function PublicOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user) return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />;
  return <>{children}</>;
}

export function AuthGate() {
  const { configured, status, recovery } = useAuth();
  const { pathname } = useLocation();

  if (!configured) return <ConfigMissing />;
  if (status === 'loading') return <SessionLoading />;
  // Someone who opened a password-reset link must choose a new password before anything else.
  if (recovery && pathname !== '/reset-password') return <Navigate to="/reset-password" replace />;

  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Providers>
              <AppShell />
            </Providers>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
