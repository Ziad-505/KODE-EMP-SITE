import { useEffect, useState, type FormEvent } from 'react';
import { totpCodeSchema, type TotpEnrolmentDto, type TotpStatusDto } from '@kode/contracts';
import { ApiError, api } from '../lib/api-client';
import { Icon } from '../components/icon';
import { CmsError, Field, SectionLabel, TableSkeleton } from '../components/ui';

/**
 * Managing your own second factor.
 *
 * Deliberately a page about *your* account rather than an admin screen: nobody,
 * including a Super Admin, can enrol or disable a factor on someone else's
 * behalf. That would reintroduce exactly the single-credential takeover the
 * factor exists to prevent.
 */
export function SecurityPage() {
  const [status, setStatus] = useState<TotpStatusDto | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [enrolment, setEnrolment] = useState<TotpEnrolmentDto | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);

  async function load() {
    try {
      setStatus(await api.get<TotpStatusDto>('/auth/2fa'));
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      setEnrolment(await api.post<TotpEnrolmentDto>('/auth/2fa/setup'));
      setCodesAcknowledged(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!totpCodeSchema.safeParse(code).success) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      await api.post<void>('/auth/2fa/confirm', { code });
      setEnrolment(null);
      setCode('');
      setSaved('Two-factor authentication is on. You will be asked for a code next time.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post<void>('/auth/2fa/disable', { password });
      setPassword('');
      setSaved('Two-factor authentication is off.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not turn it off.');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <CmsError error={loadError} onRetry={() => void load()} />;
  if (!status) return <TableSkeleton rows={3} />;

  return (
    <div className="security-page">
      <header className="module-intro">
        <div>
          <p className="eyebrow-admin">SETTINGS / YOUR SIGN-IN</p>
          <h2>One password is not enough.</h2>
          <p>
            A password can be guessed, phished or reused. A second factor means one on its own is
            not enough to publish content or change what someone can do.
          </p>
        </div>
      </header>

      {saved ? (
        <p className="cms-alert" data-tone="success" role="status">
          {saved}
        </p>
      ) : null}
      {error ? (
        <p className="cms-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="security-card" style={{ marginTop: 18 }}>
        <div className="security-status">
          <span className="security-flag" data-on={status.enrolled}>
            {status.enrolled ? 'ON' : 'OFF'}
          </span>
          <div>
            <b>Two-factor authentication</b>
            <small>
              {status.enrolled
                ? `${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? '' : 's'} left`
                : status.required
                  ? 'Required for your role. Set it up now.'
                  : 'Not required for your role, but recommended.'}
            </small>
          </div>
        </div>

        {status.enrolled && status.recoveryCodesRemaining <= 2 ? (
          <p className="cms-alert" role="alert" style={{ marginTop: 14 }}>
            You are nearly out of recovery codes. Turn the factor off and set it up again to get a
            fresh set — otherwise a lost phone means asking IT to reset your account.
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------ setting it up */}
      {!status.enrolled && !enrolment ? (
        <div className="security-card" style={{ marginTop: 14 }}>
          <p>
            You will need an authenticator app — Microsoft Authenticator, Google Authenticator,
            1Password or similar. Setting up takes about a minute.
          </p>
          <button
            className="create-button"
            type="button"
            onClick={() => void begin()}
            disabled={busy}
          >
            {busy ? 'PREPARING...' : 'SET UP'} <Icon name="arrow" />
          </button>
        </div>
      ) : null}

      {enrolment ? (
        <div className="security-card" style={{ marginTop: 14 }}>
          <h3 className="security-step">1. Save your recovery codes</h3>
          <p>
            These are shown <strong>once</strong> and are the only way back into your account if you
            lose your phone. Print them or put them in a password manager — not in this browser.
          </p>
          <ul className="recovery-codes">
            {enrolment.recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode} className="tnum">
                {recoveryCode}
              </li>
            ))}
          </ul>
          <label className="security-check">
            <input
              type="checkbox"
              checked={codesAcknowledged}
              onChange={(event) => setCodesAcknowledged(event.target.checked)}
            />
            I have saved these somewhere safe
          </label>

          <h3 className="security-step" style={{ marginTop: 22 }}>
            2. Add the account to your app
          </h3>
          <p>Scan this, or type the key in by hand if your app cannot scan.</p>
          <div className="totp-enrol">
            {/* A data URI produced by the API. The secret never leaves this
                deployment, and nothing external is contacted to draw it. */}
            <img
              src={enrolment.qrDataUri}
              alt="QR code for your authenticator app"
              width={180}
              height={180}
            />
            <div>
              <SectionLabel>SETUP KEY</SectionLabel>
              <code className="totp-secret">{enrolment.secret}</code>
              <small>
                If the QR code does not appear, add the account manually using this key.
              </small>
            </div>
          </div>

          <h3 className="security-step" style={{ marginTop: 22 }}>
            3. Confirm it works
          </h3>
          <form className="cms-form" onSubmit={confirm} noValidate>
            <Field label="CODE FROM YOUR APP" hint="Six digits. It changes every 30 seconds.">
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="000000"
              />
            </Field>
            <button
              className="create-button"
              type="submit"
              /* Both gates are real: an unconfirmed code leaves the factor off,
                 and unsaved recovery codes leave someone one lost phone away
                 from a support ticket. */
              disabled={busy || !codesAcknowledged || code.trim().length !== 6}
            >
              {busy ? 'CHECKING...' : 'TURN ON'} <Icon name="arrow" />
            </button>
          </form>
        </div>
      ) : null}

      {/* ------------------------------------------------ turning it off */}
      {status.enrolled ? (
        <div className="security-card" style={{ marginTop: 14 }}>
          <h3 className="security-step">Turn it off</h3>
          <p>
            {status.required
              ? 'Your role requires a second factor, so turning it off will leave your account below the standard set for CMS access.'
              : 'You can turn this off at any time.'}
          </p>
          <form className="cms-form" onSubmit={disable} noValidate>
            <Field label="CONFIRM YOUR PASSWORD">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <button
              className="secondary-button danger"
              type="submit"
              disabled={busy || password.length === 0}
            >
              {busy ? 'WORKING...' : 'TURN OFF'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
