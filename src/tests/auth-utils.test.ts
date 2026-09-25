import { describe, expect, it } from 'vitest';
import {
  displayNameOf, friendlyAuthError, parseAuthLinkError, safeReturnPath, supabaseConfigProblems, validateConfirm, validateEmail,
  validateName, validateNewPassword,
} from '../utils/auth';

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role, iss: 'supabase' })}.signature`;

describe('validation', () => {
  it('validates email addresses', () => {
    expect(validateEmail('')).toMatch(/Enter your email/);
    expect(validateEmail('   ')).toMatch(/Enter your email/);
    for (const bad of ['plain', 'a@b', '@x.com', 'a b@x.com', 'a@@x.com']) expect(validateEmail(bad)).toMatch(/valid email/);
    expect(validateEmail('  asha@example.com  ')).toBeNull(); // surrounding spaces are ignored
    expect(validateEmail('a.b+tag@sub.example.co')).toBeNull();
  });

  it('validates names', () => {
    expect(validateName('')).toMatch(/Enter your name/);
    expect(validateName(' A ')).toMatch(/at least 2/);
    expect(validateName('x'.repeat(61))).toMatch(/60/);
    expect(validateName('Asha')).toBeNull();
  });

  it('asks for a reasonable NEW password: 8+ characters with a letter and a number', () => {
    expect(validateNewPassword('')).toMatch(/Enter a password/);
    expect(validateNewPassword('abc12')).toMatch(/at least 8/);
    expect(validateNewPassword('abcdefgh')).toMatch(/letter and one number/);
    expect(validateNewPassword('12345678')).toMatch(/letter and one number/);
    expect(validateNewPassword('a1'.repeat(37))).toMatch(/72/);
    expect(validateNewPassword('Secret123')).toBeNull();
    expect(validateNewPassword('correct horse 9')).toBeNull();
  });

  it('checks the confirmation', () => {
    expect(validateConfirm('Secret123', '')).toMatch(/Confirm/);
    expect(validateConfirm('Secret123', 'Secret124')).toMatch(/do not match/);
    expect(validateConfirm('Secret123', 'Secret123')).toBeNull();
  });
});

describe('friendlyAuthError', () => {
  it('turns server errors into messages a person can act on, without showing the raw text', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'login')).toBe('Incorrect email or password.');
    expect(friendlyAuthError({ message: 'Invalid login credentials' }, 'login')).toBe('Incorrect email or password.');
    expect(friendlyAuthError({ code: 'email_not_confirmed' }, 'login')).toMatch(/confirm your email/);
    expect(friendlyAuthError({ code: 'user_already_exists' }, 'signup')).toMatch(/already exists/);
    expect(friendlyAuthError({ code: 'weak_password' }, 'signup')).toMatch(/stronger password/);
    expect(friendlyAuthError({ code: 'signup_disabled' }, 'signup')).toMatch(/not being accepted/);
    expect(friendlyAuthError({ code: 'over_request_rate_limit' }, 'login')).toMatch(/Too many attempts/);
    expect(friendlyAuthError({ status: 429 }, 'reset')).toMatch(/Too many attempts/);
    expect(friendlyAuthError({ code: 'same_password' }, 'update')).toMatch(/different/);
    expect(friendlyAuthError({ code: 'session_not_found' }, 'update')).toMatch(/link has expired/);
    expect(friendlyAuthError({ message: 'Auth session missing!' }, 'login')).toMatch(/session has expired/);
  });

  it('recognises network failures', () => {
    expect(friendlyAuthError(new TypeError('Failed to fetch'), 'login')).toMatch(/reach the server/);
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', message: 'x' }, 'signup')).toMatch(/reach the server/);
  });

  it('falls back to a generic message per action, and never echoes an unknown raw message', () => {
    const odd = { message: 'ERROR: relation "auth.users" does not exist (SQLSTATE 42P01)', code: 'unexpected_failure' };
    for (const [ctx, re] of [['login', /log you in/], ['signup', /create your account/], ['reset', /reset email/], ['update', /update your password/], ['signout', /log you out/]] as const) {
      const msg = friendlyAuthError(odd, ctx);
      expect(msg).toMatch(re);
      expect(msg).not.toMatch(/SQLSTATE|auth\.users/);
    }
    expect(friendlyAuthError(undefined, 'login')).toMatch(/log you in/);
    expect(friendlyAuthError('boom', 'login')).toMatch(/log you in/);
  });
});

describe('parseAuthLinkError', () => {
  it('reads an expired or invalid email link from the query string or from the hash', () => {
    expect(parseAuthLinkError('?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '')).toMatch(/invalid or has expired/);
    expect(parseAuthLinkError('', '#error=access_denied&error_code=otp_expired&error_description=x')).toMatch(/invalid or has expired/);
    expect(parseAuthLinkError('?error=server_error&error_description=Something+odd', '')).toMatch(/couldn't be used/);
  });

  it('ignores normal URLs, including hash routes and success codes', () => {
    expect(parseAuthLinkError('', '')).toBeNull();
    expect(parseAuthLinkError('?code=abc123', '#/reset-password')).toBeNull();
    expect(parseAuthLinkError('', '#/login?error=x')).toBeNull(); // a route, not auth parameters
  });
});

describe('supabaseConfigProblems', () => {
  const url = 'https://abcdefgh.supabase.co';

  it('is empty for a usable configuration', () => {
    expect(supabaseConfigProblems(url, jwt('anon'))).toEqual([]);
    expect(supabaseConfigProblems(url, 'sb_publishable_abc123')).toEqual([]);
  });

  it('says which variable is missing or malformed, without printing any value', () => {
    expect(supabaseConfigProblems(undefined, undefined)).toEqual(['VITE_SUPABASE_URL is not set.', 'VITE_SUPABASE_ANON_KEY is not set.']);
    expect(supabaseConfigProblems('', '  ')).toHaveLength(2);
    const bad = supabaseConfigProblems('not-a-url', jwt('anon'));
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/full URL/);
    expect(bad.join(' ')).not.toContain('not-a-url');
  });

  it('refuses a service-role or secret key in the frontend', () => {
    for (const key of [jwt('service_role'), 'sb_secret_abcdef']) {
      const p = supabaseConfigProblems(url, key);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(/secret \/ service-role key/);
      expect(p.join(' ')).not.toContain(key);
    }
  });
});

describe('small helpers', () => {
  it('picks a display name from the account metadata', () => {
    expect(displayNameOf(null)).toBe('');
    expect(displayNameOf({ email: 'asha@example.com', user_metadata: { display_name: ' Asha K ' } })).toBe('Asha K');
    expect(displayNameOf({ email: 'a@x.com', user_metadata: { full_name: 'Full Name' } })).toBe('Full Name');
    expect(displayNameOf({ email: 'asha@example.com', user_metadata: {} })).toBe('asha');
    expect(displayNameOf({ email: null, user_metadata: null })).toBe('Account');
  });

  it('only ever returns to a path inside the app', () => {
    expect(safeReturnPath('/revision')).toBe('/revision');
    expect(safeReturnPath('/roadmap?x=1')).toBe('/roadmap?x=1');
    for (const bad of [undefined, null, 5, '', 'revision', '//evil.com', 'https://evil.com', '/login', '/register', '/forgot-password', '/reset-password']) {
      expect(safeReturnPath(bad)).toBe('/');
    }
  });
});
