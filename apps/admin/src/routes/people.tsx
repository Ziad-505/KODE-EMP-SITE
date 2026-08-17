import { useMemo, useState, type FormEvent } from 'react';
import {
  ALL_ROLES,
  Permission,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  Role,
  UserStatus,
  createUserSchema,
  type UserDto,
} from '@kode/contracts';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../lib/auth-context';
import {
  useCreateUser,
  useDeactivateUser,
  useDepartments,
  useResetUserPassword,
  useUpdateUser,
  useUsers,
} from '../lib/cms-api';
import { Icon } from '../components/icon';
import {
  CmsError,
  CmsPagination,
  CmsState,
  Field,
  SectionLabel,
  TableSkeleton,
  formatDateTime,
} from '../components/ui';

export function PeoplePage() {
  const { user: actor, can } = useAuth();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | undefined>(undefined);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );

  const list = useUsers({
    page,
    pageSize: 20,
    ...(term ? { q: term } : {}),
    ...(roleFilter ? { role: roleFilter } : {}),
  });
  const departments = useDepartments();
  const updateUser = useUpdateUser();
  const resetPassword = useResetUserPassword();
  const deactivate = useDeactivateUser();

  const canCreate = can(Permission.USER_CREATE);
  const canUpdate = can(Permission.USER_UPDATE);
  const canDeactivate = can(Permission.USER_DEACTIVATE);

  /** Nobody may grant a role at or above their own rank. */
  const assignableRoles = useMemo(
    () =>
      ALL_ROLES.filter((role) =>
        actor?.role === Role.SUPER_ADMIN
          ? true
          : ROLE_RANK[role] < ROLE_RANK[actor?.role ?? Role.EMPLOYEE],
      ),
    [actor?.role],
  );

  return (
    <>
      {banner ? (
        <p
          className="cms-alert"
          data-tone={banner.tone === 'error' ? undefined : banner.tone}
          role="status"
          style={{ marginBottom: 16 }}
        >
          {banner.text}
        </p>
      ) : null}

      <div className="module-intro">
        <div>
          <p className="eyebrow-admin">PEOPLE AND PERMISSIONS</p>
          <h2>Access is deliberate.</h2>
          <p>
            Roles decide what someone can do. Changing a role or department ends that person&apos;s
            sessions immediately, so a revoked privilege never lingers on an old token.
          </p>
        </div>
        {canCreate ? (
          <button className="create-button" type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            ADD PERSON
          </button>
        ) : null}
      </div>

      <div className="module-toolbar">
        <div>
          <button
            type="button"
            className={roleFilter === undefined ? 'active' : ''}
            onClick={() => {
              setRoleFilter(undefined);
              setPage(1);
            }}
          >
            All
          </button>
          {ALL_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              className={roleFilter === role ? 'active' : ''}
              onClick={() => {
                setRoleFilter(role);
                setPage(1);
              }}
            >
              {ROLE_LABEL[role]}
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
          placeholder="Search people"
          aria-label="Search people"
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
        <TableSkeleton />
      ) : list.data && list.data.items.length ? (
        <>
          <div className="people-table">
            <div className="people-row people-head">
              <span>PERSON</span>
              <span>ROLE</span>
              <span>DEPARTMENT</span>
              <span>LAST SIGN-IN</span>
              <span />
            </div>

            {list.data.items.map((person) => (
              <div className="people-row" key={person.id}>
                <div>
                  <b>{person.displayName}</b>
                  <small>
                    {person.email}
                    {person.status !== UserStatus.ACTIVE ? ` · ${person.status.toLowerCase()}` : ''}
                    {person.provider === 'ENTRA_ID' ? ' · Microsoft' : ''}
                  </small>
                </div>
                <span className="role-badge" data-role={person.role}>
                  {ROLE_LABEL[person.role].toUpperCase()}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>
                  {person.department?.name ?? 'Club-wide'}
                </span>
                <span
                  className="tnum"
                  style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}
                >
                  {person.lastLoginAt ? formatDateTime(person.lastLoginAt) : 'Never'}
                </span>
                <div className="table-actions">
                  {canUpdate ? (
                    <button type="button" onClick={() => setEditing(person)}>
                      <Icon name="edit" /> EDIT
                    </button>
                  ) : null}
                  {canUpdate && person.provider === 'LOCAL' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const result = await resetPassword.mutateAsync(person.id);
                          setBanner({
                            tone: 'info',
                            text: `Temporary password for ${person.displayName}: ${result.temporaryPassword} — share it over a trusted channel. They must change it at first sign-in and all their sessions have ended.`,
                          });
                        } catch (error) {
                          setBanner({
                            tone: 'error',
                            text:
                              error instanceof ApiError
                                ? error.message
                                : 'Could not reset that password.',
                          });
                        }
                      }}
                    >
                      <Icon name="key" /> RESET PASSWORD
                    </button>
                  ) : null}
                  {canDeactivate && person.id !== actor?.id ? (
                    <button
                      type="button"
                      className="danger"
                      onClick={async () => {
                        try {
                          await deactivate.mutateAsync(person.id);
                          setBanner({
                            tone: 'success',
                            text: `${person.displayName} deactivated and signed out everywhere.`,
                          });
                        } catch (error) {
                          setBanner({
                            tone: 'error',
                            text:
                              error instanceof ApiError
                                ? error.message
                                : 'Could not deactivate that account.',
                          });
                        }
                      }}
                    >
                      <Icon name="trash" /> DEACTIVATE
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <CmsPagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : (
        <CmsState
          icon="people"
          title="Nobody found"
          description="Try a different search or role filter."
        />
      )}

      {creating ? (
        <CreatePersonDrawer
          assignableRoles={assignableRoles}
          departments={(departments.data ?? []).map((department) => ({
            id: department.id,
            name: department.name,
          }))}
          onClose={() => setCreating(false)}
          onCreated={(text) => {
            setBanner({ tone: 'info', text });
            setCreating(false);
          }}
        />
      ) : null}

      {editing ? (
        <EditPersonDrawer
          person={editing}
          assignableRoles={assignableRoles}
          departments={(departments.data ?? []).map((department) => ({
            id: department.id,
            name: department.name,
          }))}
          isSelf={editing.id === actor?.id}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setBanner({ tone: 'success', text });
            setEditing(null);
          }}
          save={(input) => updateUser.mutateAsync({ id: editing.id, input })}
        />
      ) : null}
    </>
  );
}

interface DrawerProps {
  assignableRoles: Role[];
  departments: { id: string; name: string }[];
  onClose: () => void;
}

function CreatePersonDrawer({
  assignableRoles,
  departments,
  onClose,
  onCreated,
}: DrawerProps & { onCreated: (text: string) => void }) {
  const createUser = useCreateUser();
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    role: assignableRoles[assignableRoles.length - 1] ?? Role.EMPLOYEE,
    departmentId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = createUserSchema.safeParse({
      ...form,
      jobTitle: form.jobTitle || null,
      departmentId: form.departmentId || null,
      extraPermissions: [],
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
      const result = await createUser.mutateAsync(parsed.data);
      onCreated(
        result.temporaryPassword
          ? `Created ${result.user.displayName}. Temporary password: ${result.temporaryPassword} — share it over a trusted channel; they must change it at first sign-in.`
          : `Created ${result.user.displayName}.`,
      );
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not create that account.');
    }
  }

  return (
    <Drawer title="New person" onClose={onClose}>
      <form className="cms-form" onSubmit={onSubmit} noValidate>
        {formError ? (
          <p className="cms-alert" role="alert">
            {formError}
          </p>
        ) : null}

        <Field label="WORK EMAIL" error={errors.email}>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </Field>
        <Field label="FIRST NAME" error={errors.firstName}>
          <input
            value={form.firstName}
            onChange={(event) => setForm({ ...form, firstName: event.target.value })}
            required
          />
        </Field>
        <Field label="LAST NAME" error={errors.lastName}>
          <input
            value={form.lastName}
            onChange={(event) => setForm({ ...form, lastName: event.target.value })}
            required
          />
        </Field>
        <Field label="JOB TITLE" error={errors.jobTitle}>
          <input
            value={form.jobTitle}
            onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
          />
        </Field>
        <Field label="ROLE" error={errors.role} hint={ROLE_DESCRIPTION[form.role]}>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
          >
            {assignableRoles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="DEPARTMENT"
          error={errors.departmentId}
          hint="Required for a Department Editor."
        >
          <select
            value={form.departmentId}
            onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>

        <p className="cms-alert" data-tone="info">
          A strong temporary password is generated and shown once. The account must change it at
          first sign-in.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="secondary-button" type="button" onClick={onClose}>
            CANCEL
          </button>
          <button className="create-button" type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? 'CREATING...' : 'CREATE ACCOUNT'} <Icon name="arrow" />
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function EditPersonDrawer({
  person,
  assignableRoles,
  departments,
  isSelf,
  onClose,
  onSaved,
  save,
}: DrawerProps & {
  person: UserDto;
  isSelf: boolean;
  onSaved: (text: string) => void;
  save: (input: Record<string, unknown>) => Promise<unknown>;
}) {
  const [role, setRole] = useState<Role>(person.role);
  const [departmentId, setDepartmentId] = useState(person.department?.id ?? '');
  const [status, setStatus] = useState(person.status);
  const [jobTitle, setJobTitle] = useState(person.jobTitle ?? '');
  const [extra, setExtra] = useState<Permission[]>(person.extraPermissions);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inherited = new Set(ROLE_PERMISSIONS[role]);
  const grantable = Object.values(Permission).filter((permission) => !inherited.has(permission));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await save({
        role,
        departmentId: departmentId || null,
        status,
        jobTitle: jobTitle || null,
        extraPermissions: extra,
      });
      onSaved(
        `${person.displayName} updated. Their sessions have been ended so the change takes effect now.`,
      );
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not save those changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title={person.displayName} onClose={onClose}>
      <form className="cms-form" onSubmit={onSubmit} noValidate>
        {formError ? (
          <p className="cms-alert" role="alert">
            {formError}
          </p>
        ) : null}
        {isSelf ? (
          <p className="cms-alert" data-tone="info">
            This is your own account. You cannot change your own role.
          </p>
        ) : null}

        <Field label="JOB TITLE">
          <input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
        </Field>

        <Field label="ROLE" hint={ROLE_DESCRIPTION[role]}>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            disabled={isSelf}
          >
            {[...new Set([person.role, ...assignableRoles])].map((value) => (
              <option
                key={value}
                value={value}
                disabled={!assignableRoles.includes(value) && value !== person.role}
              >
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="DEPARTMENT">
          <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ACCOUNT STATUS">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as UserStatus)}
            disabled={isSelf}
          >
            {Object.values(UserStatus).map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <SectionLabel>ADDITIONAL PERMISSIONS</SectionLabel>
          <p style={{ fontSize: 10, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.6 }}>
            Anything already granted by the {ROLE_LABEL[role]} role is shown greyed out. You cannot
            grant a permission you do not hold yourself.
          </p>
          <div className="permission-grid">
            {[...inherited].map((permission) => (
              <label key={permission} data-inherited="true">
                <input type="checkbox" checked readOnly disabled />
                {permission}
              </label>
            ))}
            {grantable.map((permission) => (
              <label key={permission}>
                <input
                  type="checkbox"
                  checked={extra.includes(permission)}
                  onChange={(event) =>
                    setExtra((current) =>
                      event.target.checked
                        ? [...current, permission]
                        : current.filter((value) => value !== permission),
                    )
                  }
                />
                {permission}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="secondary-button" type="button" onClick={onClose}>
            CANCEL
          </button>
          <button className="create-button" type="submit" disabled={saving}>
            {saving ? 'SAVING...' : 'SAVE CHANGES'} <Icon name="arrow" />
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="composer-backdrop" onMouseDown={onClose}>
      <aside
        className="composer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <p>PEOPLE</p>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div style={{ padding: 27, overflowY: 'auto', maxHeight: 'calc(100dvh - 88px)' }}>
          {children}
        </div>
      </aside>
    </div>
  );
}
