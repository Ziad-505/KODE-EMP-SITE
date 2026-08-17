import { Link } from 'react-router-dom';
import { CONTENT_STATUS_LABEL } from '@kode/contracts';
import { useAuth } from '../lib/auth-context';
import { useDashboard } from '../lib/cms-api';
import { Icon } from '../components/icon';
import { CmsError, SectionLabel, TableSkeleton, formatDateTime } from '../components/ui';

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useDashboard();

  if (error) return <CmsError error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <TableSkeleton rows={6} />;

  const attention = data.counts.inReview + data.needsAttention.length;

  return (
    <>
      <section className="dashboard-opening">
        <div>
          <p className="eyebrow-admin">WELCOME BACK, {user?.firstName.toUpperCase()}</p>
          <h2>
            The club has
            <br />
            <strong>something to say.</strong>
          </h2>
          <p>
            Publish the useful, celebrate the great, and keep everyone connected to what matters
            inside KODE.
          </p>
          <Link className="create-button" to="/content/news" style={{ textDecoration: 'none' }}>
            <Icon name="arrow" />
            MANAGE NEWS
          </Link>
        </div>

        <div className="signal-board">
          <span className="signal-tag">CONTENT SIGNAL</span>
          <b className="tnum">{String(attention).padStart(2, '0')}</b>
          <p>{attention === 1 ? 'piece needs your attention' : 'pieces need your attention'}</p>
          <div className="signal-lines" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <i
                style={
                  {
                    '--h': `${22 + ((index * 17) % 64)}%`,
                    '--d': `${index * 70}ms`,
                  } as React.CSSProperties
                }
                key={index}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="metric-layout">
        <div className="metric-stack">
          <SectionLabel>RIGHT NOW</SectionLabel>
          <div className="metrics">
            <article>
              <span>LIVE</span>
              <b className="tnum">{data.counts.published}</b>
              <p>Published items</p>
            </article>
            <article>
              <span>READY</span>
              <b className="tnum">{data.counts.inReview}</b>
              <p>Awaiting review</p>
            </article>
            <article>
              <span>DRAFTS</span>
              <b className="tnum">{data.counts.drafts}</b>
              <p>In progress</p>
            </article>
          </div>
        </div>

        <div className="attention-panel">
          <SectionLabel
            action={
              <Link to="/content/news" style={{ textDecoration: 'none' }}>
                VIEW ALL <Icon name="arrow" />
              </Link>
            }
          >
            NEEDS ATTENTION
          </SectionLabel>

          {data.needsAttention.length === 0 ? (
            <p
              style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, padding: '14px 0 0' }}
            >
              Nothing is waiting on you. Good place to be.
            </p>
          ) : (
            data.needsAttention.map((item) => (
              <Link
                key={`${item.type}-${item.id}`}
                to={`/content/${item.type === 'news' ? 'news' : item.type === 'policy' ? 'policies' : item.type}/${item.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span
                  className={`attention-dot ${item.reason.includes('overdue') ? 'pink' : ''}`}
                />
                <div>
                  <b>{item.title}</b>
                  <p>{item.reason}</p>
                </div>
                <em>{CONTENT_STATUS_LABEL[item.status].toUpperCase()}</em>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="dashboard-lower">
        <div className="publishing-rhythm">
          <SectionLabel>YOUR PUBLISHING RHYTHM</SectionLabel>
          <div className="rhythm-grid">
            {data.publishingRhythm.map((day, index) => (
              <div
                key={day.date}
                className={day.count > 0 ? 'live' : ''}
                style={{
                  height: 84,
                  border: '1px solid var(--line)',
                  background: day.count > 0 ? 'var(--blue)' : 'var(--bg)',
                  color: day.count > 0 ? '#fff' : undefined,
                  padding: 9,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <small
                  style={{
                    fontSize: 8,
                    fontWeight: 800,
                    color: day.count > 0 ? 'var(--lime)' : 'var(--muted)',
                  }}
                >
                  {DAY_LABELS[index]}
                </small>
                <span className="tnum" style={{ margin: 'auto', fontSize: 21, fontWeight: 800 }}>
                  {day.count || ''}
                </span>
              </div>
            ))}
          </div>
          <p>
            {data.publishingRhythm.reduce((sum, day) => sum + day.count, 0)} item(s) published this
            week across the club.
          </p>
        </div>

        <div className="quick-actions">
          <SectionLabel>RECENT ACTIVITY</SectionLabel>
          {data.recentActivity.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>
              No activity recorded yet.
            </p>
          ) : (
            data.recentActivity.map((entry) => (
              <div key={entry.id} style={{ borderTop: '1px solid var(--line)', padding: '11px 0' }}>
                <b style={{ fontSize: 11, display: 'block', lineHeight: 1.45 }}>{entry.summary}</b>
                <small style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>
                  {entry.actorName ?? 'System'} · {formatDateTime(entry.createdAt)}
                </small>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
