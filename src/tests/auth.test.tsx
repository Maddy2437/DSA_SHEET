import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Supabase client. The real one is never used in the normal test suite: no account, no network.
const h = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void;
  const listeners = new Set<Listener>();
  const state = { session: null as unknown, fromLink: false, linkError: null as string | null };
  const emit = (event: string, session: unknown) => {
    state.session = session;
    [...listeners].forEach((l) => l(event, session));
  };
  const auth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  };
  return { listeners, state, emit, auth };
});

vi.mock('../lib/supabase', () => ({
  supabase: { auth: h.auth },
  isSupabaseConfigured: true,
  configProblems: [],
  authRedirectUrl: () => 'https://dsa-notes-five.vercel.app/',
  get startedFromAuthLink() {
    return h.state.fromLink;
  },
  get authLinkError() {
    return h.state.linkError;
  },
}));

import { AuthGate } from '../AuthGate';
import { AuthProvider } from '../hooks/useAuth';
import { dataset } from '../utils/dataset';
import { STORAGE_KEYS } from '../utils/storage';
import { entry, seedProgress, storedProgress } from './helpers';

// ---------- fixtures ----------
const makeUser = (over: object = {}) => ({ id: 'u1', email: 'asha@example.com', user_metadata: { display_name: 'Asha' }, ...over });
const makeSession = (user = makeUser()) => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user });
const ok = { data: { user: null, session: null }, error: null };
const authError = (code: string, message: string, status = 400) => ({ data: { user: null, session: null }, error: { code, message, status, name: 'AuthApiError' } });

function renderGate(path = '/') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthGate />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const signedIn = () => (h.state.session = makeSession());

// Records whether the protected app was EVER on screen, even for a single render (the "flash" a redirect would cause).
function watchForApp() {
  const seen = { app: false };
  const check = () => {
    if (document.querySelector('nav[aria-label="Main"]')) seen.app = true;
  };
  const obs = new MutationObserver(check);
  obs.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => obs.disconnect() };
}

const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
const typeInto = async (user: ReturnType<typeof userEvent.setup>, label: string, text: string) => {
  await user.type(screen.getByLabelText(label), text);
};

beforeEach(() => {
  h.state.session = null;
  h.state.fromLink = false;
  h.state.linkError = null;
  h.listeners.clear();
  vi.clearAllMocks();
  h.auth.getSession.mockImplementation(async () => ({ data: { session: h.state.session }, error: null }));
  h.auth.onAuthStateChange.mockImplementation((cb: (e: string, s: unknown) => void) => {
    h.listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => h.listeners.delete(cb) } } };
  });
  h.auth.signOut.mockImplementation(async () => {
    h.emit('SIGNED_OUT', null);
    return { error: null };
  });
  h.auth.signInWithPassword.mockResolvedValue(ok);
  h.auth.signUp.mockResolvedValue(ok);
  h.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  h.auth.updateUser.mockResolvedValue({ data: { user: makeUser() }, error: null });
});

// ======================================================================================================
describe('session states', () => {
  it('shows a loading state while the session is being checked, and neither the app nor the login page', async () => {
    let resolve!: (v: unknown) => void;
    h.auth.getSession.mockReturnValue(new Promise((r) => (resolve = r)));
    const watch = watchForApp();
    renderGate('/revision');
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();

    await act(async () => resolve({ data: { session: makeSession() }, error: null }));
    expect(await h1('Revision Hub')).toBeInTheDocument(); // a signed-in user lands where they were going
    watch.stop();
  });

  it('signed out: every app page redirects to Log in, and the app is never rendered', async () => {
    for (const path of ['/', '/roadmap', '/important', '/revision', '/settings', '/nowhere']) {
      const watch = watchForApp();
      const view = renderGate(path);
      expect(await h1('Log in')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
      expect(watch.seen.app).toBe(false); // no flash of the protected app
      watch.stop();
      view.unmount();
    }
    expect(window.localStorage.getItem(STORAGE_KEYS.progress)).toBeNull(); // the data layer never even started
    expect(window.localStorage.getItem(STORAGE_KEYS.settings)).toBeNull();
  });

  it('signed in: the app opens (Dashboard, Roadmap, Important, Revision Hub, Settings)', async () => {
    signedIn();
    for (const [path, heading] of [['/', 'Dashboard'], ['/roadmap', 'Roadmap'], ['/important', 'Important'], ['/revision', 'Revision Hub'], ['/settings', 'Settings']] as const) {
      const view = renderGate(path);
      expect(await h1(heading)).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('an unknown path inside the app goes to the Dashboard', async () => {
    signedIn();
    renderGate('/nowhere');
    expect(await h1('Dashboard')).toBeInTheDocument();
  });

  it('a signed-in user who opens Log in, Create account or Forgot password is sent to the app', async () => {
    signedIn();
    for (const path of ['/login', '/register', '/forgot-password']) {
      const view = renderGate(path);
      expect(await h1('Dashboard')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
      view.unmount();
    }
  });

  it('survives a refresh: the stored session is picked up again, with a single lookup per page load', async () => {
    signedIn();
    const first = renderGate('/revision');
    expect(await h1('Revision Hub')).toBeInTheDocument();
    first.unmount(); // == browser refresh
    expect(h.listeners.size).toBe(0); // unsubscribed on unmount
    renderGate('/revision');
    expect(await h1('Revision Hub')).toBeInTheDocument();
    expect(h.auth.getSession).toHaveBeenCalledTimes(2); // once per load, not once per navigation or render
    expect(h.auth.onAuthStateChange).toHaveBeenCalledTimes(2);
  });

  it('reacts to auth events: token refresh keeps the app open, a sign-out elsewhere returns to Log in', async () => {
    signedIn();
    renderGate('/');
    expect(await h1('Dashboard')).toBeInTheDocument();
    act(() => h.emit('TOKEN_REFRESHED', makeSession()));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    act(() => h.emit('SIGNED_OUT', null)); // e.g. logged out in another tab, or the session expired
    expect(await h1('Log in')).toBeInTheDocument();
  });

  it('treats a failing session lookup as signed out instead of hanging on the loading screen', async () => {
    h.auth.getSession.mockRejectedValue(new Error('storage unavailable'));
    renderGate('/');
    expect(await h1('Log in')).toBeInTheDocument();
  });
});

// ======================================================================================================
describe('login', () => {
  it('logs in, opens the app on the page that was asked for, and does not touch the local data', async () => {
    const user = userEvent.setup();
    const p = dataset.problems[10];
    seedProgress({ [p.id]: entry({ status: 'solved', solvedDate: '2026-01-01', revision: { stage: 1, due: '2026-01-05', attempts: [] } }) });
    const before = storedProgress();
    h.auth.signInWithPassword.mockImplementation(async () => {
      h.emit('SIGNED_IN', makeSession());
      return ok;
    });
    renderGate('/revision'); // signed out: redirected to Log in, remembering where to go back to
    await h1('Log in');
    await typeInto(user, 'Email', '  asha@example.com ');
    await typeInto(user, 'Password', 'Secret123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await h1('Revision Hub')).toBeInTheDocument();
    expect(h.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'asha@example.com', password: 'Secret123' });
    expect(storedProgress()).toEqual(before); // exactly the same local progress
    expect(screen.getByTestId('hub-overdue')).toHaveTextContent('1'); // and the existing app works on it
  });

  it('shows a readable message for a wrong password and stays on the page, ready to retry', async () => {
    const user = userEvent.setup();
    h.auth.signInWithPassword.mockResolvedValue(authError('invalid_credentials', 'Invalid login credentials'));
    renderGate('/login');
    await h1('Log in');
    await typeInto(user, 'Email', 'asha@example.com');
    await typeInto(user, 'Password', 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(screen.queryByText(/Invalid login credentials/)).toBeNull(); // never the raw server text
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
  });

  it('handles other failures: unconfirmed email, network down, unexpected errors', async () => {
    const user = userEvent.setup();
    renderGate('/login');
    await h1('Log in');
    await typeInto(user, 'Email', 'asha@example.com');
    await typeInto(user, 'Password', 'Secret123');
    const submit = () => user.click(screen.getByRole('button', { name: 'Log in' }));

    h.auth.signInWithPassword.mockResolvedValueOnce(authError('email_not_confirmed', 'Email not confirmed'));
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm your email/);

    h.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/reach the server/));

    h.auth.signInWithPassword.mockResolvedValueOnce(authError('unexpected_failure', 'ERROR: SQLSTATE 42P01', 500));
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't log you in/));
    expect(screen.queryByText(/SQLSTATE/)).toBeNull();
  });

  it('validates before calling Supabase', async () => {
    const user = userEvent.setup();
    renderGate('/login');
    await h1('Log in');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    await typeInto(user, 'Email', 'not-an-email');
    await typeInto(user, 'Password', 'x');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(h.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('disables the button and shows progress while logging in, and cannot be submitted twice', async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    h.auth.signInWithPassword.mockReturnValue(new Promise((r) => (resolve = r)));
    renderGate('/login');
    await h1('Log in');
    await typeInto(user, 'Email', 'asha@example.com');
    await typeInto(user, 'Password', 'Secret123');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const busy = screen.getByRole('button', { name: /Logging in/ });
    expect(busy).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    await user.click(busy);
    expect(h.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    await act(async () => resolve(authError('invalid_credentials', 'x')));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('links to Forgot password and Create account, and can show the password', async () => {
    const user = userEvent.setup();
    renderGate('/login');
    await h1('Log in');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('tells the user when the email link that brought them here was invalid or expired', async () => {
    const user = userEvent.setup();
    h.state.linkError = 'That email link is invalid or has expired. Request a new one.';
    renderGate('/login');
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ======================================================================================================
describe('registration', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, v: { name?: string; email?: string; password?: string; confirm?: string }) => {
    if (v.name) await typeInto(user, 'Name', v.name);
    if (v.email) await typeInto(user, 'Email', v.email);
    if (v.password) await typeInto(user, 'Password', v.password);
    if (v.confirm) await typeInto(user, 'Confirm password', v.confirm);
  };
  const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Create account' }));

  it('validates every field before calling Supabase', async () => {
    const user = userEvent.setup();
    renderGate('/register');
    await h1('Create account');
    await submit(user);
    for (const msg of ['Enter your name.', 'Enter your email address.', 'Enter a password.', 'Confirm your password.']) expect(screen.getByText(msg)).toBeInTheDocument();

    await fill(user, { name: 'A', email: 'bad', password: 'abc', confirm: 'xyz' });
    await submit(user);
    expect(screen.getByText('Your name must be at least 2 characters.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(h.auth.signUp).not.toHaveBeenCalled();
  });

  it('rejects a password without a number, and a password confirmation that does not match', async () => {
    const user = userEvent.setup();
    renderGate('/register');
    await h1('Create account');
    await fill(user, { name: 'Asha', email: 'asha@example.com', password: 'onlyletters', confirm: 'onlyletters' });
    await submit(user);
    expect(screen.getByText('Include at least one letter and one number.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'Secret123');
    await submit(user);
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument(); // password changed, confirmation did not
    expect(h.auth.signUp).not.toHaveBeenCalled();
  });

  it('creates the account, keeps the name in the user metadata, and asks the user to confirm their email', async () => {
    const user = userEvent.setup();
    h.auth.signUp.mockResolvedValue({ data: { user: makeUser({ identities: [{ id: 'i1' }] }), session: null }, error: null });
    renderGate('/register');
    await h1('Create account');
    await fill(user, { name: ' Asha K ', email: ' asha@example.com ', password: 'Secret123', confirm: 'Secret123' });
    await submit(user);

    expect(await h1('Check your email')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('asha@example.com');
    expect(h.auth.signUp).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'Secret123',
      options: { data: { display_name: 'Asha K' }, emailRedirectTo: 'https://dsa-notes-five.vercel.app/' },
    });
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });

  it('with email confirmation switched off, the new account is signed in and lands in the app', async () => {
    const user = userEvent.setup();
    h.auth.signUp.mockImplementation(async () => {
      const session = makeSession(makeUser({ identities: [{ id: 'i1' }] }));
      h.emit('SIGNED_IN', session);
      return { data: { user: session.user, session }, error: null };
    });
    renderGate('/register');
    await h1('Create account');
    await fill(user, { name: 'Asha', email: 'asha@example.com', password: 'Secret123', confirm: 'Secret123' });
    await submit(user);
    expect(await h1('Dashboard')).toBeInTheDocument();
  });

  it('says so when the email already has an account (Supabase returns a user with no identities)', async () => {
    const user = userEvent.setup();
    h.auth.signUp.mockResolvedValue({ data: { user: makeUser({ identities: [] }), session: null }, error: null });
    renderGate('/register');
    await h1('Create account');
    await fill(user, { name: 'Asha', email: 'asha@example.com', password: 'Secret123', confirm: 'Secret123' });
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/);
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
  });

  it('shows friendly messages for server-side failures and disables the form while working', async () => {
    const user = userEvent.setup();
    let resolve!: (v: unknown) => void;
    h.auth.signUp.mockReturnValue(new Promise((r) => (resolve = r)));
    renderGate('/register');
    await h1('Create account');
    await fill(user, { name: 'Asha', email: 'asha@example.com', password: 'Secret123', confirm: 'Secret123' });
    await submit(user);
    expect(screen.getByRole('button', { name: /Creating account/ })).toBeDisabled();
    await act(async () => resolve(authError('weak_password', 'Password should contain letters and digits', 422)));
    expect(await screen.findByRole('alert')).toHaveTextContent(/stronger password/);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });
});

// ======================================================================================================
describe('forgot and reset password', () => {
  it('sends the reset email with the configured redirect URL and confirms it clearly', async () => {
    const user = userEvent.setup();
    renderGate('/forgot-password');
    await h1('Forgot password');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(h.auth.resetPasswordForEmail).not.toHaveBeenCalled();

    await typeInto(user, 'Email', ' asha@example.com ');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await h1('Check your email')).toBeInTheDocument();
    expect(h.auth.resetPasswordForEmail).toHaveBeenCalledWith('asha@example.com', { redirectTo: 'https://dsa-notes-five.vercel.app/' });
    expect(screen.getByRole('status')).toHaveTextContent(/If an account exists for asha@example.com/);
  });

  it('reports a failure to send (for example rate limiting) in plain words', async () => {
    const user = userEvent.setup();
    h.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded', status: 429 } });
    renderGate('/forgot-password');
    await h1('Forgot password');
    await typeInto(user, 'Email', 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
  });

  // Simulates what the real client does when the page is opened from a reset link: it exchanges the ?code= for a
  // session and announces PASSWORD_RECOVERY one tick after start-up.
  const openFromResetLink = () => {
    h.state.fromLink = true;
    h.state.session = makeSession();
    h.auth.onAuthStateChange.mockImplementation((cb: (e: string, s: unknown) => void) => {
      h.listeners.add(cb);
      setTimeout(() => h.emit('PASSWORD_RECOVERY', makeSession()), 0);
      return { data: { subscription: { unsubscribe: () => h.listeners.delete(cb) } } };
    });
  };

  it('opening a reset link goes straight to "Choose a new password", never through the app', async () => {
    openFromResetLink();
    const watch = watchForApp();
    renderGate('/');
    expect(await h1('Choose a new password')).toBeInTheDocument();
    expect(watch.seen.app).toBe(false); // the recovery session did not flash the app
    watch.stop();
  });

  it('a recovery session cannot open any app page until a new password is set', async () => {
    openFromResetLink();
    renderGate('/roadmap');
    expect(await h1('Choose a new password')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('validates the new password, saves it, and continues into the app', async () => {
    const user = userEvent.setup();
    openFromResetLink();
    renderGate('/');
    await h1('Choose a new password');

    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByText('Enter a password.')).toBeInTheDocument();
    await typeInto(user, 'New password', 'short1');
    await typeInto(user, 'Confirm new password', 'different1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(h.auth.updateUser).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await typeInto(user, 'New password', 'Brand-new-42');
    await typeInto(user, 'Confirm new password', 'Brand-new-42');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await h1('Password updated')).toBeInTheDocument();
    expect(h.auth.updateUser).toHaveBeenCalledWith({ password: 'Brand-new-42' });
    await user.click(screen.getByRole('button', { name: 'Continue to the app' }));
    expect(await h1('Dashboard')).toBeInTheDocument();
  });

  it('explains a failed update (for example the same password) and lets the user try again', async () => {
    const user = userEvent.setup();
    openFromResetLink();
    h.auth.updateUser.mockResolvedValue({ data: { user: null }, error: { code: 'same_password', message: 'New password should be different from the old password.', status: 422 } });
    renderGate('/');
    await h1('Choose a new password');
    await typeInto(user, 'New password', 'Brand-new-42');
    await typeInto(user, 'Confirm new password', 'Brand-new-42');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/different from your current one/);
    expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
  });

  it('"Cancel and log out" ends the recovery session and returns to Log in', async () => {
    const user = userEvent.setup();
    openFromResetLink();
    renderGate('/');
    await h1('Choose a new password');
    await user.click(screen.getByRole('button', { name: 'Cancel and log out' }));
    expect(await h1('Log in')).toBeInTheDocument();
    expect(h.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('opening the reset page without a valid link says the link is not valid and offers a new one', async () => {
    renderGate('/reset-password');
    expect(await h1('Reset link not valid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('a normally signed-in user who opens the reset page is sent to the app', async () => {
    signedIn();
    renderGate('/reset-password');
    expect(await h1('Dashboard')).toBeInTheDocument();
  });
});

// ======================================================================================================
describe('logout (Settings)', () => {
  it('shows who is signed in and the shared-browser notice', async () => {
    signedIn();
    renderGate('/settings');
    await h1('Settings');
    expect(screen.getByTestId('account-name')).toHaveTextContent('Asha');
    expect(screen.getByTestId('account-email')).toHaveTextContent('asha@example.com');
    expect(screen.getByTestId('shared-browser-notice')).toHaveTextContent(/saved in this browser, not in your account/);
    expect(screen.getByTestId('shared-browser-notice')).toHaveTextContent(/logging out does not remove it/);
  });

  it('logs out through Supabase, returns to Log in, and leaves every bit of local data in place', async () => {
    const user = userEvent.setup();
    const p = dataset.problems[10];
    seedProgress({ [p.id]: entry({ status: 'solved', solvedDate: '2026-01-01', notes: 'keep me', revision: { stage: 1, due: '2026-01-05', attempts: [] } }) });
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ theme: 'light', dailyTarget: 15, revisionTarget: 20, lastExport: null }));
    const before = { progress: storedProgress(), settings: JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings)!) };
    signedIn();
    renderGate('/settings');
    await h1('Settings');
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await h1('Log in')).toBeInTheDocument();
    expect(h.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }); // this device only
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(storedProgress()).toEqual(before.progress); // progress, notes and revision state are still there
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings)!)).toEqual(before.settings);

    // And logging in again shows the same data.
    const user2 = userEvent.setup();
    h.auth.signInWithPassword.mockImplementation(async () => {
      h.emit('SIGNED_IN', makeSession());
      return ok;
    });
    await typeInto(user2, 'Email', 'asha@example.com');
    await typeInto(user2, 'Password', 'Secret123');
    await user2.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await h1('Settings')).toBeInTheDocument(); // returns to where they were, not always the Dashboard
    expect(screen.getByTestId('account-email')).toHaveTextContent('asha@example.com');
    expect(storedProgress()).toEqual(before.progress);
  });

  it('stays in the app and says so if logging out fails', async () => {
    const user = userEvent.setup();
    h.auth.signOut.mockResolvedValue({ error: { message: 'Failed to fetch', name: 'AuthRetryableFetchError' } });
    signedIn();
    renderGate('/settings');
    await h1('Settings');
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await within(screen.getByRole('region', { name: 'Account' })).findByRole('alert')).toHaveTextContent(/reach the server/);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });
});

// ======================================================================================================
describe('the existing app keeps working behind the login (Revision Hub V2 on localStorage)', () => {
  it('records a real revision through the Revision Session, and the data survives logging out and in again', async () => {
    const user = userEvent.setup();
    const p = dataset.problems[10];
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    seedProgress({ [p.id]: entry({ status: 'solved', solvedDate: '2026-01-01', revision: { stage: 1, due: key, attempts: [] } }) });
    signedIn();
    renderGate('/revision');
    await h1('Revision Hub');
    expect(screen.getByTestId('hub-due')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Start Revision Session' }));
    await user.click(screen.getByRole('button', { name: /^Solved easily/ }));
    expect(screen.getByRole('heading', { name: 'Revision Complete' })).toBeInTheDocument();
    const saved = storedProgress()[p.id];
    expect(saved.revision).toMatchObject({ stage: 2 });
    expect(saved.revision!.attempts).toHaveLength(1);

    // log out and in again: nothing was lost
    act(() => h.emit('SIGNED_OUT', null));
    expect(await h1('Log in')).toBeInTheDocument();
    act(() => h.emit('SIGNED_IN', makeSession()));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Log in' })).toBeNull());
    expect(storedProgress()[p.id]).toEqual(saved);
  });
});
