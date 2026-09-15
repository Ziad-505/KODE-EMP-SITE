import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import kMark from '../assets/kode-k-mark.png';
import { Icon } from '../components/icon';
import { ErrorState } from '../components/states';
import { useHome } from '../lib/queries';

const MOSAIC = [
  ['Policies', 'General and department knowledge, in the right place.', '/policies', '#244EA2'],
  [
    'IT support',
    'Tell us what went wrong. KODE IT and Odoo handle the rest.',
    '/support',
    '#F26522',
  ],
  ['Directory', 'The shortest path to the person you need.', '/directory', '#7F3F98'],
  ['FAQs', 'Fast answers for the questions that keep appearing.', '/faqs', '#BFD730'],
] as const;

export function HomePage() {
  const navigate = useNavigate();
  const { data, error, refetch } = useHome();

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const news = data?.news ?? [];
  const events = data?.events ?? [];

  return (
    <main>
      <section className="hero-stage">
        <div className="hero-meta">
          <span>CAIRO / EGYPT</span>
          <span>EMPLOYEE SPACE / 2026</span>
        </div>

        <div className="hero-rhythm" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <i key={index} />
          ))}
        </div>

        <div className="hero-copy">
          <p className="micro-label">A DIFFERENT KIND OF INSIDE</p>
          <h1>
            WHERE
            <br />
            <em>THE CLUB</em>
            <br />
            COMES ALIVE.
          </h1>
          <p className="hero-description">
            The shared field for the people who make KODE Sports Club feel like KODE.
          </p>
          <button className="ink-button" type="button" onClick={() => navigate('/news')}>
            ENTER THE PULSE <Icon name="arrow" />
          </button>
        </div>

        <Sculpture />

        <div className="hero-foot">
          <span>SCROLL TO UNFOLD</span>
          <i />
          <b className="tnum">01</b>
        </div>
      </section>

      <section className="manifesto-section">
        <div className="manifesto-grid">
          <p className="micro-label">NO. 01 — THE KODE FREQUENCY</p>
          <h2>
            Not an
            <br />
            intranet.
            <br />
            <strong>
              A living
              <br />
              clubhouse.
            </strong>
          </h2>
          <div className="manifesto-note">
            <span className="shape-mark" />
            <p>
              Ideas move faster when the right people can find them. This is where the club speaks
              in one clear, colourful voice.
            </p>
          </div>
        </div>
        <div className="kinetic-words" aria-hidden="true">
          <span>ENERGY</span>
          <span>CARE</span>
          <span>MOMENTUM</span>
          <span>CRAFT</span>
          <span>ENERGY</span>
        </div>
      </section>

      <ScrollCinema />

      <section className="live-section">
        <div className="section-lead">
          {/* The inner wrapper is what sticks; see the note in base.css. */}
          <div className="section-lead-inner">
            <p className="micro-label">RIGHT NOW AT KODE</p>
            <h2>
              Fresh from
              <br />
              the <strong>floor.</strong>
            </h2>
            <Link className="line-button" to="/news">
              ALL CLUB NEWS <Icon name="arrow" />
            </Link>
          </div>
        </div>
        <div className="news-stack">
          {news.length === 0
            ? Array.from({ length: 3 }, (_, index) => (
                <div className="skeleton skeleton-row" key={index} />
              ))
            : news.map((item, index) => (
                <Link
                  className={`story-slip slip-${index}`}
                  key={item.id}
                  to={`/news/${item.slug}`}
                >
                  <div className="slip-visual">
                    <span className="tnum">{String(index + 1).padStart(2, '0')}</span>
                    <b>{['K', 'O', 'D'][index] ?? 'E'}</b>
                  </div>
                  <div>
                    <small>
                      {item.category.label.toUpperCase()} /{' '}
                      {formatDate(item.publishedAt ?? item.createdAt)}
                    </small>
                    <h3>{item.title}</h3>
                  </div>
                  <Icon name="arrow" />
                </Link>
              ))}
        </div>
      </section>

      <section className="calendar-rush">
        <div className="rush-title">
          <p className="micro-label">STEP OUT OF THE INBOX</p>
          <h2>
            The next
            <br />
            <strong>good thing.</strong>
          </h2>
        </div>
        <div className="rush-events">
          {events.length === 0 ? (
            <p style={{ padding: '30px 0', fontSize: 14, fontWeight: 500 }}>
              Nothing on the calendar just yet. Marketing will publish the next club moment here.
            </p>
          ) : (
            events.map((event, index) => {
              const date = new Date(event.startsAt);
              return (
                <Link to={`/events/${event.slug}`} key={event.id}>
                  <time dateTime={event.startsAt}>
                    <b className="tnum">{String(date.getDate()).padStart(2, '0')}</b>
                    <span>
                      {date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}
                    </span>
                  </time>
                  <div>
                    <small className="tnum">
                      {String(index + 1).padStart(2, '0')} / {event.kind.label}
                    </small>
                    <h3>{event.title}</h3>
                    <p>
                      {event.location} ·{' '}
                      {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <Icon name="arrow" />
                </Link>
              );
            })
          )}
        </div>
      </section>

      <section className="utility-mosaic">
        <div className="mosaic-intro">
          <p className="micro-label">THE USEFUL, BEAUTIFUL BITS</p>
          <h2>
            Stay in
            <br />
            <strong>the flow.</strong>
          </h2>
        </div>
        {MOSAIC.map(([title, text, to, colour], index) => (
          <Link
            key={to}
            className={`mosaic-tile tile-${index}`}
            style={{ '--tile': colour } as React.CSSProperties}
            to={to}
          >
            <span className="tnum">{String(index + 1).padStart(2, '0')}</span>
            <h3>{title}</h3>
            <p>{text}</p>
            <Icon name="arrow" />
          </Link>
        ))}
      </section>
    </main>
  );
}

/**
 * The hero graphic.
 *
 * The orbiting caption is an SVG textPath rather than a rotated block of text.
 * The original wrapped as ordinary horizontal text, overflowed the circle, and
 * collided with the meta row above it.
 */
function Sculpture() {
  return (
    <div className="hero-sculpture" role="img" aria-label="Animated KODE Sports Club graphic">
      <svg className="orbit-text" viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <path
            id="orbit-path"
            d="M 100,100 m -86,0 a 86,86 0 1,1 172,0 a 86,86 0 1,1 -172,0"
            fill="none"
          />
        </defs>
        <text>
          <textPath href="#orbit-path" startOffset="0">
            KODE SPORTS CLUB · MOVE WITH PURPOSE · KODE SPORTS CLUB · MOVE WITH PURPOSE ·
          </textPath>
        </text>
      </svg>
      <div className="sculpture-ring ring-one" />
      <div className="sculpture-ring ring-two" />
      <div className="sculpture-core">
        <img src={kMark} alt="" />
        <small>
          THE
          <br />
          CLUB
        </small>
      </div>
      <div className="sculpture-tag tag-a">01 / BELONG</div>
      <div className="sculpture-tag tag-b">02 / BUILD</div>
      <div className="sculpture-tag tag-c">03 / BECOME</div>
    </div>
  );
}

/**
 * The pinned scroll section.
 *
 * Driven by a scroll listener with rAF batching rather than a scroll-animation
 * library. That removes roughly half the portal's JavaScript payload, and the
 * whole effect is skipped under prefers-reduced-motion.
 */
function ScrollCinema() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const total = element.offsetHeight - window.innerHeight;
      const progress = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 0;
      element.style.setProperty('--progress', progress.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <section className="cinema-scroll" ref={root}>
      <div className="cinema-pin">
        <div className="cinema-top">
          <p className="micro-label">FOLLOW THE KODE LINE</p>
          <span>SCROLL / PLAY</span>
        </div>
        <div className="cinema-headline">
          ONE CLUB.
          <br />
          <strong>EVERYTHING</strong>
          <br />
          IN MOTION.
        </div>
        <div className="cinema-anchor cinema-orbit cinema-orbit-a" />
        <div className="cinema-anchor cinema-orbit cinema-orbit-b" />
        <div className="cinema-anchor cinema-core">
          <img src={kMark} alt="" />
        </div>
        <div className="cinema-route">
          <i />
          <i />
          <i />
        </div>
        <div className="cinema-pulse" />
        <Link className="cinema-card cinema-blue" to="/news">
          <span>01 / SEE</span>
          <b>FIND THE SIGNAL</b>
          <p>Stories and updates from every part of KODE.</p>
          <Icon name="arrow" />
        </Link>
        <Link className="cinema-card cinema-gold" to="/policies">
          <span>02 / KNOW</span>
          <b>KNOW THE PLAY</b>
          <p>Guidance that turns everyday work into club standard.</p>
          <Icon name="arrow" />
        </Link>
        <Link className="cinema-card cinema-pink" to="/directory">
          <span>03 / CONNECT</span>
          <b>MEET THE TEAM</b>
          <p>The people who keep the club in motion.</p>
          <Icon name="arrow" />
        </Link>
        <div className="cinema-foot">
          <span>THE KODE ROUTE</span>
          <b className="tnum">
            01 <i>/</i> 03
          </b>
        </div>
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
