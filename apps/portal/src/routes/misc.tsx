import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/icon';
import { Pagination } from '../components/pagination';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { useAlbum, useDirectory, useFaqs, useGallery, useLinks } from '../lib/queries';
import { InnerBanner, initialsOf } from './shared';

/* ---------------------------------------------------------------------- FAQs */

export function FaqsPage() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useFaqs(term);

  return (
    <main className="inner-page">
      <InnerBanner title="FAQs" description="The answers that keep the day moving." />

      <div className="filter-bar">
        <p className="result-count" role="status" aria-live="polite">
          {data
            ? `${data.items.length} ${data.items.length === 1 ? 'question' : 'questions'}`
            : 'Loading'}
        </p>
        <input
          type="search"
          value={term}
          placeholder="Search questions"
          aria-label="Search questions"
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <LoadingRows />
      ) : data && data.items.length ? (
        <section className="editorial-list">
          {data.items.map((faq, index) => (
            // Keyed by id, not index: the open row must survive filtering.
            <article
              key={faq.id}
              id={faq.id}
              data-reveal="row"
              className={open === faq.id ? 'open' : ''}
            >
              <button
                type="button"
                onClick={() => setOpen(open === faq.id ? null : faq.id)}
                aria-expanded={open === faq.id}
                aria-controls={`faq-${faq.id}`}
              >
                <span className="tnum">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <small>{faq.category.toUpperCase()}</small>
                  <h2>{faq.question}</h2>
                </div>
                <Icon name={open === faq.id ? 'close' : 'plus'} />
              </button>
              {open === faq.id ? (
                <div className="row-drawer" id={`faq-${faq.id}`}>
                  <p>{faq.answer}</p>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="No answers yet."
          description="Questions and answers will appear here."
          badge={'NO\nFAQS'}
        />
      )}
    </main>
  );
}

/* ----------------------------------------------------------------- directory */

export function DirectoryPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const { data, isLoading, error, refetch } = useDirectory(page, term);

  return (
    <main className="inner-page">
      <InnerBanner title="People" description="Meet the people who keep KODE moving." />

      <div className="filter-bar">
        <p className="result-count" role="status" aria-live="polite">
          {data ? `${data.meta.total} ${data.meta.total === 1 ? 'person' : 'people'}` : 'Loading'}
        </p>
        <input
          type="search"
          value={term}
          placeholder="Search by name, role or team"
          aria-label="Search the directory"
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
          <div className="people-grid">
            {data.items.map((person) => (
              <article
                className="person-card"
                data-reveal="tile"
                key={person.id}
                style={{ '--dept': person.department?.colour ?? '#244EA2' } as React.CSSProperties}
              >
                {person.avatarUrl ? (
                  <img
                    className="person-avatar"
                    src={person.avatarUrl}
                    alt=""
                    width={52}
                    height={52}
                  />
                ) : (
                  <span className="person-avatar" aria-hidden="true">
                    {initialsOf(person.displayName)}
                  </span>
                )}
                <div>
                  <b>{person.displayName}</b>
                  <br />
                  <small>{person.jobTitle ?? 'KODE Sports Club'}</small>
                </div>
                {person.department ? (
                  <span className="person-dept">{person.department.name.toUpperCase()}</span>
                ) : null}
                <a href={`mailto:${person.email}`}>{person.email}</a>
                {person.phone ? <a href={`tel:${person.phone}`}>{person.phone}</a> : null}
              </article>
            ))}
          </div>
          <Pagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="Nobody found."
          description="Try a different name or team."
          badge={'NO\nPEOPLE'}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------- gallery */

export function GalleryPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGallery(page);

  return (
    <main className="inner-page">
      <InnerBanner
        title="Gallery"
        description="A club has a rhythm. These are some of its frames."
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <LoadingRows />
      ) : data && data.items.length ? (
        <>
          <div className="album-grid">
            {data.items.map((album) => (
              <Link
                className="album-card"
                data-reveal="tile"
                key={album.id}
                to={`/gallery/${album.slug}`}
              >
                {album.coverUrl ? <img src={album.coverUrl} alt="" /> : null}
                <span className="tnum">{album.itemCount} PHOTOS</span>
                <b>{album.title}</b>
              </Link>
            ))}
          </div>
          <Pagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="No albums yet."
          description="Club moments will be collected here."
          badge={'NO\nPHOTOS'}
        />
      )}
    </main>
  );
}

export function AlbumPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useAlbum(slug);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingRows count={1} />;

  return (
    <main className="inner-page">
      <InnerBanner
        title={data.title}
        description={data.description ?? `${data.itemCount} frames from the club.`}
      />
      <div className="album-photos">
        {data.items.map((item) => (
          <img key={item.id} src={item.url} alt={item.alt ?? ''} loading="lazy" />
        ))}
      </div>
    </main>
  );
}

/* --------------------------------------------------------------------- links */

export function LinksPage() {
  const { data, isLoading, error, refetch } = useLinks();

  return (
    <main className="inner-page">
      <InnerBanner
        title="Useful links"
        description="Your everyday KODE tools in one small universe."
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <LoadingRows />
      ) : data && data.length ? (
        <div className="link-grid">
          {data.map((link) => (
            <a
              className="link-card"
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <b>{link.title}</b>
              <p>{link.description ?? 'Opens in a new tab.'}</p>
              <span>{new URL(link.url).hostname.toUpperCase()}</span>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No links yet."
          description="Marketing will add the everyday tools here."
          badge={'NO\nLINKS'}
        />
      )}
    </main>
  );
}

/* ---------------------------------------------------------------------- more */

const MORE = [
  ['FAQs', 'Fast answers for the questions that keep appearing.', '/faqs'],
  ['Gallery', 'A club has a rhythm. These are some of its frames.', '/gallery'],
  ['Useful links', 'Your everyday KODE tools in one small universe.', '/links'],
  ['IT support', 'A direct line to KODE IT and the Odoo helpdesk.', '/support'],
  ['My profile', 'Your details, your photo, your password.', '/profile'],
] as const;

export function MorePage() {
  return (
    <main className="inner-page">
      <InnerBanner title="More KODE" description="The things you will want when you need them." />
      <div className="link-grid">
        {MORE.map(([title, description, to]) => (
          <Link className="link-card" data-reveal="tile" key={to} to={to}>
            <b>{title}</b>
            <p>{description}</p>
            <span>OPEN</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main className="inner-page">
      <EmptyState
        title="That page is not here."
        description="The link may be old, or the content may have been archived."
        badge={'404'}
        action={
          <Link className="ink-button" to="/">
            BACK TO THE PORTAL <Icon name="arrow" />
          </Link>
        }
      />
    </main>
  );
}
