// Pure helpers for the authentication pages: validation, friendly error messages, URL/env checks.
// Nothing here talks to Supabase, so all of it is easy to test.

// ---------- Validation (each returns an error message, or null when the value is fine) ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // longer passwords are rejected by the auth server
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters, with at least one letter and one number.`;

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
  if (v.length > 254 || !EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return null;
}

export function validateName(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your name.';
  if (v.length < 2) return 'Your name must be at least 2 characters.';
  if (v.length > 60) return 'Your name must be 60 characters or fewer.';
  return null;
}

/** For choosing a NEW password (register, reset). Logging in never enforces strength. */
export function validateNewPassword(value: string): string | null {
  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Include at least one letter and one number.';
  return null;
}

export function validateConfirm(password: string, confirm: string): string | null {
  if (!confirm) return 'Confirm your password.';
  if (password !== confirm) return 'The passwords do not match.';
  return null;
}

// ---------- Friendly error messages ----------
export type AuthContext = 'login' | 'signup' | 'reset' | 'update' | 'signout';

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
}

const asText = (x: unknown) => (typeof x === 'string' ? x : '');

/**
 * Turns a Supabase / network error into something a person can act on. Raw server messages are never shown as they are:
 * some are confusing, and some would confirm whether an email address has an account.
 */
export function friendlyAuthError(error: unknown, context: AuthContext): string {
  const e: ErrorLike = typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
  const code = asText(e.code).toLowerCase();
  const message = asText(e.message).toLowerCase();
  const name = asText(e.name);
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (
    name === 'AuthRetryableFetchError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed')
  ) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429 || message.includes('rate limit')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Please confirm your email first. Check your inbox for the confirmation link.';
  }
  if (code === 'signup_disabled' || message.includes('signups not allowed')) return 'New accounts are not being accepted right now.';
  if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) {
    return 'An account with this email already exists. Log in, or reset your password.';
  }
  if (code === 'weak_password') return `Choose a stronger password. ${PASSWORD_HINT}`;
  if (code === 'same_password') return 'Your new password must be different from your current one.';
  if (code === 'session_not_found' || code === 'session_expired' || code === 'refresh_token_not_found' || message.includes('auth session missing')) {
    return context === 'update' ? 'This reset link has expired. Request a new one.' : 'Your session has expired. Please log in again.';
  }
  if (code === 'validation_failed' || code === 'email_address_invalid' || message.includes('invalid email')) return 'Enter a valid email address.';

  switch (context) {
    case 'login': return "Couldn't log you in. Please try again.";
    case 'signup': return "Couldn't create your account. Please try again.";
    case 'reset': return "Couldn't send the reset email. Please try again.";
    case 'update': return "Couldn't update your password. Please try again.";
    case 'signout': return "Couldn't log you out. Please try again.";
  }
}

// ---------- Errors carried in the URL of an email link ----------
/**
 * Supabase redirects back with `error_description` (and `error_code`) in the query or the hash when an email link is
 * invalid or expired. Returns a friendly message, or null when the URL carries no auth error.
 */
export function parseAuthLinkError(search: string, hash: string): string | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  // Only look at a hash that is a query string (implicit-flow style), never a route such as "#/login".
  if (hash.includes('=') && !hash.startsWith('#/')) new URLSearchParams(hash.replace(/^#/, '')).forEach((v, k) => params.set(k, v));
  const code = (params.get('error_code') ?? '').toLowerCase();
  const raw = params.get('error_description') ?? params.get('error') ?? '';
  if (!code && !raw) return null;
  if (code === 'otp_expired' || /expired|invalid/i.test(raw)) return 'That email link is invalid or has expired. Request a new one.';
  return "That email link couldn't be used. Request a new one.";
}

// ---------- Environment ----------
/** Decodes the payload of a JWT-style key without verifying it, only to see which role it grants. */
function jwtRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/**
 * Problems with the two public Supabase variables, as messages that never contain the values themselves.
 * An empty list means the configuration is usable. A service-role / secret key is refused outright: anything in a
 * VITE_ variable ends up in the browser bundle.
 */
export function supabaseConfigProblems(url: string | undefined, anonKey: string | undefined): string[] {
  const problems: string[] = [];
  const u = (url ?? '').trim();
  const k = (anonKey ?? '').trim();
  if (!u) problems.push('VITE_SUPABASE_URL is not set.');
  else if (!/^https?:\/\/[^\s/]+/i.test(u)) problems.push('VITE_SUPABASE_URL must be a full URL such as https://your-project-ref.supabase.co.');
  if (!k) problems.push('VITE_SUPABASE_ANON_KEY is not set.');
  else if (k.startsWith('sb_secret_') || jwtRole(k) === 'service_role') {
    problems.push('VITE_SUPABASE_ANON_KEY holds a secret / service-role key. Never put that in the frontend. Use the anon (publishable) key instead.');
  }
  return problems;
}

// ---------- Display ----------
export function displayNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null): string {
  if (!user) return '';
  const meta = user.user_metadata ?? {};
  for (const key of ['display_name', 'full_name', 'name']) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return (user.email ?? '').split('@')[0] || 'Account';
}

/** Where to send someone after they log in: only ever a path inside this app. */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return '/';
  if (/^\/(login|register|forgot-password|reset-password)(\/|\?|$)/.test(from)) return '/';
  return from;
}
