/** Small pieces reused across the inner pages. */

export function InnerBanner({ title, description }: { title: string; description: string }) {
  return (
    <section className="inner-banner">
      <p className="micro-label">KODE / EMPLOYEE PORTAL</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="banner-shape" aria-hidden="true" />
    </section>
  );
}

/**
 * Renders stored copy as paragraphs.
 *
 * Text is split and rendered as React children, never injected as HTML. Content
 * comes from authenticated CMS users rather than the public, but "trusted
 * author" is not a reason to hand an editor a stored-XSS primitive.
 */
export function RichText({ text }: { text: string }) {
  return (
    <div className="article-body">
      {text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  );
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}
