import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthLayout, Field, FormAlert, SubmitButton } from '../../components/AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import { PASSWORD_HINT, validateConfirm, validateNewPassword } from '../../utils/auth';

// Reached through the link in the password-reset email. Opening that link signs the person in with a short-lived
// "recovery" session, and until they choose a new password the app is closed to them (see AuthGate).
export default function ResetPassword() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next = { password: validateNewPassword(password) ?? undefined, confirm: validateConfirm(password, confirm) ?? undefined };
    setErrors(next);
    setFormError(null);
    if (next.password || next.confirm) return;

    setBusy(true);
    const result = await auth.updatePassword(password);
    setBusy(false);
    if (!result.ok) return setFormError(result.message);
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <FormAlert tone="success">Your password has been changed and you are logged in.</FormAlert>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          Continue to the app
        </button>
      </AuthLayout>
    );
  }

  if (!auth.recovery) {
    // Signed in normally: there is nothing to reset here.
    if (auth.user) return <Navigate to="/" replace />;
    return (
      <AuthLayout
        title="Reset link not valid"
        footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to log in</Link>}
      >
        <FormAlert tone="error">This reset link is invalid or has expired.</FormAlert>
        <Link to="/forgot-password" className="mt-4 block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-fg hover:opacity-90">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  const cancel = async () => {
    await auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Pick a new password for your account."
      footer={<button type="button" onClick={cancel} className="font-medium text-accent hover:underline">Cancel and log out</button>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <Field label="New password" type="password" value={password} onChange={setPassword} error={errors.password} hint={PASSWORD_HINT} autoComplete="new-password" disabled={busy} />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" disabled={busy} />
        <SubmitButton busy={busy} busyText="Saving…">Update password</SubmitButton>
      </form>
    </AuthLayout>
  );
}
