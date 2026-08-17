import { useRef, useState } from 'react';
import { DEFAULT_MAX_UPLOAD_BYTES, Permission } from '@kode/contracts';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import { useDeleteMedia, useMedia, useUploadMedia, useMediaLimits } from '../lib/cms-api';
import { Icon } from '../components/icon';
import {
  CmsError,
  CmsPagination,
  CmsState,
  SectionLabel,
  TableSkeleton,
  formatDate,
} from '../components/ui';

export function MediaPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<'image' | 'document' | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const list = useMedia({
    page,
    pageSize: 24,
    ...(term ? { q: term } : {}),
    ...(kind ? { kind } : {}),
  });
  const upload = useUploadMedia();
  // Falls back to the contracts default only until the request resolves, so a
  // drop in the first few hundred milliseconds still gets a sane guard.
  const limits = useMediaLimits();
  const maxUploadBytes = limits.data?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const remove = useDeleteMedia();

  const canUpload = can(Permission.MEDIA_UPLOAD);
  const canDelete = can(Permission.MEDIA_DELETE);
  const selected = list.data?.items.find((item) => item.id === selectedId) ?? null;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setMessage(null);
    for (const file of Array.from(files)) {
      if (file.size > maxUploadBytes) {
        setMessage({ tone: 'error', text: `${file.name} is larger than the upload limit.` });
        continue;
      }
      try {
        await upload.mutateAsync(file);
        setMessage({ tone: 'success', text: `${file.name} uploaded.` });
      } catch (error) {
        setMessage({
          tone: 'error',
          text:
            error instanceof ApiError
              ? `${file.name}: ${error.message}`
              : `${file.name} could not be uploaded.`,
        });
      }
    }
  }

  return (
    <section className="media-library">
      <div className="media-intro">
        <div>
          <p className="eyebrow-admin">A SINGLE SOURCE OF VISUAL TRUTH</p>
          <h2>
            Media with
            <br />
            <strong>its place.</strong>
          </h2>
        </div>
        {canUpload ? (
          <button
            className="create-button"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" />
            UPLOAD MEDIA
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          className="cms-alert"
          data-tone={message.tone === 'success' ? 'success' : undefined}
          role="status"
          style={{ marginBottom: 14 }}
        >
          {message.text}
        </p>
      ) : null}

      {canUpload ? (
        <div
          className="media-drop"
          data-active={dragging}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(event.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={22} />
          <p>
            Drop files here, or choose them. Images and documents up to{' '}
            {Math.round(maxUploadBytes / 1024 / 1024)} MB. File contents are verified against their
            declared type on upload.
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? 'UPLOADING...' : 'CHOOSE FILES'}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      ) : null}

      <div className="module-toolbar" style={{ marginBottom: 14 }}>
        <div>
          {(['All', 'image', 'document'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={(value === 'All' ? undefined : value) === kind ? 'active' : ''}
              aria-pressed={(value === 'All' ? undefined : value) === kind}
              onClick={() => {
                setKind(value === 'All' ? undefined : value);
                setPage(1);
              }}
            >
              {value === 'All' ? 'All' : value === 'image' ? 'Images' : 'Documents'}
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
          placeholder="Search media"
          aria-label="Search media"
          style={{
            border: '1px solid var(--line)',
            background: '#fff',
            padding: '8px 10px',
            fontSize: 11,
            minWidth: 200,
          }}
        />
      </div>

      {list.error ? (
        <CmsError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <TableSkeleton rows={3} />
      ) : list.data && list.data.items.length ? (
        <>
          <div className="media-grid">
            {list.data.items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`media-tile media-${index % 6} ${selectedId === item.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                aria-pressed={selectedId === item.id}
              >
                {item.kind === 'image' ? (
                  <img className="media-thumb" src={item.url} alt="" loading="lazy" />
                ) : null}
                <span>{item.kind === 'image' ? 'IMAGE' : 'DOCUMENT'}</span>
                <b>{item.filename}</b>
                {selectedId === item.id ? (
                  <i>
                    <Icon name="check" />
                  </i>
                ) : null}
              </button>
            ))}
          </div>

          <CmsPagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />

          {selected ? (
            <div className="media-inspector">
              <span className="media-preview">
                {selected.kind === 'image' ? (
                  <img
                    src={selected.url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <Icon name="media" />
                )}
              </span>
              <div>
                <p>SELECTED ASSET</p>
                <h3>{selected.filename}</h3>
                <span className="tnum">
                  {selected.mimeType} · {(selected.size / 1024 / 1024).toFixed(2)} MB
                  {selected.width ? ` · ${selected.width}×${selected.height}` : ''} ·{' '}
                  {selected.uploadedBy?.displayName ?? 'Unknown'} · {formatDate(selected.createdAt)}
                </span>
              </div>
              <div className="table-actions">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(selected.url)}
                >
                  <Icon name="link" /> COPY URL
                </button>
                <a
                  className="secondary-button"
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    textDecoration: 'none',
                    padding: '7px 9px',
                  }}
                >
                  <Icon name="eye" size={12} /> OPEN
                </a>
                {canDelete ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={remove.isPending}
                    onClick={async () => {
                      try {
                        await remove.mutateAsync(selected.id);
                        setSelectedId(null);
                        setMessage({ tone: 'success', text: 'File deleted.' });
                      } catch (error) {
                        setMessage({
                          tone: 'error',
                          text:
                            error instanceof ApiError
                              ? error.message
                              : 'Could not delete that file.',
                        });
                      }
                    }}
                  >
                    <Icon name="trash" /> DELETE
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <CmsState
          icon="media"
          title="No media yet"
          description="Upload the images and documents the portal needs. Duplicate uploads are detected by checksum and stored once."
        />
      )}

      <div style={{ marginTop: 26 }}>
        <SectionLabel>UPLOAD RULES</SectionLabel>
        <p
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            lineHeight: 1.7,
            fontWeight: 500,
            margin: 0,
          }}
        >
          Accepted: JPEG, PNG, WebP, AVIF, GIF, PDF, Word and Excel. SVG is deliberately refused
          because it can carry script. The server checks each file&apos;s leading bytes against the
          type the browser declared and rejects mismatches.
        </p>
      </div>
    </section>
  );
}
