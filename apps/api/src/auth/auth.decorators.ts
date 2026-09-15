import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@kode/contracts';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSIONS = 'auth:permissions';

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

/*
 * `RequireRoles` and `RequireAnyPermission` used to live here. Both were
 * exported and applied to no route, so their branches in jwt-auth.guard.ts were
 * unreachable — untested code inside the one guard that decides who may do
 * what.
 *
 * `RequireRoles` in particular is not worth keeping available: it matched on
 * role names, which is the exact coupling this permission model exists to
 * avoid. Leaving it exported was an invitation to reintroduce that. If a rule
 * genuinely needs "any of these permissions", add it back deliberately, with a
 * route using it and a test covering it.
 */

/** Injects the authenticated user, or a single property of it. */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return property ? user[property] : user;
  },
);
