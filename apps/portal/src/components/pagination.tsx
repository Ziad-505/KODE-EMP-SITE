import { Icon } from './icon';

export function Pagination({
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
    <nav className="pagination" aria-label="Pagination">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        PREVIOUS
      </button>
      <span className="tnum">
        PAGE {page} OF {totalPages} · {total} ITEMS
      </span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        NEXT <Icon name="arrow" size={14} />
      </button>
    </nav>
  );
}
