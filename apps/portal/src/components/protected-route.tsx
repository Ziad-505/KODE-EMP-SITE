import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '@kode/contracts';
import { useAuth } from '../lib/auth-context';

/**
 * Client-side gate. It is a usability affordance, not a security control: the
 * API enforces the same permissions independently on every request, so a user
 * who edits their way past this screen still gets a 403 from the server.
 */
export function RequireAuth({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: Permission;
}) {
  const { status, can } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="state-block" aria-busy="true">
        <p>Checking your session...</p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  }

  if (permission && !can(permission)) {
    return (
      <div className="state-block" role="alert">
        <span>NO ACCESS</span>
        <h2>Not for you, yet.</h2>
        <p>
          Your account does not include access to this area. If you think that is wrong, ask a Super
          Admin to review your permissions.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
