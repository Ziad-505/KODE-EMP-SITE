import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { CSRF_COOKIE } from './cookie.util';
import { SKIP_CSRF } from './csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF protection for cookie-authenticated state changes.
 *
 * Cookie auth means the browser attaches credentials automatically, so a
 * cross-site form post would otherwise be authenticated. SameSite blocks most
 * of that, but not all of it across every browser and deployment topology, so
 * the header check is the belt to SameSite's braces.
 *
 * Requests carrying an explicit `Authorization: Bearer` header are exempt: they
 * are not ambient-credential requests, so CSRF does not apply.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (request.headers.authorization?.startsWith('Bearer ')) return true;

    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    const cookieToken = cookies?.[CSRF_COOKIE];
    const headerValue = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }
    return true;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
