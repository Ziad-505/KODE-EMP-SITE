import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Permission, Role } from '@kode/contracts';
import type { Request } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { RequestContextStore } from '../common/request-context';
import {
  IS_PUBLIC,
  PERMISSION_MODE,
  REQUIRED_PERMISSIONS,
  REQUIRED_ROLES,
} from './auth.decorators';
import { AuthenticatedUser } from './authenticated-user';
import type { AccessTokenPayload } from './jwt-payload';
import { ACCESS_COOKIE } from './cookie.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How long a suspension or deactivation may take to be noticed, in ms.
 *
 * Access tokens live 15 minutes and carry role, department and permissions as
 * claims, so until now deactivating someone left them fully privileged until
 * their token expired: revoking refresh tokens stops them getting a *new*
 * access token but does nothing to the one already in their browser. An admin
 * removing a leaver at 09:00 was really removing them at 09:15.
 *
 * A database read on every request would fix it and would also undo the point
 * of stateless tokens. This caches the account's live status for a few seconds
 * instead, which bounds the window to seconds rather than a quarter of an hour
 * at roughly one query per user per window.
 */
const ACCOUNT_CHECK_TTL_MS = 15_000;

interface AccountSnapshot {
  checkedAt: number;
  active: boolean;
}

/**
 * The single authentication and authorization gate. Registered globally in
 * AppModule with APP_GUARD, so every route is protected unless it opts out with
 * @Public(). Authorization is permission-based; see auth.decorators.ts.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Keyed by user id. Bounded by the number of people signed in at once. */
  private readonly accounts = new Map<string, AccountSnapshot>();

  /**
   * True if the account behind this token is still allowed to hold a session.
   * The claims themselves are not forgeable; what they can be is stale.
   */
  private async accountIsActive(userId: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.accounts.get(userId);
    if (cached && now - cached.checkedAt < ACCOUNT_CHECK_TTL_MS) return cached.active;

    const row = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: { not: 'SUSPENDED' } },
      select: { id: true },
    });
    const active = row !== null;
    this.accounts.set(userId, { checkedAt: now, active });

    // The map would otherwise grow for the lifetime of the process. Entries are
    // tiny, but a long-running replica should not accumulate every account that
    // ever signed in.
    if (this.accounts.size > 5_000) {
      for (const [key, value] of this.accounts) {
        if (now - value.checkedAt >= ACCOUNT_CHECK_TTL_MS) this.accounts.delete(key);
      }
    }
    return active;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Session expired');
    }

    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }

    const user = new AuthenticatedUser({
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      departmentId: payload.dept,
      extraPermissions: payload.perm ?? [],
      sessionId: payload.sid,
    });

    request.user = user;
    RequestContextStore.setUserId(user.id);

    if (isPublic) return true;

    if (!(await this.accountIsActive(user.id))) {
      throw new UnauthorizedException('This account is no longer active');
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Your role does not allow this action');
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    if (required?.length) {
      const mode =
        this.reflector.getAllAndOverride<'any' | 'all'>(PERMISSION_MODE, targets) ?? 'all';
      const allowed = mode === 'any' ? user.canAny(required) : user.canAll(required);
      if (!allowed) {
        throw new ForbiddenException(
          `Missing permission: ${required.join(mode === 'any' ? ' or ' : ', ')}`,
        );
      }
    }

    return true;
  }
}

function extractToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[ACCESS_COOKIE] ?? null;
}
