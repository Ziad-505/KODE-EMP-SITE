import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at boot.
 * The process refuses to start on an invalid or missing value rather than
 * failing later at the first request that happens to need it.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Public origin of the API itself, used to build absolute media URLs. */
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    PORTAL_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
    ADMIN_PUBLIC_URL: z.string().url().default('http://localhost:5174'),
    /** Browser origins allowed to send credentialed requests. */
    CORS_ORIGINS: csv.default('http://localhost:5173,http://localhost:5174'),
    /** Set when the API sits behind a reverse proxy so req.ip is the real client. */
    TRUST_PROXY: booleanish.default(false),

    DATABASE_URL: z.string().url(),
    /** Per-replica connection pool ceiling. Keep replicas × this < Postgres max_connections. */
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

    /** Minimum 32 bytes of entropy. Rotate by deploying a new value; sessions end. */
    JWT_ACCESS_SECRET: z.string().min(32, 'Use at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'Use at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    /** Cookie domain. Leave unset for host-only cookies (correct for single-domain). */
    COOKIE_DOMAIN: z.string().optional(),
    /** 'lax' works when portal, admin and API share a site. Use 'none' only over HTTPS. */
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_SECURE: booleanish.optional(),

    /** Account lockout after this many consecutive failures. */
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(8),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    /* --- Microsoft Entra ID. Optional: the app runs fully without these. --- */
    ENTRA_ENABLED: booleanish.default(false),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),
    /** Must exactly match a redirect URI registered on the Azure app. */
    ENTRA_REDIRECT_URI: z.string().url().optional(),
    /** Email domains permitted to sign in via Entra. Empty means any tenant user. */
    ENTRA_ALLOWED_DOMAINS: csv.default(''),
    /** Role given to a first-time Entra sign-in. */
    ENTRA_DEFAULT_ROLE: z
      .enum(['EMPLOYEE', 'DEPARTMENT_EDITOR', 'CONTENT_EDITOR'])
      .default('EMPLOYEE'),
    /** When false, an Entra user with no existing account is rejected. */
    ENTRA_AUTO_PROVISION: booleanish.default(true),

    /* ----------------------------- storage ----------------------------- */
    UPLOAD_DIR: z.string().default('./storage/uploads'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(15),

    /* ------------------------------ email ------------------------------ */
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('KODE Portal <no-reply@kodesportsclub.com>'),
    /** The inbox that turns an email into an Odoo ticket. */
    IT_SUPPORT_INBOX: z.string().email().default('it-support@kodesportsclub.com'),

    /* ---------------------------- rate limits -------------------------- */
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(3).default(10),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Serve the Swagger UI. Off in production unless explicitly enabled. */
    ENABLE_SWAGGER: booleanish.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.ENTRA_ENABLED) {
      for (const key of [
        'ENTRA_TENANT_ID',
        'ENTRA_CLIENT_ID',
        'ENTRA_CLIENT_SECRET',
        'ENTRA_REDIRECT_URI',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when ENTRA_ENABLED is true`,
          });
        }
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.COOKIE_SAMESITE === 'none' && env.COOKIE_SECURE === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'SameSite=None requires Secure cookies',
        });
      }
      if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'Access and refresh secrets must differ',
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    ENABLE_SWAGGER: env.ENABLE_SWAGGER ?? env.NODE_ENV !== 'production',
    MAX_UPLOAD_BYTES: env.MAX_UPLOAD_MB * 1024 * 1024,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  }));

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
