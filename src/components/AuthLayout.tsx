import { CircleCheck, Eye, EyeOff, ListChecks, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

// Shared pieces of the authentication pages, in the same visual language as the rest of the app.

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-fg">
            <ListChecks aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Madhav's DSA</span>
        </div>
        <main className="rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </main>
        {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60';

interface FieldProps {
  label: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  autoComplete?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function Field({ label, type = 'text', value, onChange, error, hint, autoComplete, disabled, placeholder }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && shown ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputCls} ${isPassword ? 'pr-10' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted hover:text-fg"
          >
            {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        )}
      </div>
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
}

export function FormAlert({ tone, children, onDismiss }: { tone: 'error' | 'success' | 'info'; children: ReactNode; onDismiss?: () => void }) {
  const cls =
    tone === 'error'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300'
      : tone === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${cls}`}>
      {tone === 'success' ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-xs underline">Dismiss</button>
      )}
    </div>
  );
}

export function SubmitButton({ busy, children, busyText }: { busy: boolean; children: ReactNode; busyText: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {busy ? busyText : children}
    </button>
  );
}

export function SessionLoading() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-screen place-items-center">
      <div className="flex items-center gap-3 text-sm text-muted">
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
        Checking your session…
      </div>
    </div>
  );
}
