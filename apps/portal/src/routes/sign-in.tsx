import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { loginSchema } from '@kode/contracts';
import kMark from '../assets/kode-k-mark.png';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../components/icon';

export function SignInPage() {
  const { status, signIn, providers } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(params.get('error'));
  const [submitting, setSubmitting] = useState(false);

  /**
   * Sign-in used to cut straight to the portal the instant the session came
   * back, which read as a page flash rather than as entering somewhere. A short
   * handoff covers the swap: the panel drops out, a full-bleed curtain closes,
   * and only then does the redirect run. `signedInHere` distinguishes a session
   * created by this form from one that already existed when the route mounted,
   * so arriving at /sign-in while authenticated still redirects immediately.
   */
  const signedInHere = useRef(false);
  const [handoff, setHandoff] = useState(false);
  const [released, setReleased] = useState(false);

  useEffect(() => {
    if (!handoff) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReleased(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setReleased(true), 620);
    return () => window.clearTimeout(timer);
  }, [handoff]);

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'authenticated' && (!signedInHere.current || released)) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    // The same schema the API validates against, so the messages match.
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
      signedInHere.current = true;
      await signIn(parsed.data);
      setHandoff(true);
    } catch (error) {
      signedInHere.current = false;
      setFormError(error instanceof ApiError ? error.message : 'Sign-in failed. Please try again.');
      setSubmitting(false);
    }
  }

  const entraUrl = `/api/v1/auth/entra/start?redirectTo=${encodeURIComponent(window.location.origin + from)}`;

  return (
    <div className="auth-screen" data-handoff={handoff}>
      {handoff ? (
        <div className="auth-curtain" aria-hidden="true">
          <img src={kMark} alt="" />
          <span>OPENING THE CLUB</span>
        </div>
      ) : null}
      <aside className="auth-poster">
        <div className="auth-lockup">
          <img src={kMark} alt="" />
          <span>
            KODE
            <b>PORTAL</b>
          </span>
        </div>
        <div>
          <h1>
            THE CLUB,
            <br />
            <em>FROM THE</em>
            <br />
            INSIDE.
          </h1>
          <p>News, events, policies, people and the IT helpdesk. One place, one sign-in.</p>
        </div>
        <div className="auth-rhythm" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-card">
          <p className="micro-label">WELCOME BACK</p>
          <h2>Sign in.</h2>
          <p>Use your KODE account. If you sign in to Outlook with Microsoft, use that button.</p>

          {formError ? (
            <p className="form-alert" role="alert">
              {formError}
            </p>
          ) : null}

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <label className="field" data-invalid={Boolean(errors.email)}>
              <span>WORK EMAIL</span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@kodesportsclub.com"
                aria-invalid={Boolean(errors.email)}
                required
              />
              {errors.email ? <span className="field-error">{errors.email}</span> : null}
            </label>

            <label className="field" data-invalid={Boolean(errors.password)}>
              <span>PASSWORD</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(errors.password)}
                required
              />
              {errors.password ? <span className="field-error">{errors.password}</span> : null}
            </label>

            <button className="ink-button" type="submit" disabled={submitting}>
              {submitting ? 'SIGNING IN...' : 'SIGN IN'} <Icon name="arrow" />
            </button>
          </form>

          {providers.entra ? (
            <>
              <div className="auth-divider">OR</div>
              <a className="entra-button" href={entraUrl}>
                <span className="entra-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                CONTINUE WITH MICROSOFT
              </a>
            </>
          ) : null}

          <p className="auth-hint">
            Trouble signing in? Contact KODE IT and they will reset your access. Repeated failed
            attempts lock the account for a short period.
          </p>
        </div>
      </main>
    </div>
  );
}
