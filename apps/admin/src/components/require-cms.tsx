import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Permission } from '@kode/contracts';
import { useAuth } from '../lib/auth-context';
import { Icon } from './icon';

/**
 * Gate for the CMS shell. The API enforces the same rules independently; this
 * exists so an unauthorised user sees an explanation instead of a broken screen.
 */
export function RequireCms({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: Permission;
}) {
  const { status, can, user } = useAuth();

  if (status === 'loading') {
    return (
      <div className="cms-auth">
        <div className="cms-auth-card" aria-busy="true">
          <h1>Checking access...</h1>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') return <Navigate to="/sign-in" replace />;

  if (permission && !can(permission)) {
    return (
      <div className="cms-state" role="alert">
        <span>
          <Icon name="lock" />
        </span>
        <b>Not available to your role</b>
        <p>
          {user?.displayName}, the {permission} permission is required here. Ask a Super Admin if
          you need it.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
