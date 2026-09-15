import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ALL_CONTENT_STATUSES,
  CONTENT_STATUS_LABEL,
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  Scope,
  type AdminListQuery,
  type Page,
} from '@kode/contracts';
import { useAuth } from '../lib/auth-context';
import { useChangeStatus, useContentList, useDeleteContent } from '../lib/cms-api';
import { resourceFor } from '../lib/resources';
import { Icon } from '../components/icon';
import { CmsError, CmsPagination, CmsState, StatusChip, TableSkeleton } from '../components/ui';

/**
 * A row of any content type. The API returns the same envelope for all of them,
 * so one list view serves news, events, policies, FAQs and albums.
 */
interface ContentRow {
  id: string;
  title?: string;
  question?: string;
  status: ContentStatus;
  updatedAt: string;
  department?: { name: string; colour: string } | null;
  category?: string;
  version?: string;
  startsAt?: string;
  itemCount?: number;
}

const FILTERS = ['All', ...ALL_CONTENT_STATUSES] as const;

export function ContentListPage() {
  const { resourceKey = '' } = useParams();
  const resource = resourceFor(resourceKey);
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  // Selection is keyed by row id, never by array index: the original kept an
  // index and left the drawer attached to a different item after filtering.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useMemo<AdminListQuery>(
    () => ({
      page,
      pageSize: 20,
      sort: 'updatedAt',
      order: 'desc',
      ...(term ? { q: term } : {}),
      ...(filter !== 'All' ? { status: filter } : {}),
    }),
    [page, term, filter],
  );

  const list = useContentList<ContentRow>(resource!, query);
  const changeStatus = useChangeStatus<ContentRow>(resource!);
  const remove = useDeleteContent(resource!);

  if (!resource) {
    return <CmsState title="Unknown section" description="That content type does not exist." />;
  }

  const data = list.data as Page<ContentRow> | undefined;
  const canCreate = can(resource.permissions.create);
  const canPublish = can(resource.permissions.publish);
  const canDelete = can(resource.permissions.remove);
  const departmentScoped = user?.role === 'DEPARTMENT_EDITOR';

  return (
    <>
      {notice ? (
        <div className="admin-notice" role="status">
          <Icon name="check" />
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {departmentScoped ? (
        <p className="scope-note">
          You are a Department Editor. You can see club-wide content, but you can only create and
          edit items that belong to {user?.departmentName ?? 'your department'}.
        </p>
      ) : null}

      <div className="module-intro">
        <div>
          <p className="eyebrow-admin">CONTENT LIBRARY</p>
          <h2>{resource.plural} with intent.</h2>
          <p>
            Manage what employees discover in the portal. Save drafts freely
            {canPublish ? '; publish only when it is ready.' : '; a Content Manager publishes.'}
          </p>
        </div>
        {canCreate ? (
          <Link
            className="create-button"
            to={`/content/${resource.key}/new`}
            style={{ textDecoration: 'none' }}
          >
            <Icon name="plus" />
            NEW {resource.singular.toUpperCase()}
          </Link>
        ) : null}
      </div>

      <div className="module-toolbar">
        <div>
          {FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              className={filter === status ? 'active' : ''}
              aria-pressed={filter === status}
              onClick={() => {
                setFilter(status);
                setPage(1);
                setSelectedId(null);
              }}
            >
              {status === 'All' ? 'All' : CONTENT_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setPage(1);
          }}
          placeholder={`Search ${resource.plural.toLowerCase()}`}
          aria-label={`Search ${resource.plural}`}
          style={{
            border: '1px solid var(--line)',
            background: '#fff',
            padding: '8px 10px',
            fontSize: 11,
            minWidth: 200,
          }}
        />
      </div>

      <div className="content-table">
        <div className="table-head">
          <span>CONTENT</span>
          <span>STATUS</span>
          <span>UPDATED</span>
          <span />
        </div>

        {list.error ? (
          <CmsError error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <TableSkeleton />
        ) : data && data.items.length ? (
          data.items.map((row, index) => {
            const title = row.title ?? row.question ?? 'Untitled';
            const isSelected = selectedId === row.id;
            const allowedNext = CONTENT_STATUS_TRANSITIONS[row.status];

            return (
              <article className={isSelected ? 'selected' : ''} key={row.id}>
                <button
                  className="content-row"
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : row.id)}
                  aria-expanded={isSelected}
                >
                  <div className="content-main">
                    <span className={`content-thumb thumb-${index % 4}`} aria-hidden="true">
                      {String(index + 1 + (page - 1) * 20).padStart(2, '0')}
                    </span>
                    <div>
                      <b>{title}</b>
                      <p>{describe(row)}</p>
                    </div>
                  </div>
                  <StatusChip status={row.status} />
                  <time className="tnum" dateTime={row.updatedAt}>
                    {formatShort(row.updatedAt)}
                  </time>
                  <Icon name={isSelected ? 'close' : 'more'} />
                </button>

                {isSelected ? (
                  <div className="item-drawer">
                    <p>
                      Publishing writes an audit entry with the editor, timestamp, role and the
                      department scope this item belongs to.
                    </p>
                    <div className="table-actions">
                      <button
                        type="button"
                        onClick={() => navigate(`/content/${resource.key}/${row.id}`)}
                      >
                        <Icon name="edit" /> EDIT
                      </button>

                      {allowedNext.map((status) => {
                        const needsPublishRight =
                          status === ContentStatus.PUBLISHED ||
                          status === ContentStatus.ARCHIVED ||
                          row.status === ContentStatus.PUBLISHED;
                        const disabled = needsPublishRight && !canPublish;
                        return (
                          <button
                            key={status}
                            type="button"
                            disabled={disabled || changeStatus.isPending}
                            title={disabled ? 'Only a Content Manager can do this' : undefined}
                            onClick={async () => {
                              await changeStatus.mutateAsync({ id: row.id, status });
                              setNotice(`"${title}" moved to ${CONTENT_STATUS_LABEL[status]}.`);
                              setSelectedId(null);
                            }}
                          >
                            {disabled ? <Icon name="lock" /> : <Icon name="arrow" />}
                            {CONTENT_STATUS_LABEL[status].toUpperCase()}
                          </button>
                        );
                      })}

                      {canDelete ? (
                        <button
                          type="button"
                          className="danger"
                          disabled={remove.isPending}
                          onClick={async () => {
                            await remove.mutateAsync(row.id);
                            setNotice(`"${title}" deleted. The audit trail keeps the record.`);
                            setSelectedId(null);
                          }}
                        >
                          <Icon name="trash" /> DELETE
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <CmsState
            title={`No ${filter === 'All' ? '' : CONTENT_STATUS_LABEL[filter].toLowerCase()} ${resource.plural.toLowerCase()}`.trim()}
            description={
              term
                ? 'Nothing matches that search. Try a shorter term or clear the filter.'
                : `Create the first ${resource.singular} to see it here.`
            }
            action={
              canCreate ? (
                <Link
                  className="create-button"
                  to={`/content/${resource.key}/new`}
                  style={{ textDecoration: 'none' }}
                >
                  <Icon name="plus" /> NEW {resource.singular.toUpperCase()}
                </Link>
              ) : undefined
            }
          />
        )}
      </div>

      {data ? (
        <CmsPagination
          page={data.meta.page}
          totalPages={data.meta.totalPages}
          total={data.meta.total}
          onChange={setPage}
        />
      ) : null}
    </>
  );
}

/** Compact enough for the narrow updated column. */
function formatShort(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describe(row: ContentRow): string {
  const parts: string[] = [];
  if (row.category) parts.push(String((row.category as { label?: string }).label ?? ''));
  if (row.version) parts.push(`v${row.version}`);
  if (row.startsAt)
    parts.push(
      new Date(row.startsAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    );
  if (typeof row.itemCount === 'number') parts.push(`${row.itemCount} media items`);
  parts.push(row.department?.name ?? 'Club-wide');
  return parts.join(' · ');
}

export const DEPARTMENT_SCOPE = Scope.Department;
