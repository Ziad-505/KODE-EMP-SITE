import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/icon';
import { Pagination } from '../components/pagination';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { usePolicies, usePolicy } from '../lib/queries';
import { InnerBanner, RichText, formatDate } from './shared';

export function PoliciesPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const { data, isLoading, error, refetch } = usePolicies(page, term);

  return (
    <main className="inner-page">
      <InnerBanner
        title="Policies"
        description="General standards and the guidance relevant to your department."
      />

      <div className="filter-bar">
        <p className="result-count" role="status" aria-live="polite">
          {data ? `${data.meta.total} ${data.meta.total === 1 ? 'policy' : 'policies'}` : 'Loading'}
        </p>
        <input
          type="search"
          value={term}
          placeholder="Search policies"
          aria-label="Search policies"
          onChange={(event) => {
            setTerm(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <LoadingRows />
      ) : data && data.items.length ? (
        <>
          <section className="editorial-list">
            {data.items.map((policy, index) => (
              <article key={policy.id} data-reveal="row">
                <Link to={`/policies/${policy.slug}`}>
                  <span className="tnum">
                    {String((page - 1) * 12 + index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <small>
                      {(policy.department?.name ?? 'General').toUpperCase()} · V{policy.version}
                    </small>
                    <h2>{policy.title}</h2>
                    <p>{policy.summary ?? `Updated ${formatDate(policy.updatedAt)}`}</p>
                  </div>
                  <Icon name="arrow" />
                </Link>
              </article>
            ))}
          </section>
          <Pagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="No policies published."
          description="Approved guidance will appear here."
          badge={'NO\nPOLICY'}
        />
      )}
    </main>
  );
}

export function PolicyPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = usePolicy(slug);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingRows count={1} />;

  return (
    <main className="inner-page">
      <article className="article-detail">
        <Link className="back-link" to="/policies">
          <Icon name="arrow" /> ALL POLICIES
        </Link>
        <p className="micro-label">{(data.department?.name ?? 'GENERAL').toUpperCase()}</p>
        <h1>{data.title}</h1>
        <div className="article-meta">
          <span className="tnum">VERSION {data.version}</span>
          {data.effectiveFrom ? (
            <span className="tnum">EFFECTIVE {formatDate(data.effectiveFrom)}</span>
          ) : null}
          <span className="tnum">UPDATED {formatDate(data.updatedAt)}</span>
        </div>
        {data.summary ? (
          <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.6, margin: '24px 0' }}>
            {data.summary}
          </p>
        ) : null}
        <RichText text={data.body} />
        {data.documentUrl ? (
          <a className="doc-download" href={data.documentUrl} download>
            <Icon name="download" /> DOWNLOAD THE REFERENCE DOCUMENT
          </a>
        ) : null}
      </article>
    </main>
  );
}
