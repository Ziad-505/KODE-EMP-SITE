/**
 * Single source of truth for authorization.
 *
 * The API and both frontends import this file. There is no second place where a
 * role is mapped to what it can do, which is what keeps the UI and the server
 * from ever disagreeing about permissions.
 *
 * Design notes:
 *  - Guards check PERMISSIONS, never roles. Roles are only a named bundle of
 *    permissions, so adding a capability is a one-line change here.
 *  - Some permissions are additionally SCOPED (see `Scope`). Holding
 *    `news:update` with `Scope.Department` means "only rows whose departmentId
 *    matches mine". Scope is enforced server-side in the service layer, not in
 *    the guard, because it needs the row.
 *  - HR is deliberately absent. HR workflows live in Odoo; there is no role in
 *    this system that grants HR access, by design.
 */

export const Role = {
  /** Full system authority: roles, users, settings, audit, everything below. */
  SUPER_ADMIN: 'SUPER_ADMIN',
  /** Marketing. Creates, edits and publishes all portal content, org-wide. */
  CONTENT_MANAGER: 'CONTENT_MANAGER',
  /** Creates and edits org-wide content, but cannot publish. Submits for review. */
  CONTENT_EDITOR: 'CONTENT_EDITOR',
  /** Manages content scoped to their own department only. */
  DEPARTMENT_EDITOR: 'DEPARTMENT_EDITOR',
  /** Reads the employee portal and raises support tickets. No CMS access. */
  EMPLOYEE: 'EMPLOYEE',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES = Object.values(Role) as readonly Role[];

/** Ordered most privileged first. Used for UI sorting and for role-elevation checks. */
export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 100,
  CONTENT_MANAGER: 70,
  CONTENT_EDITOR: 50,
  DEPARTMENT_EDITOR: 40,
  EMPLOYEE: 10,
};

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  CONTENT_MANAGER: 'Content Manager',
  CONTENT_EDITOR: 'Content Editor',
  DEPARTMENT_EDITOR: 'Department Editor',
  EMPLOYEE: 'Employee',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  SUPER_ADMIN: 'Full system authority: people, permissions, settings and the audit trail.',
  CONTENT_MANAGER:
    'Creates, edits and publishes every kind of portal content, across all departments.',
  CONTENT_EDITOR: 'Creates and edits content across the club, then submits it for review.',
  DEPARTMENT_EDITOR: 'Manages content that belongs to their own department only.',
  EMPLOYEE: 'Reads the employee portal and raises IT support requests.',
};

/**
 * Permission strings are `resource:action`. Keep them additive: never reuse a
 * string for a different meaning, and never delete one without a migration that
 * strips it from any custom grants.
 */
export const Permission = {
  NEWS_READ: 'news:read',
  NEWS_CREATE: 'news:create',
  NEWS_UPDATE: 'news:update',
  NEWS_DELETE: 'news:delete',
  NEWS_PUBLISH: 'news:publish',

  EVENT_READ: 'event:read',
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:delete',
  EVENT_PUBLISH: 'event:publish',

  POLICY_READ: 'policy:read',
  POLICY_CREATE: 'policy:create',
  POLICY_UPDATE: 'policy:update',
  POLICY_DELETE: 'policy:delete',
  POLICY_PUBLISH: 'policy:publish',

  FAQ_READ: 'faq:read',
  FAQ_CREATE: 'faq:create',
  FAQ_UPDATE: 'faq:update',
  FAQ_DELETE: 'faq:delete',
  FAQ_PUBLISH: 'faq:publish',

  GALLERY_READ: 'gallery:read',
  GALLERY_CREATE: 'gallery:create',
  GALLERY_UPDATE: 'gallery:update',
  GALLERY_DELETE: 'gallery:delete',
  GALLERY_PUBLISH: 'gallery:publish',

  LINK_READ: 'link:read',
  LINK_MANAGE: 'link:manage',

  MEDIA_READ: 'media:read',
  MEDIA_UPLOAD: 'media:upload',
  MEDIA_DELETE: 'media:delete',

  DIRECTORY_READ: 'directory:read',
  DIRECTORY_MANAGE: 'directory:manage',

  TICKET_CREATE: 'ticket:create',
  TICKET_READ_OWN: 'ticket:read:own',
  TICKET_READ_ALL: 'ticket:read:all',
  TICKET_MANAGE: 'ticket:manage',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',
  USER_ASSIGN_ROLE: 'user:assign-role',

  DEPARTMENT_MANAGE: 'department:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_READ: 'audit:read',
  /** Access to the CMS application at all. Checked once at the admin shell. */
  CMS_ACCESS: 'cms:access',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS = Object.values(Permission) as readonly Permission[];

/** How far a granted permission reaches. */
export const Scope = {
  /** Applies to every row of the resource. */
  Global: 'global',
  /** Applies only to rows whose departmentId equals the actor's departmentId. */
  Department: 'department',
  /** Applies only to rows the actor created. */
  Own: 'own',
} as const;

export type Scope = (typeof Scope)[keyof typeof Scope];

const CONTENT_RESOURCES = ['news', 'event', 'policy', 'faq', 'gallery'] as const;

function contentPermissions(actions: readonly string[]): Permission[] {
  return CONTENT_RESOURCES.flatMap((resource) =>
    actions.map((action) => `${resource}:${action}` as Permission),
  );
}

const EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  Permission.NEWS_READ,
  Permission.EVENT_READ,
  Permission.POLICY_READ,
  Permission.FAQ_READ,
  Permission.GALLERY_READ,
  Permission.LINK_READ,
  Permission.DIRECTORY_READ,
  Permission.TICKET_CREATE,
  Permission.TICKET_READ_OWN,
];

const DEPARTMENT_EDITOR_PERMISSIONS: readonly Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  Permission.CMS_ACCESS,
  ...contentPermissions(['create', 'update']),
  Permission.MEDIA_READ,
  Permission.MEDIA_UPLOAD,
];

const CONTENT_EDITOR_PERMISSIONS: readonly Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  Permission.CMS_ACCESS,
  ...contentPermissions(['create', 'update']),
  Permission.MEDIA_READ,
  Permission.MEDIA_UPLOAD,
  Permission.DIRECTORY_READ,
];

const CONTENT_MANAGER_PERMISSIONS: readonly Permission[] = [
  ...CONTENT_EDITOR_PERMISSIONS,
  ...contentPermissions(['delete', 'publish']),
  Permission.LINK_MANAGE,
  Permission.MEDIA_DELETE,
  Permission.DIRECTORY_MANAGE,
  Permission.TICKET_READ_ALL,
];

const SUPER_ADMIN_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS;

/**
 * The role → permission map. This is the only place this mapping exists.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
  CONTENT_MANAGER: dedupe(CONTENT_MANAGER_PERMISSIONS),
  CONTENT_EDITOR: dedupe(CONTENT_EDITOR_PERMISSIONS),
  DEPARTMENT_EDITOR: dedupe(DEPARTMENT_EDITOR_PERMISSIONS),
  EMPLOYEE: dedupe(EMPLOYEE_PERMISSIONS),
};

/**
 * Which scope each role gets for the permissions it holds. A role not listed for
 * a resource defaults to `Scope.Global` for the permissions it has at all.
 */
export const ROLE_SCOPE: Record<Role, Scope> = {
  SUPER_ADMIN: Scope.Global,
  CONTENT_MANAGER: Scope.Global,
  CONTENT_EDITOR: Scope.Global,
  DEPARTMENT_EDITOR: Scope.Department,
  EMPLOYEE: Scope.Own,
};

function dedupe(values: readonly Permission[]): readonly Permission[] {
  return Object.freeze([...new Set(values)]);
}

export interface ActorLike {
  role: Role;
  departmentId: string | null;
  /** Extra permissions granted directly to this user on top of their role. */
  extraPermissions?: readonly Permission[];
}

/** Every permission an actor effectively holds. */
export function permissionsFor(actor: ActorLike): readonly Permission[] {
  return dedupe([...ROLE_PERMISSIONS[actor.role], ...(actor.extraPermissions ?? [])]);
}

export function hasPermission(actor: ActorLike, permission: Permission): boolean {
  return permissionsFor(actor).includes(permission);
}

export function hasAllPermissions(actor: ActorLike, permissions: readonly Permission[]): boolean {
  const held = permissionsFor(actor);
  return permissions.every((permission) => held.includes(permission));
}

export function hasAnyPermission(actor: ActorLike, permissions: readonly Permission[]): boolean {
  const held = permissionsFor(actor);
  return permissions.some((permission) => held.includes(permission));
}

export function scopeFor(actor: ActorLike): Scope {
  return ROLE_SCOPE[actor.role];
}

/**
 * Row-level check. `resourceDepartmentId` is null for org-wide content.
 * Department-scoped actors may only touch their own department's rows; org-wide
 * rows are readable by everyone but writable only by global-scope actors.
 */
export function canActOnDepartment(actor: ActorLike, resourceDepartmentId: string | null): boolean {
  const scope = scopeFor(actor);
  if (scope === Scope.Global) return true;
  if (scope === Scope.Department) {
    return actor.departmentId !== null && actor.departmentId === resourceDepartmentId;
  }
  return false;
}

/**
 * Role elevation guard: an actor may never grant a role at or above their own
 * rank, which stops a Content Manager from minting a Super Admin.
 */
export function canAssignRole(actor: ActorLike, target: Role): boolean {
  if (!hasPermission(actor, Permission.USER_ASSIGN_ROLE)) return false;
  if (actor.role === Role.SUPER_ADMIN) return true;
  return ROLE_RANK[target] < ROLE_RANK[actor.role];
}
