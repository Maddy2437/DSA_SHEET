import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tests the REAL client module (no mock) with different environment values.
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (role: string) => `${b64url({ alg: 'HS256' })}.${b64url({ role })}.sig`;

async function load(env: Record<string, string>, url = '/') {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  window.history.replaceState({}, '', url);
  return import('../lib/supabase');
}

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

describe('lib/supabase (the single client module)', () => {
  it('does not create a client, and says what is wrong, when the variables are missing', async () => {
    const m = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' });
    expect(m.isSupabaseConfigured).toBe(false);
    expect(m.supabase).toBeNull();
    expect(m.configProblems).toEqual(['VITE_SUPABASE_URL is not set.', 'VITE_SUPABASE_ANON_KEY is not set.']);
  });

  it('never starts with a service-role key', async () => {
    const m = await load({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('service_role') });
    expect(m.isSupabaseConfigured).toBe(false);
    expect(m.supabase).toBeNull();
    expect(m.configProblems[0]).toMatch(/service-role/);
  });

  it('creates exactly one client from a valid configuration', async () => {
    const m = await load({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') });
    expect(m.isSupabaseConfigured).toBe(true);
    expect(m.configProblems).toEqual([]);
    expect(m.supabase).not.toBeNull();
    const again = await import('../lib/supabase'); // same module instance, same client
    expect(again.supabase).toBe(m.supabase);
  });

  it('sends email links back to the current site root, or to VITE_AUTH_REDIRECT_URL when set', async () => {
    window.history.replaceState({}, '', '/#/reset-password?x=1');
    const m = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_AUTH_REDIRECT_URL: '' }, '/#/reset-password?x=1');
    expect(m.authRedirectUrl()).toBe(window.location.origin + '/'); // no hash, no query
    const o = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_AUTH_REDIRECT_URL: 'https://dsa-notes-five.vercel.app/' });
    expect(o.authRedirectUrl()).toBe('https://dsa-notes-five.vercel.app/');
  });

  it('notes when the page was opened from an email link, and reads a link error, before the client cleans the URL', async () => {
    const ok = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, '/?code=abc123');
    expect(ok.startedFromAuthLink).toBe(true);
    expect(ok.authLinkError).toBeNull();
    const bad = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, '/?error=access_denied&error_code=otp_expired&error_description=expired');
    expect(bad.startedFromAuthLink).toBe(false);
    expect(bad.authLinkError).toMatch(/invalid or has expired/);
    const plain = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, '/#/revision');
    expect(plain.startedFromAuthLink).toBe(false);
    expect(plain.authLinkError).toBeNull();
  });
});
