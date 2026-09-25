import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authLinkError, authRedirectUrl, isSupabaseConfigured, startedFromAuthLink, supabase } from '../lib/supabase';
import { friendlyAuthError, type AuthContext as ErrorContext } from '../utils/auth';

// Authentication for the whole app, on top of Supabase Auth.
//
// PHASE 1 LIMITATION (deliberate): logging in only decides who may OPEN the app. The DSA / revision data still lives in
// this browser's localStorage, exactly as before, and is not tied to an account. Two people who use the same browser
// share that data, and logging out does not remove it. Real per-user data (and Row Level Security) is Phase 2.

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

/** Every action reports failure as a friendly message instead of throwing. */
export type AuthResult<T extends object = object> = ({ ok: true } & T) | { ok: false; message: string };

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export interface AuthValue {
  /** False when the Supabase environment variables are missing or unusable (the app shows a configuration screen). */
  configured: boolean;
  status: AuthStatus;
  loading: boolean;
  user: User | null;
  session: Session | null;
  /** True after the user opened a password-reset email link: they must choose a new password before anything else. */
  recovery: boolean;
  /** A message when the email link that opened the app was invalid or expired. */
  linkError: string | null;
  clearLinkError: () => void;
  signUp: (input: SignUpInput) => Promise<AuthResult<{ needsConfirmation: boolean }>>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
}

const unavailable = async (): Promise<{ ok: false; message: string }> => ({ ok: false, message: 'Sign-in is not available here.' });

// What useAuth() returns outside an <AuthProvider>. The app itself is always rendered inside one; this only lets a
// component such as Settings render on its own (for example in tests) as "nobody is signed in".
const NO_AUTH: AuthValue = {
  configured: false,
  status: 'signed-out',
  loading: false,
  user: null,
  session: null,
  recovery: false,
  linkError: null,
  clearLinkError: () => {},
  signUp: unavailable,
  signIn: unavailable,
  signOut: unavailable,
  resetPassword: unavailable,
  updatePassword: unavailable,
};

const Ctx = createContext<AuthValue>(NO_AUTH);

const fail = (error: unknown, context: ErrorContext) => ({ ok: false as const, message: friendlyAuthError(error, context) });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; session: Session | null }>({
    status: supabase ? 'loading' : 'signed-out',
    session: null,
  });
  const [recovery, setRecovery] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(authLinkError);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = (session: Session | null) => {
      if (active) setState({ status: session ? 'signed-in' : 'signed-out', session });
    };

    // Auth changes after start-up: sign in / out, token refresh, password recovery, profile update.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return; // start-up is handled by getSession() below
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
      apply(session);
    });

    // The one start-up lookup. It waits for the client to finish reading storage and, when the page was opened from an
    // email link, for the `?code=` to be exchanged for a session, so a signed-in user is never shown as signed out.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        // The client announces "this was a password recovery link" one tick after start-up: wait for it, so a recovery
        // session never flashes the app before the reset page.
        if (startedFromAuthLink) setTimeout(() => apply(session), 0);
        else apply(session);
      })
      .catch(() => apply(null));

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback<AuthValue['signUp']>(async ({ name, email, password }) => {
    if (!supabase) return unavailable();
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // The display name is kept in the account's user metadata (no profiles table until Phase 2).
        options: { data: { display_name: name.trim() }, emailRedirectTo: authRedirectUrl() },
      });
      if (error) return fail(error, 'signup');
      // With email confirmation on, signing up an address that already has an account returns a user with no
      // identities (and no error), so that the response does not reveal which emails are registered.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return fail({ code: 'user_already_exists' }, 'signup');
      }
      return { ok: true, needsConfirmation: !data.session };
    } catch (e) {
      return fail(e, 'signup');
    }
  }, []);

  const signIn = useCallback<AuthValue['signIn']>(async (email, password) => {
    if (!supabase) return unavailable();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? fail(error, 'login') : { ok: true };
    } catch (e) {
      return fail(e, 'login');
    }
  }, []);

  const signOut = useCallback<AuthValue['signOut']>(async () => {
    if (!supabase) return unavailable();
    try {
      // 'local' ends the session on THIS device only. It removes Supabase's own stored session and nothing else:
      // the app's progress and settings in localStorage are left exactly as they are.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      return error ? fail(error, 'signout') : { ok: true };
    } catch (e) {
      return fail(e, 'signout');
    }
  }, []);

  const resetPassword = useCallback<AuthValue['resetPassword']>(async (email) => {
    if (!supabase) return unavailable();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl() });
      return error ? fail(error, 'reset') : { ok: true };
    } catch (e) {
      return fail(e, 'reset');
    }
  }, []);

  const updatePassword = useCallback<AuthValue['updatePassword']>(async (password) => {
    if (!supabase) return unavailable();
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return fail(error, 'update');
      setRecovery(false);
      return { ok: true };
    } catch (e) {
      return fail(e, 'update');
    }
  }, []);

  const clearLinkError = useCallback(() => setLinkError(null), []);

  const value = useMemo<AuthValue>(
    () => ({
      configured: isSupabaseConfigured,
      status: state.status,
      loading: state.status === 'loading',
      user: state.session?.user ?? null,
      session: state.session,
      recovery,
      linkError,
      clearLinkError,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
    }),
    [state, recovery, linkError, clearLinkError, signUp, signIn, signOut, resetPassword, updatePassword],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
