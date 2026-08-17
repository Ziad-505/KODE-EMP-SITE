import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission, Role } from '@kode/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSIONS = 'auth:permissions';
export const PERMISSION_MODE = 'auth:permission-mode';
export const REQUIRED_ROLES = 'auth:roles';

/**
 * Marks a route as reachable without authentication.
 *
 * The global guard denies by default, so forgetting a decorator fails closed.
 * That is deliberate: the failure mode of a missing annotation should be a
 * locked door, not an open one.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Requires at least one of the listed permissions. */
export function RequireAnyPermission(...permissions: Permission[]) {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(REQUIRED_PERMISSIONS, permissions)(target, key as string, descriptor!);
    SetMetadata(PERMISSION_MODE, 'any')(target, key as string, descriptor!);
  };
}

/**
 * Role checks are a blunt instrument. Prefer RequirePermissions; reach for this
 * only where the rule genuinely is "this role and no other".
 */
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** Injects the authenticated user, or a single property of it. */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return property ? user[property] : user;
  },
);
