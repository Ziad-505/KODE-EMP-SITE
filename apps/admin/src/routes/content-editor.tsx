import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CONTENT_STATUS_LABEL,
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  TaxonomyKind,
  createAlbumSchema,
  createArticleSchema,
  createEventSchema,
  createFaqSchema,
  createPolicySchema,
} from '@kode/contracts';
import type { ZodTypeAny } from 'zod';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { useContentItem, useDepartments, useSaveContent, useTaxonomy } from '../lib/cms-api';
import { resourceFor } from '../lib/resources';
import { Icon } from '../components/icon';
import { CmsError, Field, SectionLabel, TableSkeleton, toDateTimeLocal } from '../components/ui';

/** Loose shape covering every content type the editor can open. */
type Draft = Record<string, unknown>;

const SCHEMAS: Record<string, ZodTypeAny> = {
  news: createArticleSchema,
  events: createEventSchema,
  policies: createPolicySchema,
  faqs: createFaqSchema,
  gallery: createAlbumSchema,
};

export function ContentEditorPage() {
  const { resourceKey = '', id } = useParams();
  const resource = resourceFor(resourceKey);
  const isNew = id === 'new' || id === undefined;
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const existing = useContentItem<Draft>(resource!, isNew ? undefined : id);
  const departments = useDepartments();
  // Archived terms are excluded: they stay valid on items that already use them
  // but cannot be chosen for new ones. All three lists are cached for five
  // minutes and read on nearly every editor screen, so fetching them together
  // costs one request each per session rather than one per resource type.
  const eventKinds = useTaxonomy(TaxonomyKind.EVENT_KIND).data;
  const newsCategories = useTaxonomy(TaxonomyKind.ARTICLE_CATEGORY).data;
  const faqCategories = useTaxonomy(TaxonomyKind.FAQ_CATEGORY).data;
  const defaultKindId = eventKinds?.[0]?.id ?? '';
  const defaultNewsCategoryId = newsCategories?.[0]?.id ?? '';
  const defaultFaqCategoryId = faqCategories?.[0]?.id ?? '';
  const save = useSaveContent<Draft>(resource!);

  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * Which blank form the draft was seeded for, so seeding happens exactly once
   * per form rather than on every render of this effect.
   *
   * The term lists resolve after the first render, so the default ids they
   * produce change from '' to a real id partway through editing. When those ids
   * were effect dependencies, that change re-ran the whole seed and
   * `setDraft({...})` replaced everything already typed — a headline written
   * before the third query landed simply vanished, with nothing on screen to
   * say why. Switching resource type still re-seeds, because the key changes.
   */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isNew && existing.data) {
      seededFor.current = null;
      setDraft({
        ...existing.data,
        departmentId: (existing.data.department as { id: string } | null)?.id ?? null,
        // The DTO carries the whole term so lists can render its label and
        // colour; the form edits the id.
        ...(existing.data.kind ? { kindId: (existing.data.kind as { id: string }).id } : {}),
        ...(existing.data.category
          ? { categoryId: (existing.data.category as { id: string }).id }
          : {}),
      });
    }
    if (isNew && seededFor.current !== resourceKey) {
      seededFor.current = resourceKey;
      setDraft({
        status: ContentStatus.DRAFT,
        // A department-scoped editor cannot create club-wide content, so their
        // own department is pre-selected rather than left blank and rejected.
        departmentId: user?.role === 'DEPARTMENT_EDITOR' ? user.departmentId : null,
        ...(resourceKey === 'policies' ? { version: '1.0' } : {}),
        ...(resourceKey === 'news' ? { pinned: false } : {}),
        ...(resourceKey === 'faqs' ? { position: 0 } : {}),
      });
    }
  }, [isNew, existing.data, resourceKey, user]);

  /*
   * The default term, applied only while the field is still empty. Separated
   * from the seed above so a slow response fills a blank select instead of
   * discarding the rest of the form.
   */
  useEffect(() => {
    if (!isNew) return;
    const field = resourceKey === 'events' ? 'kindId' : 'categoryId';
    const fallback =
      resourceKey === 'events'
        ? defaultKindId
        : resourceKey === 'news'
          ? defaultNewsCategoryId
          : resourceKey === 'faqs'
            ? defaultFaqCategoryId
            : '';
    if (!fallback) return;
    setDraft((current) => (current[field] ? current : { ...current, [field]: fallback }));
  }, [isNew, resourceKey, defaultKindId, defaultNewsCategoryId, defaultFaqCategoryId]);

  const currentStatus = (draft.status as ContentStatus) ?? ContentStatus.DRAFT;
  const canPublish = resource ? can(resource.permissions.publish) : false;

  const statusOptions = useMemo(() => {
    const base = isNew
      ? [ContentStatus.DRAFT, ContentStatus.IN_REVIEW, ContentStatus.PUBLISHED]
      : [currentStatus, ...CONTENT_STATUS_TRANSITIONS[currentStatus]];
    return [...new Set(base)];
  }, [isNew, currentStatus]);

  if (!resource) return <CmsError error={new Error('Unknown content type')} />;
  if (!isNew && existing.error)
    return <CmsError error={existing.error} onRetry={() => void existing.refetch()} />;
  if (!isNew && existing.isLoading) return <TableSkeleton rows={4} />;

  const set = (key: string, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const schema = SCHEMAS[resourceKey];
    const payload = normalise(resourceKey, draft);
    const parsed = schema?.safeParse(payload);

    if (parsed && !parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setFormError('Some fields need attention.');
      return;
    }

    setErrors({});
    try {
      const result = await save.mutateAsync({
        ...(isNew ? {} : { id: id! }),
        input: parsed?.data ?? payload,
      });
      setSaved(true);
      if (isNew && result.id)
        navigate(`/content/${resourceKey}/${String(result.id)}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        const details: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.details)) {
          if (messages[0]) details[field] = messages[0];
        }
        setErrors(details);
      } else {
        setFormError('Could not save. Please try again.');
      }
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="editor-header">
        <div>
          <p className="eyebrow-admin">
            {isNew ? 'NEW' : 'EDITING'} · {resource.plural.toUpperCase()}
          </p>
          <h2>
            {(draft.title as string) || (draft.question as string) || `New ${resource.singular}`}
          </h2>
        </div>
        <div className="editor-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => navigate(`/content/${resource.key}`)}
          >
            CANCEL
          </button>
          <button className="create-button" type="submit" disabled={save.isPending}>
            {save.isPending ? 'SAVING...' : 'SAVE'} <Icon name="arrow" />
          </button>
        </div>
      </div>

      {formError ? (
        <p className="cms-alert" role="alert" style={{ marginBottom: 16 }}>
          {formError}
        </p>
      ) : null}
      {saved ? (
        <p className="cms-alert" data-tone="success" role="status" style={{ marginBottom: 16 }}>
          Saved.{' '}
          {currentStatus === ContentStatus.PUBLISHED
            ? 'It is live on the portal.'
            : 'It is not visible to employees yet.'}
        </p>
      ) : null}

      <div className="editor-shell">
        <div className="editor-main">
          <SectionLabel>CONTENT</SectionLabel>

          {resourceKey === 'faqs' ? (
            <>
              <Field label="QUESTION" error={errors.question}>
                <input
                  value={str(draft.question)}
                  onChange={(event) => set('question', event.target.value)}
                  required
                />
              </Field>
              <Field
                label="ANSWER"
                error={errors.answer}
                hint="Plain text. Blank lines become paragraphs on the portal."
              >
                <textarea
                  value={str(draft.answer)}
                  onChange={(event) => set('answer', event.target.value)}
                  rows={12}
                  required
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="TITLE" error={errors.title}>
                <input
                  value={str(draft.title)}
                  onChange={(event) => set('title', event.target.value)}
                  required
                />
              </Field>

              {resourceKey === 'news' ? (
                <Field
                  label="EXCERPT"
                  error={errors.excerpt}
                  hint="One line shown in listings and search."
                >
                  <input
                    value={str(draft.excerpt)}
                    onChange={(event) => set('excerpt', event.target.value)}
                  />
                </Field>
              ) : null}

              {resourceKey === 'policies' ? (
                <Field label="SUMMARY" error={errors.summary}>
                  <input
                    value={str(draft.summary)}
                    onChange={(event) => set('summary', event.target.value)}
                  />
                </Field>
              ) : null}

              {resourceKey === 'gallery' ? (
                <Field label="DESCRIPTION" error={errors.description}>
                  <textarea
                    value={str(draft.description)}
                    onChange={(event) => set('description', event.target.value)}
                    rows={4}
                  />
                </Field>
              ) : (
                <Field
                  label={resourceKey === 'events' ? 'DESCRIPTION' : 'BODY'}
                  error={errors.body ?? errors.description}
                  hint="Plain text. Blank lines become paragraphs on the portal."
                >
                  <textarea
                    value={str(resourceKey === 'events' ? draft.description : draft.body)}
                    onChange={(event) =>
                      set(resourceKey === 'events' ? 'description' : 'body', event.target.value)
                    }
                    rows={16}
                    required
                  />
                </Field>
              )}
            </>
          )}
        </div>

        <aside className="editor-aside">
          <SectionLabel>PUBLICATION</SectionLabel>

          <Field
            label="STATUS"
            error={errors.status}
            hint={canPublish ? undefined : 'Your role can prepare and submit, but not publish.'}
          >
            <select value={currentStatus} onChange={(event) => set('status', event.target.value)}>
              {statusOptions.map((status) => {
                const restricted =
                  (status === ContentStatus.PUBLISHED || status === ContentStatus.ARCHIVED) &&
                  !canPublish;
                return (
                  <option key={status} value={status} disabled={restricted}>
                    {CONTENT_STATUS_LABEL[status]}
                    {restricted ? ' (needs a Content Manager)' : ''}
                  </option>
                );
              })}
            </select>
          </Field>

          <Field
            label="DEPARTMENT"
            error={errors.departmentId}
            hint={
              user?.role === 'DEPARTMENT_EDITOR'
                ? 'Department Editors cannot create club-wide content.'
                : 'Club-wide content is visible to every employee.'
            }
          >
            <select
              value={str(draft.departmentId)}
              onChange={(event) => set('departmentId', event.target.value || null)}
              disabled={user?.role === 'DEPARTMENT_EDITOR'}
            >
              <option value="">Club-wide</option>
              {(departments.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>

          {resourceKey === 'news' ? (
            <>
              <Field label="CATEGORY" error={errors.categoryId}>
                {/* A managed list, not free text. The column used to be an
                    unconstrained string, so "Club Life" and "club life"
                    existed as separate facets with no way to rename either. */}
                <select
                  value={str(draft.categoryId)}
                  onChange={(event) => set('categoryId', event.target.value)}
                >
                  {(newsCategories ?? []).map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.label}
                    </option>
                  ))}
                </select>
              </Field>
              <label
                className="cms-field"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(draft.pinned)}
                  onChange={(event) => set('pinned', event.target.checked)}
                />
                <span>PIN TO THE TOP OF THE PORTAL</span>
              </label>
            </>
          ) : null}

          {resourceKey === 'events' ? (
            <>
              <Field label="KIND" error={errors.kindId}>
                <select
                  value={str(draft.kindId)}
                  onChange={(event) => set('kindId', event.target.value)}
                >
                  {/* Options come from the API, not from a compiled-in enum, so
                      a kind added in Settings appears here without a deploy.
                      Archived terms are excluded: they stay valid on existing
                      events but cannot be applied to new ones. */}
                  {(eventKinds ?? []).map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="LOCATION" error={errors.location}>
                <input
                  value={str(draft.location)}
                  onChange={(event) => set('location', event.target.value)}
                  required
                />
              </Field>
              <Field label="STARTS" error={errors.startsAt}>
                <input
                  type="datetime-local"
                  value={toDateTimeLocal(str(draft.startsAt) || null)}
                  onChange={(event) => set('startsAt', event.target.value)}
                  required
                />
              </Field>
              <Field label="ENDS" error={errors.endsAt}>
                <input
                  type="datetime-local"
                  value={toDateTimeLocal(str(draft.endsAt) || null)}
                  onChange={(event) => set('endsAt', event.target.value || null)}
                />
              </Field>
              <Field label="CAPACITY" error={errors.capacity}>
                <input
                  type="number"
                  min={1}
                  value={str(draft.capacity)}
                  onChange={(event) =>
                    set('capacity', event.target.value ? Number(event.target.value) : null)
                  }
                />
              </Field>
            </>
          ) : null}

          {resourceKey === 'policies' ? (
            <>
              <Field label="VERSION" error={errors.version}>
                <input
                  value={str(draft.version)}
                  onChange={(event) => set('version', event.target.value)}
                />
              </Field>
              <Field label="EFFECTIVE FROM" error={errors.effectiveFrom}>
                <input
                  type="date"
                  value={str(draft.effectiveFrom).slice(0, 10)}
                  onChange={(event) => set('effectiveFrom', event.target.value || null)}
                />
              </Field>
              <Field
                label="REVIEW DUE"
                error={errors.reviewDueAt}
                hint="Drives the dashboard attention list."
              >
                <input
                  type="date"
                  value={str(draft.reviewDueAt).slice(0, 10)}
                  onChange={(event) => set('reviewDueAt', event.target.value || null)}
                />
              </Field>
            </>
          ) : null}

          {resourceKey === 'faqs' ? (
            <>
              <Field label="CATEGORY" error={errors.categoryId}>
                {/* A managed list, not free text. The column used to be an
                    unconstrained string, so "Club Life" and "club life"
                    existed as separate facets with no way to rename either. */}
                <select
                  value={str(draft.categoryId)}
                  onChange={(event) => set('categoryId', event.target.value)}
                >
                  {(faqCategories ?? []).map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ORDER" error={errors.position} hint="Lower numbers appear first.">
                <input
                  type="number"
                  min={0}
                  value={str(draft.position)}
                  onChange={(event) => set('position', Number(event.target.value))}
                />
              </Field>
            </>
          ) : null}
        </aside>
      </div>
    </form>
  );
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Strips server-owned fields and normalises empty strings to null. */
function normalise(resourceKey: string, draft: Draft): Draft {
  const {
    id: _id,
    slug: _slug,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    publishedAt: _publishedAt,
    department: _department,
    author: _author,
    coverUrl: _coverUrl,
    documentUrl: _documentUrl,
    itemCount: _itemCount,
    items: _items,
    ...rest
  } = draft;

  const cleaned: Draft = {};
  for (const [key, value] of Object.entries(rest)) {
    cleaned[key] = value === '' ? null : value;
  }
  /*
   * Gallery albums used to get `itemIds: []` forced onto every payload when the
   * editor had no item list of its own. The API treats `itemIds` as the complete
   * desired set, so saving an unrelated field — a title typo, a status change —
   * replaced the album's contents with nothing. Every photo in it was detached,
   * silently, behind a success toast.
   *
   * This screen does not manage album items, so the correct payload omits the
   * key and lets the server leave the existing set alone. An empty array is only
   * right when the user has explicitly emptied the album, which this editor has
   * no way to express.
   */
  if (resourceKey === 'gallery' && !Array.isArray(cleaned.itemIds)) {
    delete cleaned.itemIds;
  }
  return cleaned;
}
