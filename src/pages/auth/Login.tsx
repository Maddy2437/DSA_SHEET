import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout, Field, FormAlert, SubmitButton } from '../../components/AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import { validateEmail } from '../../utils/auth';

export default function Login() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next = { email: validateEmail(email) ?? undefined, password: password ? undefined : 'Enter your password.' };
    setErrors(next);
    setFormError(null);
    if (next.email || next.password) return;

    setBusy(true);
    const result = await auth.signIn(email, password);
    setBusy(false);
    // On success nothing else is needed here: the auth state changes and the router sends the user into the app.
    if (!result.ok) setFormError(result.message);
  };

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back. Log in to open your DSA sheet."
      footer={
        <>
          New here? <Link to="/register" className="font-medium text-accent hover:underline">Create account</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {auth.linkError && <FormAlert tone="error" onDismiss={auth.clearLinkError}>{auth.linkError}</FormAlert>}
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <Field label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" disabled={busy} placeholder="you@example.com" />
        <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" disabled={busy} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted hover:text-fg hover:underline">Forgot password?</Link>
        </div>
        <SubmitButton busy={busy} busyText="Logging in…">Log in</SubmitButton>
      </form>
    </AuthLayout>
  );
}
