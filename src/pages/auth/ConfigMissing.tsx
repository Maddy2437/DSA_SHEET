import { TriangleAlert } from 'lucide-react';
import { AuthLayout } from '../../components/AuthLayout';
import { configProblems } from '../../lib/supabase';

// Shown instead of the app when Supabase is not configured. It lists what is wrong but never prints any value.
export default function ConfigMissing({ problems = configProblems }: { problems?: string[] }) {
  return (
    <AuthLayout title="Setup needed" subtitle="This app needs its sign-in service (Supabase) configured before it can start.">
      <div role="alert" className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <ul className="list-disc space-y-1 pl-4">
            {problems.length > 0 ? problems.map((p) => <li key={p}>{p}</li>) : <li>The Supabase configuration is missing.</li>}
          </ul>
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-muted">
          <li>
            Copy <code className="rounded bg-surface2 px-1">.env.example</code> to <code className="rounded bg-surface2 px-1">.env.local</code> and fill in
            <code className="mx-1 rounded bg-surface2 px-1">VITE_SUPABASE_URL</code> and
            <code className="mx-1 rounded bg-surface2 px-1">VITE_SUPABASE_ANON_KEY</code> (Supabase dashboard, Project Settings, API).
          </li>
          <li>On Vercel, add the same two variables under Settings, Environment Variables.</li>
          <li>Restart the dev server, or redeploy: these values are read when the app is built.</li>
        </ol>
        <p className="text-xs text-muted">Only the anon (publishable) key belongs here, never a service-role or secret key.</p>
      </div>
    </AuthLayout>
  );
}
