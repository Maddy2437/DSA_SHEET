import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout, Field, FormAlert, SubmitButton } from '../../components/AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import { validateEmail } from '../../utils/auth';

export default function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const invalid = validateEmail(email);
    setError(invalid);
    setFormError(null);
    if (invalid) return;

    setBusy(true);
    const result = await auth.resetPassword(email);
    setBusy(false);
    if (!result.ok) return setFormError(result.message);
    setSentTo(email.trim());
  };

  const back = <Link to="/login" className="font-medium text-accent hover:underline">Back to log in</Link>;

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={back}>
        <FormAlert tone="success">
          If an account exists for <strong className="break-all">{sentTo}</strong>, we have sent a link to reset the password.
        </FormAlert>
        <p className="mt-3 text-xs text-muted">
          Open the link in this same browser. It expires after a while, and you can request another one at any time.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot password" subtitle="Enter your email and we will send you a link to choose a new password." footer={back}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <Field label="Email" type="email" value={email} onChange={setEmail} error={error} autoComplete="email" disabled={busy} placeholder="you@example.com" />
        <SubmitButton busy={busy} busyText="Sending…">Send reset link</SubmitButton>
      </form>
    </AuthLayout>
  );
}
