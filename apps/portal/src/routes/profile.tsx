import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABEL, changePasswordSchema, updateProfileSchema } from '@kode/contracts';
import { ApiError, api } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../components/icon';
import { InnerBanner } from './shared';

export function ProfilePage() {
  const { user, refresh, signOut } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [profileMessage, setProfileMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setJobTitle(user.jobTitle ?? '');
    setPhone('');
  }, [user]);

  if (!user) return null;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const parsed = updateProfileSchema.safeParse({
      firstName,
      lastName,
      jobTitle: jobTitle || null,
      phone: phone || null,
    });
    if (!parsed.success) {
      setProfileMessage({
        tone: 'error',
        text: parsed.error.issues[0]?.message ?? 'Check the fields above.',
      });
      return;
    }
    try {
      await api.patch('/profile', parsed.data);
      await refresh();
      setProfileMessage({ tone: 'success', text: 'Profile updated.' });
    } catch (error) {
      setProfileMessage({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not save your profile.',
      });
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setPasswordMessage({
        tone: 'error',
        text: parsed.error.issues[0]?.message ?? 'Check the fields above.',
      });
      return;
    }
    try {
      await api.post('/auth/change-password', parsed.data);
      // The API ends every session on a password change, so sign out cleanly
      // rather than leaving the app holding a token the server has revoked.
      setPasswordMessage({ tone: 'success', text: 'Password changed. Signing you back in...' });
      setTimeout(() => void signOut(), 1200);
    } catch (error) {
      setPasswordMessage({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not change your password.',
      });
    }
  }

  return (
    <main className="inner-page">
      <InnerBanner title="My profile" description="Your details, your photo, your password." />

      <div className="support-form">
        <div className="support-layout">
          <div>
            <h2>
              Keep it
              <br />
              <strong>current.</strong>
            </h2>
            <p>
              Your name, job title and phone number are yours to change. Department and role are set
              by a Super Admin.
            </p>
            <dl style={{ marginTop: 28, fontSize: 12, fontWeight: 600, lineHeight: 1.9 }}>
              <div>
                <dt style={{ display: 'inline', opacity: 0.6 }}>Email: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{user.email}</dd>
              </div>
              <br />
              <div>
                <dt style={{ display: 'inline', opacity: 0.6 }}>Role: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{ROLE_LABEL[user.role]}</dd>
              </div>
              <br />
              <div>
                <dt style={{ display: 'inline', opacity: 0.6 }}>Department: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{user.departmentName ?? 'Not set'}</dd>
              </div>
              <br />
              <div>
                <dt style={{ display: 'inline', opacity: 0.6 }}>Sign-in: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>
                  {user.provider === 'ENTRA_ID' ? 'Microsoft' : 'Password'}
                </dd>
              </div>
            </dl>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            <form className="form-panel" onSubmit={saveProfile} noValidate>
              {profileMessage ? (
                <p
                  className="form-alert"
                  data-tone={profileMessage.tone === 'success' ? 'success' : undefined}
                  role="status"
                >
                  {profileMessage.text}
                </p>
              ) : null}
              <label>
                FIRST NAME
                <input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                />
              </label>
              <label>
                LAST NAME
                <input
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                />
              </label>
              <label>
                JOB TITLE
                <input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
              </label>
              <label>
                PHONE
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Extension or mobile"
                />
              </label>
              <button className="ink-button" type="submit">
                SAVE PROFILE <Icon name="arrow" />
              </button>
            </form>

            {user.provider === 'LOCAL' ? (
              <form className="form-panel" onSubmit={changePassword} noValidate>
                {passwordMessage ? (
                  <p
                    className="form-alert"
                    data-tone={passwordMessage.tone === 'success' ? 'success' : undefined}
                    role="status"
                  >
                    {passwordMessage.text}
                  </p>
                ) : null}
                <label>
                  CURRENT PASSWORD
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                  />
                </label>
                <label>
                  NEW PASSWORD
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                  />
                </label>
                <button className="ink-button" type="submit">
                  CHANGE PASSWORD <Icon name="arrow" />
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
