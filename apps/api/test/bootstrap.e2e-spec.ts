import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token.service';
import { PasswordService } from '../src/auth/password.service';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../src/auth/cookie.util';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@kode/contracts';

/**
 * Wiring test. Boots the real application with the database layer replaced by a
 * stub, which proves the parts that a unit test cannot: that the dependency
 * graph resolves, that the global guards run in the right order, and that an
 * unannotated route is unreachable.
 *
 * The SQL itself is covered by auth-rbac.e2e-spec.ts, which runs against a real
 * database in CI.
 */
describe('Application bootstrap and global guards (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let env: Env;

  /**
   * Minimal Prisma stand-in. Every model resolves to empty results, which is
   * enough to prove routing and authorization without a database.
   */
  function prismaStub(): Record<string, unknown> {
    const model = {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      findUniqueOrThrow: async () => {
        throw new Error('not found');
      },
      count: async () => 0,
      create: async (args: { data: unknown }) => args.data,
      update: async (args: { data: unknown }) => args.data,
      updateMany: async () => ({ count: 0 }),
      delete: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
      upsert: async (args: { create: unknown }) => args.create,
      createMany: async () => ({ count: 0 }),
    };
    const models = [
      'user',
      'department',
      'refreshToken',
      'oidcState',
      'media',
      'article',
      'event',
      'policy',
      'faq',
      'galleryAlbum',
      'galleryItem',
      'quickLink',
      'supportTicket',
      'outboxMessage',
      'auditLog',
      'setting',
    ];
    const stub: Record<string, unknown> = {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $queryRaw: async () => [{ '?column?': 1 }],
      $transaction: async (operations: unknown) =>
        Array.isArray(operations) ? Promise.all(operations) : (operations as () => unknown)(),
      $on: () => undefined,
    };
    for (const name of models) stub[name] = { ...model };

    // The JWT guard re-checks on every request that the account behind a token
    // still exists and is not suspended — a deliberate control, so that
    // suspending someone ends their session without waiting for the token to
    // expire. It reads `user.findFirst`, which the blanket stub answers with
    // null, so every authenticated request 401s and none of the authorization
    // tests below can reach the permission checks they exist to prove.
    //
    // The user model therefore answers that liveness probe with an active row.
    // Every other model stays empty, which is what keeps this a wiring test
    // rather than a data test.
    stub.user = {
      ...model,
      findFirst: async (args?: { where?: { id?: string } }) =>
        args?.where?.id ? { id: args.where.id } : null,
    };
    return stub;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub())
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['media/:shard/:name'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter(false));
    await app.init();

    jwt = app.get(JwtService);
    env = app.get<Env>(ENV);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  /** Mints a valid access token directly, bypassing the database. */
  async function tokenFor(role: Role, departmentId: string | null = null): Promise<string> {
    return jwt.signAsync(
      {
        sub: 'test-user',
        email: 'test@kodesportsclub.com',
        role,
        dept: departmentId,
        perm: [],
        sid: 'test-session',
        typ: 'access',
      },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: 300 },
    );
  }

  function authed(token: string, csrf?: string) {
    const cookies = [`${ACCESS_COOKIE}=${token}`];
    if (csrf) cookies.push(`${CSRF_COOKIE}=${csrf}`);
    return cookies.join('; ');
  }

  describe('the module graph resolves', () => {
    it('constructs every provider the application declares', () => {
      // Failure here means a circular import or a missing provider, which is
      // exactly the class of error a unit test cannot reach.
      expect(app.get(AuthService)).toBeDefined();
      expect(app.get(TokenService)).toBeDefined();
      expect(app.get(PasswordService)).toBeDefined();
    });

    it('validated the environment at boot', () => {
      expect(env.ACCESS_TOKEN_TTL_SECONDS).toBeGreaterThan(0);
      expect(env.JWT_ACCESS_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
    });
  });

  describe('routes are registered under the versioned prefix', () => {
    it('serves the liveness probe', async () => {
      const response = await api().get('/api/v1/health/live').expect(200);
      expect(response.body.status).toBe('ok');
    });

    it('reports the configured sign-in providers', async () => {
      const response = await api().get('/api/v1/auth/providers').expect(200);
      expect(response.body).toEqual({ local: true, entra: false });
    });

    it('returns 404 for an unknown path rather than an unhandled error', async () => {
      await api().get('/api/v1/does-not-exist').expect(404);
    });
  });

  describe('the global guard denies by default', () => {
    const protectedRoutes = [
      '/api/v1/portal/home',
      '/api/v1/portal/news',
      '/api/v1/cms/news',
      '/api/v1/cms/dashboard',
      '/api/v1/cms/users',
      '/api/v1/audit',
      '/api/v1/media',
      '/api/v1/directory',
      '/api/v1/departments',
      '/api/v1/support/tickets',
    ];

    it.each(protectedRoutes)('refuses %s without a token', async (route) => {
      await api().get(route).expect(401);
    });

    it('refuses a token signed with the wrong secret', async () => {
      const forged = await jwt.signAsync(
        {
          sub: 'x',
          email: 'x@y.z',
          role: Role.SUPER_ADMIN,
          dept: null,
          perm: [],
          sid: 's',
          typ: 'access',
        },
        { secret: 'a'.repeat(48), expiresIn: 300 },
      );
      await api().get('/api/v1/cms/news').set('Cookie', authed(forged)).expect(401);
    });

    it('refuses a refresh token presented as an access token', async () => {
      const refresh = await jwt.signAsync(
        { sub: 'x', sid: 's', jti: 'j', typ: 'refresh' },
        { secret: env.JWT_ACCESS_SECRET, expiresIn: 300 },
      );
      await api().get('/api/v1/cms/news').set('Cookie', authed(refresh)).expect(401);
    });

    it('refuses an expired token', async () => {
      const expired = await jwt.signAsync(
        {
          sub: 'x',
          email: 'x@y.z',
          role: Role.SUPER_ADMIN,
          dept: null,
          perm: [],
          sid: 's',
          typ: 'access',
        },
        { secret: env.JWT_ACCESS_SECRET, expiresIn: -10 },
      );
      await api().get('/api/v1/cms/news').set('Cookie', authed(expired)).expect(401);
    });
  });

  describe('permission checks run on real routes', () => {
    it('lets an Employee read the portal', async () => {
      await api()
        .get('/api/v1/portal/news')
        .set('Cookie', authed(await tokenFor(Role.EMPLOYEE)))
        .expect(200);
    });

    it('keeps an Employee out of every CMS collection', async () => {
      const cookie = authed(await tokenFor(Role.EMPLOYEE));
      for (const route of ['news', 'events', 'policies', 'faqs', 'gallery']) {
        await api().get(`/api/v1/cms/${route}`).set('Cookie', cookie).expect(403);
      }
    });

    it('keeps an Employee out of people, audit and media', async () => {
      const cookie = authed(await tokenFor(Role.EMPLOYEE));
      await api().get('/api/v1/cms/users').set('Cookie', cookie).expect(403);
      await api().get('/api/v1/audit').set('Cookie', cookie).expect(403);
      await api().get('/api/v1/media').set('Cookie', cookie).expect(403);
    });

    it('keeps a Content Manager out of the audit trail', async () => {
      await api()
        .get('/api/v1/audit')
        .set('Cookie', authed(await tokenFor(Role.CONTENT_MANAGER)))
        .expect(403);
    });

    it('lets a Content Manager into the CMS content lists', async () => {
      await api()
        .get('/api/v1/cms/news')
        .set('Cookie', authed(await tokenFor(Role.CONTENT_MANAGER)))
        .expect(200);
    });

    it('lets a Super Admin into the audit trail', async () => {
      await api()
        .get('/api/v1/audit')
        .set('Cookie', authed(await tokenFor(Role.SUPER_ADMIN)))
        .expect(200);
    });

    it('lets a Content Editor list but not delete', async () => {
      const cookie = authed(await tokenFor(Role.CONTENT_EDITOR), 'csrf-value');
      await api().get('/api/v1/cms/news').set('Cookie', cookie).expect(200);
      await api()
        .delete('/api/v1/cms/news/some-id')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', 'csrf-value')
        .expect(403);
    });
  });

  describe('CSRF runs after authentication', () => {
    it('rejects an authenticated POST with no CSRF header', async () => {
      await api()
        .post('/api/v1/cms/news')
        .set('Cookie', authed(await tokenFor(Role.CONTENT_MANAGER)))
        .send({ title: 'probe', body: 'body copy long enough' })
        .expect(403);
    });

    it('rejects a mismatched CSRF header', async () => {
      await api()
        .post('/api/v1/cms/news')
        .set('Cookie', authed(await tokenFor(Role.CONTENT_MANAGER), 'real-token'))
        .set('X-CSRF-Token', 'different-token')
        .send({ title: 'probe', body: 'body copy long enough' })
        .expect(403);
    });

    it('lets a matching CSRF token through to validation', async () => {
      const response = await api()
        .post('/api/v1/cms/news')
        .set('Cookie', authed(await tokenFor(Role.CONTENT_MANAGER), 'matching'))
        .set('X-CSRF-Token', 'matching')
        .send({ title: 'no', body: '' });

      // Past CSRF, so the failure is now validation rather than 403.
      expect(response.status).toBe(422);
      expect(response.body.details).toBeDefined();
    });

    it('does not apply CSRF to safe methods', async () => {
      await api()
        .get('/api/v1/cms/news')
        .set('Cookie', authed(await tokenFor(Role.CONTENT_MANAGER)))
        .expect(200);
    });
  });

  describe('validation and error shape', () => {
    it('returns field-level detail on a 422', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'nope', password: '' })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.error).toBeDefined();
      expect(response.body.requestId).toBeDefined();
      expect(Object.keys(response.body.details)).toContain('email');
    });

    it('puts a request id on every error response', async () => {
      const response = await api().get('/api/v1/cms/news').expect(401);
      expect(response.body.requestId).toMatch(/[\w-]+/);
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('echoes a caller-supplied request id', async () => {
      const response = await api()
        .get('/api/v1/health/live')
        .set('X-Request-Id', 'trace-abc-123')
        .expect(200);
      expect(response.headers['x-request-id']).toBe('trace-abc-123');
    });

    it('rejects an out-of-range pagination value', async () => {
      await api()
        .get('/api/v1/portal/news')
        .query({ pageSize: 5000 })
        .set('Cookie', authed(await tokenFor(Role.EMPLOYEE)))
        .expect(422);
    });
  });

  describe('Entra endpoints when the provider is disabled', () => {
    it('returns 503 rather than a crash', async () => {
      await api().get('/api/v1/auth/entra/start').expect(503);
    });
  });
});
