import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-client';
import { Icon } from './icon';

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="editorial-list" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton skeleton-row" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  badge = 'NOTHING\nHERE\nYET',
  action,
}: {
  title: string;
  description: string;
  badge?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      <span>
        {badge.split('\n').map((line) => (
          <span
            key={line}
            style={{
              display: 'block',
              background: 'none',
              width: 'auto',
              height: 'auto',
              margin: 0,
              transform: 'none',
            }}
          >
            {line}
          </span>
        ))}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const isApi = error instanceof ApiError;
  const message = isApi ? error.message : 'Something went wrong loading this page.';
  return (
    <div className="state-block" role="alert">
      <span>
        <span
          style={{
            display: 'block',
            background: 'none',
            width: 'auto',
            height: 'auto',
            margin: 0,
            transform: 'none',
          }}
        >
          {isApi && error.isForbidden ? 'NO\nACCESS' : 'WENT\nWRONG'}
        </span>
      </span>
      <h2>{isApi && error.isForbidden ? 'Not for you, yet.' : 'That did not load.'}</h2>
      <p>{message}</p>
      {isApi && error.requestId ? (
        <p className="tnum" style={{ fontSize: 11, opacity: 0.7 }}>
          Reference {error.requestId}
        </p>
      ) : null}
      {onRetry ? (
        <button className="ink-button" onClick={onRetry} type="button">
          TRY AGAIN <Icon name="arrow" />
        </button>
      ) : null}
    </div>
  );
}
