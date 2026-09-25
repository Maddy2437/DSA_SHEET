import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' + HashRouter => the built site works on Vercel, any static host, or opened from disk.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // The 455-problem dataset is intentionally bundled into the app (no backend), so the bundle is ~1 MB / ~160 KB gzipped.
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    // Tests never use real Supabase credentials, even if a developer has a .env.local: auth tests mock the client.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_AUTH_REDIRECT_URL: '' },
    css: false,
  },
});
