import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/icon';
import { Pagination } from '../components/pagination';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { useArticle, useNews } from '../lib/queries';
import { InnerBanner, RichText, formatDate } from './shared';

export function NewsPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const { data, isLoading, error, refetch } = useNews(page, term);

  return (
    <main className="inner-page">
      <InnerBanner
        title="Club news"
        description="Every signal, story and update from inside KODE."
      />

      <div className="filter-bar">
        <p className="result-count" role="status" aria-live="polite">
          {data ? `${data.meta.total} ${data.meta.total === 1 ? 'story' : 'stories'}` : 'Loading'}
        </p>
        <input
          type="search"
          value={term}
          placeholder="Search news"
          aria-label="Search news"
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
            {data.items.map((item, index) => (
              <article key={item.id} data-reveal="row">
                <Link to={`/news/${item.slug}`}>
                  <span className="tnum">
                    {String((page - 1) * 12 + index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <small>{item.category.label.toUpperCase()}</small>
                    <h2>{item.title}</h2>
                    <p>{item.excerpt ?? formatDate(item.publishedAt ?? item.createdAt)}</p>
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
          title="No stories yet."
          description={
            term
              ? 'Nothing matches that search. Try a shorter term.'
              : 'Marketing has not published anything here yet.'
          }
          badge={'NO\nNEWS'}
        />
      )}
    </main>
  );
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useArticle(slug);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingRows count={1} />;

  return (
    <main className="inner-page">
      <article className="article-detail">
        <Link className="back-link" to="/news">
          <Icon name="arrow" /> ALL CLUB NEWS
        </Link>
        <p className="micro-label">{data.category.label.toUpperCase()}</p>
        <h1>{data.title}</h1>
        <div className="article-meta">
          <span className="tnum">{formatDate(data.publishedAt ?? data.createdAt)}</span>
          {data.author ? <span>{data.author.displayName}</span> : null}
          {data.department ? (
            <span style={{ color: data.department.colour }}>{data.department.name}</span>
          ) : null}
        </div>
        {data.coverUrl ? <img className="article-cover" src={data.coverUrl} alt="" /> : null}
        <RichText text={data.body} />
      </article>
    </main>
  );
}
