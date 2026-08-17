import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../lib/queries';
import { Icon } from './icon';

/**
 * Command palette.
 *
 * Focus is trapped while open and returned to whatever opened it on close, so a
 * keyboard user is never dropped back at the top of the document.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [highlight, setHighlight] = useState(0);
  const navigate = useNavigate();
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const { data: results = [], isFetching } = useSearch(term);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener.current?.focus?.();
  }, []);

  useEffect(() => setHighlight(0), [term]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter' && results[highlight]) {
        event.preventDefault();
        navigate(results[highlight]!.href);
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap: cycle focus inside the dialog rather than escaping to the page.
      const focusables = dialog.current?.querySelectorAll<HTMLElement>(
        'button, input, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [results, highlight, navigate, onClose]);

  return (
    <div className="search-backdrop" onMouseDown={onClose}>
      <section
        className="search-modal"
        ref={dialog}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search the KODE portal"
      >
        <div>
          <Icon name="search" />
          <input
            ref={input}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="WHAT ARE YOU LOOKING FOR?"
            aria-label="Search"
            aria-describedby="search-status"
            autoComplete="off"
          />
          <button onClick={onClose} type="button" aria-label="Close search">
            <Icon name="close" />
          </button>
        </div>

        <section>
          <p id="search-status" className="visually-hidden" role="status" aria-live="polite">
            {isFetching ? 'Searching' : `${results.length} results`}
          </p>

          {term.trim().length < 2 ? (
            <p>Type at least two characters to search news, events, policies, people and more.</p>
          ) : results.length ? (
            results.map((result, index) => (
              <button
                key={`${result.type}-${result.id}`}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                style={index === highlight ? { background: 'var(--gold)' } : undefined}
                onClick={() => {
                  navigate(result.href);
                  onClose();
                }}
              >
                <span className="tnum">{String(index + 1).padStart(2, '0')}</span>
                <small>{result.type.toUpperCase()}</small>
                <b>{result.title}</b>
                <Icon name="arrow" />
              </button>
            ))
          ) : (
            <p>Nothing in the club matches that search yet.</p>
          )}
        </section>

        <footer>
          PRESS ESC TO CLOSE <kbd>ESC</kbd>
        </footer>
      </section>
    </div>
  );
}
