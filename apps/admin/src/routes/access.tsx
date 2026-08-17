import type { Scope } from '@kode/contracts';
import {
  ALL_ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
} from '@kode/contracts';
import { useRoleCatalogue } from '../lib/cms-api';
import { SectionLabel } from '../components/ui';

const SCOPE_LABEL: Record<Scope, string> = {
  global: 'Club-wide',
  department: 'Own department only',
  own: 'Own records only',
};

/**
 * A readable rendering of the permission model, generated from the same
 * `ROLE_PERMISSIONS` map the API enforces. It cannot drift from reality,
 * because it is not a separate description of the rules; it is the rules.
 */
export function AccessPage() {
  const catalogue = useRoleCatalogue();

  return (
    <section className="access-panel">
      <p className="eyebrow-admin">SUPER ADMIN CONTROL</p>
      <h2>
        Permission is
        <br />
        <strong>deliberate.</strong>
      </h2>
      <p>
        Roles are named bundles of permissions. The API checks permissions, never role names, so
        adding a capability is a single change in one shared file that the server and both frontends
        read.
      </p>

      <div style={{ marginTop: 40 }}>
        <SectionLabel>THE ROLE MODEL</SectionLabel>
        <div
          className="access-grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {ALL_ROLES.map((role) => (
            <article key={role}>
              <span>{SCOPE_LABEL[ROLE_SCOPE[role]].toUpperCase()}</span>
              <b>{ROLE_LABEL[role]}</b>
              <p>{ROLE_DESCRIPTION[role]}</p>
              <p
                style={{ marginTop: 12, fontSize: 10, color: 'var(--blue)', fontWeight: 800 }}
                className="tnum"
              >
                {ROLE_PERMISSIONS[role].length} PERMISSIONS
              </p>
            </article>
          ))}
          <article style={{ opacity: 0.75 }}>
            <span>NOT ELIGIBLE</span>
            <b>HR</b>
            <p>
              HR workflows remain in Odoo and are intentionally excluded from this system. There is
              no role here that grants HR access, by design.
            </p>
          </article>
        </div>
      </div>

      <div style={{ marginTop: 44 }}>
        <SectionLabel>WHAT EACH ROLE CAN DO</SectionLabel>
        <div style={{ display: 'grid', gap: 16 }}>
          {(catalogue.data?.roles ?? []).map((role) => (
            <div
              key={role.value}
              style={{ background: 'var(--panel)', border: '1px solid var(--line)', padding: 18 }}
            >
              <b style={{ fontSize: 14 }}>{role.label}</b>
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  margin: '6px 0 12px',
                  fontWeight: 500,
                }}
              >
                {role.description} Scope: {SCOPE_LABEL[role.scope]}.
              </p>
              <div className="permission-grid">
                {role.permissions.map((permission) => (
                  <label key={permission} data-inherited="true">
                    <input type="checkbox" checked readOnly disabled />
                    {permission}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 44 }}>
        <SectionLabel>HOW ACCESS IS ENFORCED</SectionLabel>
        <ul
          style={{
            fontSize: 12,
            lineHeight: 1.8,
            color: 'var(--muted)',
            fontWeight: 500,
            paddingLeft: 18,
            margin: 0,
          }}
        >
          <li>
            Every API route denies by default. A route is reachable only if it opts out with an
            explicit annotation.
          </li>
          <li>
            Guards check permissions, not role names, so a new endpoint cannot accidentally inherit
            the wrong rule.
          </li>
          <li>
            Department scope is checked against the row itself, in the service layer, because the
            guard cannot see the data.
          </li>
          <li>
            Publishing is a separate permission from editing, which is what makes the review step
            real rather than advisory.
          </li>
          <li>
            Changing a role, department or status revokes that person&apos;s refresh tokens
            immediately.
          </li>
          <li>
            Nobody can grant a role at or above their own rank, or a permission they do not hold.
          </li>
          <li>The last active Super Admin cannot be demoted, suspended or deactivated.</li>
          <li>What this screen hides is a courtesy. The server rejects the request regardless.</li>
        </ul>
      </div>
    </section>
  );
}
