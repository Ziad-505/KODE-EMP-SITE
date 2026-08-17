import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { VersioningType } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end coverage of the parts that must not regress: authentication,
 * authorization, refresh-token rotation, CSRF, and the audit trail.
 *
 * Expects the CI database to have been migrated and seeded.
 */
describe('Authentication and authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = process.env.SEED_EMPLOYEE_PASSWORD ?? 'KodeClub!2026demo';
  const ADMIN = {
    email: 'admin@kodesportsclub.com',
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? PASSWORD,
  };
  const MANAGER = {
    email: 'marketing@kodesportsclub.com',
    password: process.env.SEED_CONTENT_MANAGER_PASSWORD ?? PASSWORD,
  };
  const EDITOR = {
    email: 'editor@kodesportsclub.com',
    password: process.env.SEED_CONTENT_EDITOR_PASSWORD ?? PASSWORD,
  };
  const EMPLOYEE = { email: 'employee@kodesportsclub.com', password: PASSWORD };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['media/:shard/:name'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter(false));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  /** Signs in and returns the cookie jar plus the CSRF token to echo back. */
  async function signIn(credentials: { email: string; password: string }) {
    const response = await api().post('/api/v1/auth/login').send(credentials).expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const csrf = cookies
      .find((cookie) => cookie.startsWith('kode_csrf='))
      ?.split(';')[0]
      ?.split('=')[1];
    return { cookies, csrf: csrf ?? '', body: response.body };
  }

  describe('sign-in', () => {
    it('rejects a wrong password with the same message as an unknown account', async () => {
      const wrongPassword = await api()
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: 'definitely-not-it' })
        .expect(401);

      const unknownAccount = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@kodesportsclub.com', password: 'definitely-not-it' })
        .expect(401);

      expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
    });

    it('rejects a malformed email with a field-level error', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'whatever' })
        .expect(422);

      expect(response.body.details.email).toBeDefined();
    });

    it('sets httpOnly session cookies and a readable CSRF cookie', async () => {
      const { cookies } = await signIn(EMPLOYEE);
      const access = cookies.find((cookie) => cookie.startsWith('kode_at='))!;
      const refresh = cookies.find((cookie) => cookie.startsWith('kode_rt='))!;
      const csrf = cookies.find((cookie) => cookie.startsWith('kode_csrf='))!;

      expect(access).toContain('HttpOnly');
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/v1/auth');
      expect(csrf).not.toContain('HttpOnly');
    });

    it('returns the effective permission set with the session', async () => {
      const { body } = await signIn(MANAGER);
      expect(body.user.permissions).toContain('news:publish');
      expect(body.user.permissions).not.toContain('settings:manage');
    });
  });

  describe('route protection', () => {
    it('refuses an unauthenticated request', async () => {
      await api().get('/api/v1/portal/home').expect(401);
    });

    it('refuses a token-free CMS request', async () => {
      await api().get('/api/v1/cms/news').expect(401);
    });

    it('lets an employee read the portal', async () => {
      const { cookies } = await signIn(EMPLOYEE);
      await api().get('/api/v1/portal/home').set('Cookie', cookies).expect(200);
    });

    it('keeps an employee out of the CMS', async () => {
      const { cookies } = await signIn(EMPLOYEE);
      await api().get('/api/v1/cms/news').set('Cookie', cookies).expect(403);
    });

    it('keeps a Content Manager out of the audit trail', async () => {
      const { cookies } = await signIn(MANAGER);
      await api().get('/api/v1/audit').set('Cookie', cookies).expect(403);
    });

    it('lets a Super Admin read the audit trail', async () => {
      const { cookies } = await signIn(ADMIN);
      await api().get('/api/v1/audit').set('Cookie', cookies).expect(200);
    });
  });

  describe('CSRF', () => {
    it('rejects a state-changing request with no CSRF header', async () => {
      const { cookies } = await signIn(MANAGER);
      await api()
        .post('/api/v1/cms/news')
        .set('Cookie', cookies)
        .send({ title: 'CSRF probe', body: 'x'.repeat(20) })
        .expect(403);
    });

    it('rejects a mismatched CSRF header', async () => {
      const { cookies } = await signIn(MANAGER);
      await api()
        .post('/api/v1/cms/news')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', 'not-the-right-token')
        .send({ title: 'CSRF probe', body: 'x'.repeat(20) })
        .expect(403);
    });
  });

  describe('publication workflow', () => {
    it('downgrades a publish attempt by an editor who cannot publish', async () => {
      const { cookies, csrf } = await signIn(EDITOR);
      const response = await api()
        .post('/api/v1/cms/news')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .send({
          title: 'Editor tries to publish',
          body: 'The service should force this into review instead.',
          status: 'PUBLISHED',
        })
        .expect(201);

      expect(response.body.status).toBe('IN_REVIEW');

      await prisma.article.deleteMany({ where: { id: response.body.id } });
    });

    it('refuses an illegal status transition', async () => {
      const { cookies, csrf } = await signIn(MANAGER);
      const created = await api()
        .post('/api/v1/cms/news')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .send({
          title: 'Transition probe',
          body: 'Body copy for the transition probe.',
          status: 'DRAFT',
        })
        .expect(201);

      await api()
        .post(`/api/v1/cms/news/${created.body.id}/status`)
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .send({ status: 'ARCHIVED' })
        .expect(201);

      // ARCHIVED may only go back to DRAFT.
      await api()
        .post(`/api/v1/cms/news/${created.body.id}/status`)
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf)
        .send({ status: 'PUBLISHED' })
        .expect(400);

      await prisma.article.deleteMany({ where: { id: created.body.id } });
    });

    it('hides an unpublished story from the portal', async () => {
      const manager = await signIn(MANAGER);
      const created = await api()
        .post('/api/v1/cms/news')
        .set('Cookie', manager.cookies)
        .set('X-CSRF-Token', manager.csrf)
        .send({ title: 'Not for employees yet', body: 'Draft body copy.', status: 'DRAFT' })
        .expect(201);

      const employee = await signIn(EMPLOYEE);
      await api()
        .get(`/api/v1/portal/news/${created.body.slug}`)
        .set('Cookie', employee.cookies)
        .expect(404);

      await prisma.article.deleteMany({ where: { id: created.body.id } });
    });
  });

  describe('refresh token rotation', () => {
    it('issues a new refresh token and revokes the whole family on replay', async () => {
      const { cookies } = await signIn(EMPLOYEE);
      const originalRefresh = cookies
        .find((cookie) => cookie.startsWith('kode_rt='))!
        .split(';')[0]!;

      const first = await api()
        .post('/api/v1/auth/refresh')
        .set('Cookie', originalRefresh)
        .expect(200);
      const rotated = (first.headers['set-cookie'] as unknown as string[])
        .find((cookie) => cookie.startsWith('kode_rt='))!
        .split(';')[0]!;

      expect(rotated).not.toBe(originalRefresh);

      // Replaying the original is the signature of a stolen token.
      await api().post('/api/v1/auth/refresh').set('Cookie', originalRefresh).expect(401);

      // ...and it takes the rotated one down with it.
      await api().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
    });
  });

  describe('audit trail', () => {
    it('records a sign-in', async () => {
      await signIn(ADMIN);
      const { cookies } = await signIn(ADMIN);
      const response = await api()
        .get('/api/v1/audit')
        .query({ action: 'LOGIN', pageSize: 5 })
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.items.length).toBeGreaterThan(0);
      expect(response.body.items[0].action).toBe('LOGIN');
    });

    it('is append-only at the database level', async () => {
      const entry = await prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' } });
      expect(entry).not.toBeNull();
      await expect(
        prisma.auditLog.update({ where: { id: entry!.id }, data: { summary: 'tampered' } }),
      ).rejects.toThrow();
    });
  });

  describe('health', () => {
    it('reports liveness without authentication', async () => {
      await api().get('/api/v1/health/live').expect(200);
    });

    it('reports readiness including the database', async () => {
      const response = await api().get('/api/v1/health/ready').expect(200);
      expect(response.body.info.database.status).toBe('up');
    });
  });
});
