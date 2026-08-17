import { useMemo, useState, type FormEvent } from 'react';
import {
  ALL_TAXONOMY_KINDS,
  TAXONOMY_KIND_HINT,
  TAXONOMY_KIND_LABEL,
  TaxonomyKind,
  createTaxonomySchema,
  type TaxonomyDto,
} from '@kode/contracts';
import { ApiError } from '../lib/api-client';
import { useTaxonomy, useTaxonomyMutations } from '../lib/cms-api';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../components/icon';

/**
 * Admin-managed lists.
 *
 * This screen exists because adding an event kind used to mean a schema edit, a
 * hand-written migration, a contracts rebuild and a coordinated redeploy of the
 * API and both SPAs. It is now a form.
 *
 * Only `EVENT_KIND` is wired to content today. The other three namespaces are
 * shown because the table and the API already handle them identically; the work
 * left is moving the columns that still use enums and free text onto the same
 * foreign key.
 */
const WIRED: readonly TaxonomyKind[] = [TaxonomyKind.EVENT_KIND];

const SWATCHES = ['#244EA2', '#F26522', '#BFD730', '#7F3F98', '#ED0C6E', '#FEC20E', '#15162B'];

export function TaxonomyPage() {
  const { can } = useAuth();
  const [kind, setKind] = useState<TaxonomyKind>(TaxonomyKind.EVENT_KIND);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error } = useTaxonomy(kind, true);
  const mutations = useTaxonomyMutations();

  const mayManage = can('settings:manage' as never);

  const terms = useMemo(() => {
    const rows = data ?? [];
    return showArchived ? rows : rows.filter((row) => !row.archivedAt);
  }, [data, showArchived]);

  const archivedCount = (data ?? []).filter((row) => row.archivedAt).length;

  return (
    <div className="taxonomy-page">
      <header className="module-intro">
        <div>
          <p className="eyebrow-admin">SETTINGS / LISTS</p>
          <h2>Lists that people choose from.</h2>
          <p>
            The options people choose from across the club. Changes take effect immediately, with no
            deploy.
          </p>
        </div>
      </header>

      <div className="taxonomy-layout">
        <nav className="taxonomy-switch" aria-label="List type">
          {ALL_TAXONOMY_KINDS.map((entry) => {
            const wired = WIRED.includes(entry);
            return (
              <button
                key={entry}
                type="button"
                className={entry === kind ? 'active' : ''}
                onClick={() => setKind(entry)}
                aria-current={entry === kind ? 'true' : undefined}
              >
                <b>{TAXONOMY_KIND_LABEL[entry]}</b>
                <span>{TAXONOMY_KIND_HINT[entry]}</span>
                {!wired ? <em>NOT YET WIRED</em> : null}
              </button>
            );
          })}
        </nav>

        <section className="taxonomy-panel">
          {!WIRED.includes(kind) ? (
            <p className="taxonomy-note">
              This list is stored and editable, but the content that will use it still reads from a
              fixed set in the database. Terms added here take effect once that column is migrated.
            </p>
          ) : null}

          {error ? (
            <p className="cms-alert" role="alert">
              {error instanceof ApiError ? error.message : 'Could not load this list.'}
            </p>
          ) : null}

          <div className="taxonomy-toolbar">
            <p className="tnum">
              {terms.filter((row) => !row.archivedAt).length} active
              {archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
            </p>
            {archivedCount > 0 ? (
              <label className="taxonomy-toggle">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
            ) : null}
          </div>

          {isLoading ? (
            <div className="skeleton skeleton-row" />
          ) : (
            <ul className="taxonomy-list">
              {terms.map((term) => (
                <TermRow key={term.id} term={term} mayManage={mayManage} mutations={mutations} />
              ))}
            </ul>
          )}

          {mayManage ? (
            <NewTermForm kind={kind} mutations={mutations} />
          ) : (
            <p className="taxonomy-note">
              Your role can see these lists but not change them. Ask a Super Admin.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

type Mutations = ReturnType<typeof useTaxonomyMutations>;

function TermRow({
  term,
  mayManage,
  mutations,
}: {
  term: TaxonomyDto;
  mayManage: boolean;
  mutations: Mutations;
}) {
  const [label, setLabel] = useState(term.label);
  const [colour, setColour] = useState(term.colour);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = label !== term.label || colour !== term.colour;
  // Deleting is only offered when it can actually succeed. The API and the
  // database both refuse otherwise, but offering a button that always fails is
  // worse than not offering it.
  const deletable = mayManage && !term.isSystem && term.usageCount === 0;

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'That did not work.');
    }
  }

  return (
    <li className={term.archivedAt ? 'taxonomy-row archived' : 'taxonomy-row'}>
      <span className="taxonomy-swatch" style={{ background: colour }} aria-hidden="true" />

      <div className="taxonomy-main">
        {mayManage ? (
          <input
            className="taxonomy-label-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={`Name for ${term.key}`}
          />
        ) : (
          <b>{term.label}</b>
        )}
        <code>{term.key}</code>
      </div>

      <p className="taxonomy-usage tnum">
        {term.usageCount === 0 ? 'Unused' : `${term.usageCount} in use`}
        {term.isSystem ? ' · built in' : ''}
        {term.archivedAt ? ' · archived' : ''}
      </p>

      {mayManage ? (
        <div className="taxonomy-actions">
          <div className="taxonomy-swatches" role="group" aria-label="Colour">
            {SWATCHES.map((value) => (
              <button
                key={value}
                type="button"
                style={{ background: value }}
                className={value === colour ? 'active' : ''}
                onClick={() => setColour(value)}
                aria-label={value}
                aria-pressed={value === colour}
              />
            ))}
          </div>

          {dirty ? (
            <button
              type="button"
              className="create-button"
              onClick={() =>
                run(() => mutations.update.mutateAsync({ id: term.id, input: { label, colour } }))
              }
            >
              SAVE
            </button>
          ) : null}

          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              run(() =>
                mutations.update.mutateAsync({
                  id: term.id,
                  input: { archived: !term.archivedAt },
                }),
              )
            }
          >
            {term.archivedAt ? 'RESTORE' : 'ARCHIVE'}
          </button>

          {deletable ? (
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => run(() => mutations.remove.mutateAsync(term.id))}
            >
              DELETE
            </button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p className="taxonomy-message" role="alert">
          {message}
        </p>
      ) : null}
    </li>
  );
}

function NewTermForm({ kind, mutations }: { kind: TaxonomyKind; mutations: Mutations }) {
  const [label, setLabel] = useState('');
  const [colour, setColour] = useState(SWATCHES[0]);
  const [error, setError] = useState<string | null>(null);

  /**
   * The key is derived rather than typed. It is machine-facing and permanent,
   * and asking a marketing manager to invent a stable identifier is how you end
   * up with `NEW_KIND_2_FINAL`. They name the thing; the system names the row.
   */
  const key = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createTaxonomySchema.safeParse({ kind, key, label, colour, sortOrder: 999 });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the name.');
      return;
    }

    try {
      await mutations.create.mutateAsync(parsed.data);
      setLabel('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that.');
    }
  }

  return (
    <form className="taxonomy-new" onSubmit={submit}>
      <div className="taxonomy-new-fields">
        <label>
          ADD TO THIS LIST
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Community outreach"
          />
        </label>
        <div className="taxonomy-swatches" role="group" aria-label="Colour">
          {SWATCHES.map((value) => (
            <button
              key={value}
              type="button"
              style={{ background: value }}
              className={value === colour ? 'active' : ''}
              onClick={() => setColour(value)}
              aria-label={value}
              aria-pressed={value === colour}
            />
          ))}
        </div>
        <button className="create-button" type="submit" disabled={!label.trim()}>
          ADD <Icon name="arrow" />
        </button>
      </div>

      {key ? (
        <p className="taxonomy-key-preview">
          Saved as <code>{key}</code>. The name can be changed later, this cannot.
        </p>
      ) : null}

      {error ? (
        <p className="cms-alert" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
