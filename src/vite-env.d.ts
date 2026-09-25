/// <reference types="vite/client" />

// Build-time configuration (Vite only exposes variables that start with VITE_ to the browser).
// Only PUBLIC values belong here: the project URL and the anon / publishable key. Never a service-role or secret key.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Optional. Where Supabase email links (confirm signup, reset password) should send people. Defaults to this site. */
  readonly VITE_AUTH_REDIRECT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
