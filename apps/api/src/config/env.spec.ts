import { loadEnv } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://kode:secret@localhost:5432/kode',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('loadEnv', () => {
  it('applies documented defaults', () => {
    const env = loadEnv({ ...BASE } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.ENTRA_ENABLED).toBe(false);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('refuses a short signing secret', () => {
    expect(() => loadEnv({ ...BASE, JWT_ACCESS_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('requires the Entra settings once Entra is switched on', () => {
    expect(() => loadEnv({ ...BASE, ENTRA_ENABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(
      /ENTRA_TENANT_ID/,
    );
  });

  it('refuses identical access and refresh secrets in production', () => {
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: BASE.JWT_ACCESS_SECRET,
      } as NodeJS.ProcessEnv),
    ).toThrow(/must differ/);
  });

  it('refuses SameSite=None without Secure in production', () => {
    expect(() =>
      loadEnv({
        ...BASE,
        NODE_ENV: 'production',
        COOKIE_SAMESITE: 'none',
        COOKIE_SECURE: 'false',
      } as NodeJS.ProcessEnv),
    ).toThrow(/Secure cookies/);
  });

  it('defaults cookies to secure and Swagger to off in production', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.ENABLE_SWAGGER).toBe(false);
  });
});
