import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';

export const ACCESS_COOKIE = 'kode_at';
export const REFRESH_COOKIE = 'kode_rt';
export const CSRF_COOKIE = 'kode_csrf';

/**
 * Tokens live in httpOnly cookies rather than localStorage. That removes the
 * XSS token-theft path entirely; the CSRF risk it introduces is handled by the
 * double-submit token in csrf.guard.ts plus SameSite.
 */
function base(env: Env): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  response: Response,
  env: Env,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
): void {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(env),
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });

  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(env),
    // Scoped to the refresh endpoints only, so it is never sent on ordinary
    // API calls and cannot leak through a chatty proxy log.
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });

  // Readable by JS on purpose: the SPA echoes it back in a header.
  response.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base(env),
    httpOnly: false,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(response: Response, env: Env): void {
  const options = base(env);
  response.clearCookie(ACCESS_COOKIE, options);
  response.clearCookie(REFRESH_COOKIE, { ...options, path: '/api/v1/auth' });
  response.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
}
