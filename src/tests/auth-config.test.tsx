import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Supabase is NOT configured: the app must show the setup screen and nothing else.
vi.mock('../lib/supabase', () => ({
  supabase: null,
  isSupabaseConfigured: false,
  configProblems: ['VITE_SUPABASE_URL is not set.', 'VITE_SUPABASE_ANON_KEY is not set.'],
  authRedirectUrl: () => 'http://localhost/',
  startedFromAuthLink: false,
  authLinkError: null,
}));

import { AuthGate } from '../AuthGate';
import { AuthProvider } from '../hooks/useAuth';

const renderGate = (path: string) =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthGate />
      </MemoryRouter>
    </AuthProvider>,
  );

describe('missing Supabase configuration', () => {
  it.each(['/', '/revision', '/login', '/register', '/reset-password'])('shows the setup screen at %s and never the app or a login form', (path) => {
    renderGate(path);
    expect(screen.getByRole('heading', { level: 1, name: 'Setup needed' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL is not set.');
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_ANON_KEY is not set.');
    expect(screen.getByText(/\.env\.example/)).toBeInTheDocument();
    expect(screen.getByText(/never a service-role or secret key/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(window.localStorage.length).toBe(0); // the app's data layer was not even started
  });
});
