import type { ApiErrorBody } from '@kode/contracts';

/**
 * The single HTTP entry point for the portal.
 *
 * Responsibilities, in one place so no call site has to remember them:
 *  - send cookies (the access token is httpOnly, never in JS);
 *  - echo the CSRF cookie back in a header on state-changing requests;
 *  - on a 401, attempt exactly one silent refresh and replay the request,
 *    with concurrent callers sharing that single refresh rather than
 *    stampeding the endpoint;
 *  - turn every failure into a typed ApiError with field-level detail.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
const CSRF_COOKIE = 'kode_csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, string[]>;
  readonly requestId: string | null;

  constructor(
    status: number,
    message: string,
    details: Record<string, string[]> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }

  /** First message for a field, for rendering next to an input. */
  fieldError(field: string): string | undefined {
    return this.details[field]?.[0];
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Shared in-flight refresh, so ten parallel 401s cause one refresh call. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers that awaited this promise all see
      // the same result before a new refresh can begin.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();

/** Fired when a refresh fails, so the app can drop to the sign-in screen. */
export function onSessionExpired(listener: Listener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Multipart uploads pass a FormData body and must not set Content-Type. */
  formData?: FormData;
}

async function execute(path: string, options: RequestOptions, isRetry = false): Promise<Response> {
  const method = options.method ?? 'GET';
  const url = new URL(`${BASE}${path}`, window.location.origin);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  if (options.formData === undefined && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (UNSAFE.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(url.toString(), {
    method,
    credentials: 'include',
    headers,
    ...(options.formData ? { body: options.formData } : {}),
    ...(options.body !== undefined && !options.formData
      ? { body: JSON.stringify(options.body) }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 401 && !isRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return execute(path, options, true);
    for (const listener of sessionExpiredListeners) listener();
  }

  return response;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await execute(path, options);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const body = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      body.message ?? defaultMessage(response.status),
      body.details ?? {},
      body.requestId ?? response.headers.get('x-request-id'),
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You do not have access to that.';
  if (status === 404) return 'That could not be found.';
  if (status === 429) return 'Too many requests. Give it a moment and try again.';
  if (status >= 500) return 'Something went wrong at our end. Please try again.';
  return 'That request could not be completed.';
}
