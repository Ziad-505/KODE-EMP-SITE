import { useState } from 'react';
import { AuditAction } from '@kode/contracts';
import { useAudit } from '../lib/cms-api';
import { CmsError, CmsPagination, CmsState, TableSkeleton, formatDateTime } from '../components/ui';

const ACTIONS = ['All', ...Object.values(AuditAction)] as const;

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<(typeof ACTIONS)[number]>('All');
  const list = useAudit({ page, pageSize: 30, ...(action !== 'All' ? { action } : {}) });

  return (
    <>
      <div className="module-intro">
        <div>
          <p className="eyebrow-admin">SUPER ADMIN CONTROL</p>
          <h2>Every change, on the record.</h2>
          <p>
            Append-only. The application exposes no way to edit or delete an entry, and the database
            rejects UPDATE and DELETE on this table with a trigger, so a compromised API process
            cannot rewrite history either.
          </p>
        </div>
      </div>

      <div className="module-toolbar">
        <div style={{ flexWrap: 'wrap' }}>
          {ACTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={action === value ? 'active' : ''}
              onClick={() => {
                setAction(value);
                setPage(1);
              }}
            >
              {value === 'All' ? 'All' : value.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {list.error ? (
        <CmsError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <TableSkeleton rows={6} />
      ) : list.data && list.data.items.length ? (
        <>
          <div>
            {list.data.items.map((entry) => (
              <article className="audit-row" key={entry.id}>
                <span className="audit-action" data-action={entry.action}>
                  {entry.action.replace(/_/g, ' ')}
                </span>
                <div>
                  <b>{entry.summary}</b>
                  <div className="audit-actor">
                    {entry.actor
                      ? `${entry.actor.displayName} (${entry.actor.email})`
                      : 'System or anonymous'}
                    {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                  </div>
                  {entry.changes ? (
                    <div className="audit-changes">
                      {Object.entries(entry.changes).map(([field, change]) => (
                        <div key={field}>
                          <strong>{field}</strong>: {format(change.from)} → {format(change.to)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <time className="tnum" dateTime={entry.createdAt}>
                  {formatDateTime(entry.createdAt)}
                </time>
              </article>
            ))}
          </div>

          <CmsPagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : (
        <CmsState
          icon="history"
          title="No activity recorded"
          description="Entries appear here as people sign in and change content."
        />
      )}
    </>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return 'empty';
  if (typeof value === 'string' && value.length > 60) return `${value.slice(0, 60)}...`;
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  return String(value);
}
