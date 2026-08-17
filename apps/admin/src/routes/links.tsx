import { useState, type FormEvent } from 'react';
import { Permission, createQuickLinkSchema, type QuickLinkDto } from '@kode/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { useQuickLinks } from '../lib/cms-api';
import { Icon } from '../components/icon';
import { CmsError, CmsState, Field, TableSkeleton } from '../components/ui';

export function LinksPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const list = useQuickLinks();
  const [editing, setEditing] = useState<QuickLinkDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = can(Permission.LINK_MANAGE);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/cms/links/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['cms', 'links'] }),
  });

  return (
    <>
      {message ? (
        <p className="cms-alert" data-tone="success" role="status" style={{ marginBottom: 16 }}>
          {message}
        </p>
      ) : null}

      <div className="module-intro">
        <div>
          <p className="eyebrow-admin">EVERYDAY TOOLS</p>
          <h2>Useful links.</h2>
          <p>
            The shortcuts every employee needs. Only http and https addresses are accepted, so a
            link can never carry a script payload into the portal.
          </p>
        </div>
        {canManage ? (
          <button className="create-button" type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            NEW LINK
          </button>
        ) : null}
      </div>

      {list.error ? (
        <CmsError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <TableSkeleton rows={3} />
      ) : list.data && list.data.length ? (
        <div className="people-table">
          {list.data.map((link) => (
            <div
              className="people-row"
              key={link.id}
              style={{ gridTemplateColumns: '1.4fr 1.4fr auto' }}
            >
              <div>
                <b>{link.title}</b>
                <small>{link.description ?? 'No description'}</small>
              </div>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all' }}
              >
                {link.url}
              </a>
              {canManage ? (
                <div className="table-actions">
                  <button type="button" onClick={() => setEditing(link)}>
                    <Icon name="edit" /> EDIT
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      await remove.mutateAsync(link.id);
                      setMessage(`"${link.title}" removed.`);
                    }}
                  >
                    <Icon name="trash" /> REMOVE
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <CmsState
          icon="link"
          title="No links yet"
          description="Add the everyday tools employees ask for most."
        />
      )}

      {creating || editing ? (
        <LinkDrawer
          link={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(text) => {
            setMessage(text);
            setCreating(false);
            setEditing(null);
            void client.invalidateQueries({ queryKey: ['cms', 'links'] });
          }}
        />
      ) : null}
    </>
  );
}

function LinkDrawer({
  link,
  onClose,
  onSaved,
}: {
  link: QuickLinkDto | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [title, setTitle] = useState(link?.title ?? '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [description, setDescription] = useState(link?.description ?? '');
  const [position, setPosition] = useState(link?.position ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: unknown) =>
      link ? api.patch(`/cms/links/${link.id}`, input) : api.post('/cms/links', input),
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = createQuickLinkSchema.safeParse({
      title,
      url,
      description: description || null,
      position,
      icon: 'external',
      status: 'PUBLISHED',
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    try {
      await save.mutateAsync(parsed.data);
      onSaved(link ? `"${title}" updated.` : `"${title}" added.`);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not save that link.');
    }
  }

  return (
    <div className="composer-backdrop" onMouseDown={onClose}>
      <aside
        className="composer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <p>USEFUL LINKS</p>
            <h2>{link ? 'Edit link' : 'New link'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <form className="cms-form" onSubmit={onSubmit} style={{ padding: 27 }} noValidate>
          {formError ? (
            <p className="cms-alert" role="alert">
              {formError}
            </p>
          ) : null}
          <Field label="TITLE" error={errors.title}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </Field>
          <Field label="URL" error={errors.url} hint="Must start with http:// or https://">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
              required
            />
          </Field>
          <Field label="DESCRIPTION" error={errors.description}>
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="ORDER" error={errors.position} hint="Lower numbers appear first.">
            <input
              type="number"
              min={0}
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="secondary-button" type="button" onClick={onClose}>
              CANCEL
            </button>
            <button className="create-button" type="submit" disabled={save.isPending}>
              {save.isPending ? 'SAVING...' : 'SAVE'} <Icon name="arrow" />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
