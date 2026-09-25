import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout, Field, FormAlert, SubmitButton } from '../../components/AuthLayout';
import { useAuth } from '../../hooks/useAuth';
import { PASSWORD_HINT, validateConfirm, validateEmail, validateName, validateNewPassword } from '../../utils/auth';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'confirm', string>>;

export default function Register() {
  const auth = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next: Errors = {
      name: validateName(name) ?? undefined,
      email: validateEmail(email) ?? undefined,
      password: validateNewPassword(password) ?? undefined,
      confirm: validateConfirm(password, confirm) ?? undefined,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    const result = await auth.signUp({ name, email, password });
    setBusy(false);
    if (!result.ok) return setFormError(result.message);
    // With email confirmation on there is no session yet: ask them to confirm. With it off they are already signed in
    // and the router takes them into the app.
    if (result.needsConfirmation) setConfirmEmailFor(email.trim());
  };

  if (confirmEmailFor) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login" className="font-medium text-accent hover:underline">Back to log in</Link>}>
        <FormAlert tone="success">
          Your account has been created. We sent a confirmation link to <strong className="break-all">{confirmEmailFor}</strong>. Open it in this
          browser, then log in.
        </FormAlert>
        <p className="mt-3 text-xs text-muted">Nothing there? Check your spam folder.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Set up your own login for the DSA sheet."
      footer={
        <>
          Already have an account? <Link to="/login" className="font-medium text-accent hover:underline">Log in</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <FormAlert tone="error">{formError}</FormAlert>}
        <Field label="Name" value={name} onChange={setName} error={errors.name} autoComplete="name" disabled={busy} />
        <Field label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" disabled={busy} placeholder="you@example.com" />
        <Field label="Password" type="password" value={password} onChange={setPassword} error={errors.password} hint={PASSWORD_HINT} autoComplete="new-password" disabled={busy} />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" disabled={busy} />
        <SubmitButton busy={busy} busyText="Creating account…">Create account</SubmitButton>
      </form>
    </AuthLayout>
  );
}
