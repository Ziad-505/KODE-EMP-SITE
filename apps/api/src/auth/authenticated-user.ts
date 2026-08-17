import {
  Permission,
  Role,
  canActOnDepartment,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  permissionsFor,
  scopeFor,
  type ActorLike,
  type Scope,
} from '@kode/contracts';

/**
 * The actor attached to every authenticated request.
 *
 * It is a class rather than a plain object so authorization questions are asked
 * of the actor itself (`user.can(...)`) instead of being re-derived at each call
 * site, which is how checks drift apart.
 */
export class AuthenticatedUser implements ActorLike {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly departmentId: string | null;
  readonly extraPermissions: readonly Permission[];
  readonly sessionId: string;

  constructor(input: {
    id: string;
    email: string;
    role: Role;
    departmentId: string | null;
    extraPermissions: readonly Permission[];
    sessionId: string;
  }) {
    this.id = input.id;
    this.email = input.email;
    this.role = input.role;
    this.departmentId = input.departmentId;
    this.extraPermissions = input.extraPermissions;
    this.sessionId = input.sessionId;
  }

  get permissions(): readonly Permission[] {
    return permissionsFor(this);
  }

  get scope(): Scope {
    return scopeFor(this);
  }

  get isSuperAdmin(): boolean {
    return this.role === Role.SUPER_ADMIN;
  }

  can(permission: Permission): boolean {
    return hasPermission(this, permission);
  }

  canAll(permissions: readonly Permission[]): boolean {
    return hasAllPermissions(this, permissions);
  }

  canAny(permissions: readonly Permission[]): boolean {
    return hasAnyPermission(this, permissions);
  }

  /** Row-level department check. See `canActOnDepartment` in @kode/contracts. */
  canActOn(resourceDepartmentId: string | null): boolean {
    return canActOnDepartment(this, resourceDepartmentId);
  }
}
