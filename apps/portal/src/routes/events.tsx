import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/icon';
import { Pagination } from '../components/pagination';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { useEvent, useEvents } from '../lib/queries';
import { InnerBanner, RichText, formatDateTime } from './shared';

export function EventsPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const { data, isLoading, error, refetch } = useEvents(page, term);

  return (
    <main className="inner-page">
      <InnerBanner title="Events" description="Make room for the moments that pull us together." />

      <div className="filter-bar">
        <p className="result-count" role="status" aria-live="polite">
          {data ? `${data.meta.total} ${data.meta.total === 1 ? 'event' : 'events'}` : 'Loading'}
        </p>
        <input
          type="search"
          value={term}
          placeholder="Search events"
          aria-label="Search events"
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
            {data.items.map((event) => {
              const date = new Date(event.startsAt);
              return (
                <article key={event.id} data-reveal="date">
                  <Link to={`/events/${event.slug}`}>
                    <span className="tnum">{String(date.getDate()).padStart(2, '0')}</span>
                    <div>
                      <small>
                        {event.kind.label.toUpperCase()} ·{' '}
                        {date.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase()}
                      </small>
                      <h2>{event.title}</h2>
                      <p>
                        {event.location} ·{' '}
                        {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <Icon name="arrow" />
                  </Link>
                </article>
              );
            })}
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
          title="Nothing scheduled."
          description="The next club moment will appear here."
          badge={'NO\nEVENTS'}
        />
      )}
    </main>
  );
}

export function EventPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useEvent(slug);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingRows count={1} />;

  return (
    <main className="inner-page">
      <article className="article-detail">
        <Link className="back-link" to="/events">
          <Icon name="arrow" /> ALL EVENTS
        </Link>
        <p className="micro-label">{data.kind.label.toUpperCase()}</p>
        <h1>{data.title}</h1>
        <div className="article-meta">
          <span className="tnum">{formatDateTime(data.startsAt)}</span>
          <span>{data.location}</span>
          {data.capacity ? <span className="tnum">{data.capacity} PLACES</span> : null}
        </div>
        {data.coverUrl ? <img className="article-cover" src={data.coverUrl} alt="" /> : null}
        <RichText text={data.description} />
      </article>
    </main>
  );
}
