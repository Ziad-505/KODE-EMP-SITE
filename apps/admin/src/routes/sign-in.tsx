import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Permission, loginSchema } from '@kode/contracts';
import kMark from '../assets/kode-k-mark.png';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../components/icon';
import { Field } from '../components/ui';

export function CmsSignInPage() {
  const { status, signIn, providers, can } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(params.get('error'));
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    // A signed-in employee without CMS access gets a clear message rather than
    // an empty shell they cannot use.
    return can(Permission.CMS_ACCESS) ? <Navigate to="/" replace /> : <NoCmsAccess />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await signIn(parsed.data);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cms-auth">
      <div className="cms-auth-card">
        <div className="cms-lockup">
          <img src={kMark} alt="" width={31} height={34} />
          <div>
            <b>KODE CMS</b>
            <span>SPORTS CLUB</span>
          </div>
        </div>

        <h1>Content operations.</h1>
        <p>Sign in with your KODE account. Access is granted per role by a Super Admin.</p>

        {formError ? (
          <p className="cms-alert" role="alert" style={{ marginBottom: 16 }}>
            {formError}
          </p>
        ) : null}

        <form className="cms-form" onSubmit={onSubmit} noValidate>
          <Field label="WORK EMAIL" error={errors.email}>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@kodesportsclub.com"
              required
            />
          </Field>

          <Field label="PASSWORD" error={errors.password}>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <button
            className="create-button"
            type="submit"
            disabled={submitting}
            style={{ minHeight: 44 }}
          >
            {submitting ? 'SIGNING IN...' : 'SIGN IN'} <Icon name="arrow" />
          </button>
        </form>

        {providers.entra ? (
          <a
            className="secondary-button"
            href="/api/v1/auth/entra/start"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              minHeight: 44,
              marginTop: 12,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            CONTINUE WITH MICROSOFT
          </a>
        ) : null}
      </div>
    </div>
  );
}

function NoCmsAccess() {
  const { user, signOut } = useAuth();
  return (
    <div className="cms-auth">
      <div className="cms-auth-card">
        <h1>No CMS access.</h1>
        <p>
          {user?.displayName}, your account is active on the employee portal but does not include
          content administration. Ask a Super Admin if you need it.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            className="create-button"
            href={import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:5173'}
            style={{ textDecoration: 'none' }}
          >
            <Icon name="external" size={14} /> OPEN THE PORTAL
          </a>
          <button className="secondary-button" type="button" onClick={() => void signOut()}>
            SIGN OUT
          </button>
        </div>
      </div>
    </div>
  );
}
