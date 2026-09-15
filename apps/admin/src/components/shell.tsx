import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Permission, ROLE_LABEL, Scope, type Role } from '@kode/contracts';
import kMark from '../assets/kode-k-mark.png';
import { useAuth } from '../lib/auth-context';
import { RESOURCES } from '../lib/resources';
import { Icon, type IconName } from './icon';

interface NavEntry {
  label: string;
  to: string;
  icon: IconName;
  permission: Permission;
}

/**
 * The sidebar is derived from the actor's permissions, which come from the API
 * on every session load. Nothing is hard-coded per role, so granting a
 * permission is immediately visible in the navigation with no client change.
 *
 * Hiding an item is a courtesy, not a control: the API independently rejects a
 * request the actor is not entitled to make.
 */
const NAVIGATION: NavEntry[] = [
  { label: 'Overview', to: '/', icon: 'grid', permission: Permission.CMS_ACCESS },
  ...Object.values(RESOURCES).map((resource) => ({
    label: resource.plural,
    to: `/content/${resource.key}`,
    icon: resource.icon as IconName,
    permission: resource.permissions.read,
  })),
  { label: 'Useful links', to: '/links', icon: 'link', permission: Permission.LINK_READ },
  { label: 'Media library', to: '/media', icon: 'media', permission: Permission.MEDIA_READ },
  { label: 'People', to: '/people', icon: 'people', permission: Permission.USER_READ },
  { label: 'Activity trail', to: '/audit', icon: 'history', permission: Permission.AUDIT_READ },
  // Readable by any CMS user, because every editor needs to see the option
  // names. The API refuses writes without settings:manage.
  { label: 'Lists', to: '/lists', icon: 'settings', permission: Permission.CMS_ACCESS },
  // Your own sign-in, not an administrative screen: nobody can enrol or remove
  // a second factor on someone else's behalf.
  { label: 'Your sign-in', to: '/security', icon: 'settings', permission: Permission.CMS_ACCESS },
  {
    label: 'System access',
    to: '/access',
    icon: 'settings',
    permission: Permission.SETTINGS_MANAGE,
  },
];

export function AdminShell() {
  const { user, can } = useAuth();
  const location = useLocation();

  const current = NAVIGATION.find((entry) =>
    entry.to === '/' ? location.pathname === '/' : location.pathname.startsWith(entry.to),
  );

  if (!user) return null;

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#cms-main">
        Skip to content
      </a>

      <aside className="admin-sidebar">
        <div className="cms-lockup">
          <img src={kMark} alt="" />
          <div>
            <b>KODE CMS</b>
            <span>SPORTS CLUB</span>
          </div>
        </div>
        <div className="cms-rule" />

        <nav aria-label="Sections">
          {NAVIGATION.map((entry) => {
            const allowed = can(entry.permission);
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : '')}
                aria-disabled={!allowed}
                onClick={(event) => {
                  if (!allowed) event.preventDefault();
                }}
                style={allowed ? undefined : { opacity: 0.45, cursor: 'not-allowed' }}
                title={allowed ? undefined : 'Your role does not include this area'}
              >
                <Icon name={entry.icon} />
                <span>{entry.label}</span>
                {!allowed ? <em>LOCKED</em> : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <RoleTicket role={user.role} scope={user.departmentName} />
          <p>
            HR workflows stay in Odoo.
            <br />
            CMS access is never granted to HR.
          </p>
        </div>
      </aside>

      <main className="admin-main">
        <Topbar title={current?.label ?? 'KODE CMS'} />
        <div className="admin-content" id="cms-main">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function RoleTicket({ role, scope }: { role: Role; scope: string | null }) {
  const initials = ROLE_LABEL[role]
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="role-ticket">
      <span className={role === 'SUPER_ADMIN' ? 'super' : 'marketing'}>{initials}</span>
      <div>
        <b>{ROLE_LABEL[role]}</b>
        <small>{scope ? `${scope} scope` : 'Club-wide'}</small>
      </div>
    </div>
  );
}

function Topbar({ title }: { title: string }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const scope = user.role === 'DEPARTMENT_EDITOR' ? Scope.Department : Scope.Global;

  return (
    <header className="admin-topbar">
      <div>
        <p>KODE CONTENT OPERATIONS</p>
        <h1>{title}</h1>
      </div>

      <div className="topbar-actions">
        <span className="role-pill">
          SIGNED IN AS <b>{ROLE_LABEL[user.role].toUpperCase()}</b>
        </span>

        <div className="topbar-user" ref={container}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            {user.firstName}
          </button>

          {open ? (
            <div className="topbar-menu" role="menu">
              <p>
                {user.displayName}
                <small>
                  {user.email} ·{' '}
                  {scope === Scope.Department
                    ? (user.departmentName ?? 'No department')
                    : 'Club-wide'}
                </small>
              </p>
              <a href={import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:5173'} role="menuitem">
                <Icon name="external" size={14} /> Open the employee portal
              </a>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await signOut();
                  navigate('/sign-in');
                }}
              >
                <Icon name="logout" size={14} /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
