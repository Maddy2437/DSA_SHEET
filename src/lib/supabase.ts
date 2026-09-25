import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseAuthLinkError, supabaseConfigProblems } from '../utils/auth';

// THE one Supabase client for the whole app. Import `supabase` from here; never call createClient anywhere else.
//
// Configuration comes from Vite environment variables (see .env.example). Only the project URL and the anon
// (publishable) key belong in the browser. A service-role / secret key must NEVER be used here; if one is supplied it
// is refused (see supabaseConfigProblems) and the app shows a configuration screen instead of starting.

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Why the app cannot use Supabase (empty when it can). The messages never include the values themselves. */
export const configProblems: string[] = supabaseConfigProblems(url, anonKey);
export const isSupabaseConfigured = configProblems.length === 0;

// Read BEFORE the client is created: on start-up the client exchanges the `?code=` of an email link for a session
// and then removes it from the address bar.
const here = typeof window === 'undefined' ? { search: '', hash: '' } : window.location;
/** True when this page load came from an email link (confirm signup / reset password). */
export const startedFromAuthLink = /[?&]code=/.test(here.search);
/** Set when the email link that brought the user here was invalid or expired. */
export const authLinkError: string | null = parseAuthLinkError(here.search, here.hash);

// PKCE flow: email links come back as `https://site/?code=...` (a query string), which works with this app's HashRouter.
// The older implicit flow puts tokens in the URL fragment, which is the very place HashRouter keeps its route.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/**
 * Where email links (confirm signup, reset password) should return to: this site's root, without any hash or query.
 * Works on the production domain and on every Vercel preview deployment without hardcoding either. Set
 * VITE_AUTH_REDIRECT_URL only if the links must point somewhere else. Whatever is used must be listed under
 * Authentication -> URL Configuration -> Redirect URLs in the Supabase dashboard.
 */
export function authRedirectUrl(): string {
  const override = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();
  if (override) return override;
  return window.location.origin + window.location.pathname;
}
