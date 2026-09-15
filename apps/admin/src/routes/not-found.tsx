import { Link } from 'react-router-dom';
import { CmsState } from '../components/ui';

/**
 * Unknown CMS paths used to render the dashboard, so a typo, a stale bookmark
 * or a link to a page that has since moved looked like a successful navigation
 * to the Overview. Saying so is the whole point: a wrong address should be
 * visibly wrong, not quietly redirected somewhere plausible.
 */
export function CmsNotFoundPage() {
  return (
    <CmsState
      icon="search"
      title="That page is not here."
      description="The address may be mistyped, or the screen may have moved since the link was saved. Everything you have access to is in the sidebar."
      action={
        <Link className="create-button" to="/" style={{ textDecoration: 'none' }}>
          Back to the overview
        </Link>
      }
    />
  );
}
