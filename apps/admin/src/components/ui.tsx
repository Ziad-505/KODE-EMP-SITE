import type { ReactNode } from 'react';
import { CONTENT_STATUS_LABEL, type ContentStatus } from '@kode/contracts';
import { ApiError } from '../lib/api-client';
import { Icon, type IconName } from './icon';

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="admin-section-label">
      <p>
        <i />
        {children}
      </p>
      {action}
    </div>
  );
}

export function StatusChip({ status }: { status: ContentStatus }) {
  return <em className={status.toLowerCase()}>{CONTENT_STATUS_LABEL[status]}</em>;
}

export function CmsState({
  icon = 'search',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="cms-state">
      <span>
        <Icon name={icon} />
      </span>
      <b>{title}</b>
      <p>{description}</p>
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function CmsError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong loading this view.';
  const forbidden = error instanceof ApiError && error.isForbidden;
  return (
    <div className="cms-state" role="alert">
      <span>
        <Icon name={forbidden ? 'lock' : 'close'} />
      </span>
      <b>{forbidden ? 'You do not have access to this' : 'That did not load'}</b>
      <p>{message}</p>
      {onRetry ? (
        <div style={{ marginTop: 16 }}>
          <button className="create-button" onClick={onRetry} type="button">
            <Icon name="arrow" /> TRY AGAIN
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="cms-skeleton" key={index} />
      ))}
    </div>
  );
}

export function CmsPagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="cms-pagination" aria-label="Pagination">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        PREVIOUS
      </button>
      <span className="tnum">
        PAGE {page} / {totalPages} · {total} ITEMS
      </span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        NEXT
      </button>
    </nav>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="cms-field" data-invalid={Boolean(error)}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <span className="cms-field-error">{error}</span> : null}
    </label>
  );
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
