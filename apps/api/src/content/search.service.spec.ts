/*
 * A unit test of this service has no business loading a database client.
 */
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { Permission } from '@kode/contracts';
import { SearchService } from './search.service';
import { ContentPolicy } from './content.policy';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * The staff directory is the one search result type behind a permission.
 *
 * Search used to query the users table unconditionally, so the command palette
 * returned colleagues to anyone signed in regardless of `directory:read`. That
 * was invisible in practice because every seeded role happens to hold it — the
 * defect only surfaces the first time someone creates a restricted role and
 * expects removing the permission to remove the people.
 *
 * Which is exactly why it needs a test rather than a manual check: the live
 * behaviour looks identical either way with the current roles.
 */
describe('SearchService directory gating', () => {
  const emptyTables = {
    article: { findMany: async () => [] },
    event: { findMany: async () => [] },
    policy: { findMany: async () => [] },
    faq: { findMany: async () => [] },
    galleryAlbum: { findMany: async () => [] },
  };

  function build(userFindMany: jest.Mock) {
    const prisma = {
      ...emptyTables,
      user: { findMany: userFindMany },
    } as unknown as PrismaService;
    return new SearchService(prisma, new ContentPolicy());
  }

  function actorWith(permissions: Permission[]): AuthenticatedUser {
    return {
      id: 'u1',
      departmentId: null,
      scope: 'global',
      can: (permission: Permission) => permissions.includes(permission),
    } as unknown as AuthenticatedUser;
  }

  const query = { q: 'an', limit: 10 } as Parameters<SearchService['search']>[0];

  it('does not touch the users table without directory:read', async () => {
    const userFindMany = jest.fn();
    const service = build(userFindMany);

    const results = await service.search(query, actorWith([Permission.NEWS_READ]));

    // Not merely "returns no people" — the query must never be issued, so the
    // names do not travel as far as this process.
    expect(userFindMany).not.toHaveBeenCalled();
    expect(results.filter((r) => r.type === 'person')).toHaveLength(0);
  });

  it('returns people when the caller holds directory:read', async () => {
    const userFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 'p1', firstName: 'Mariam', lastName: 'Adel', jobTitle: 'Coach' }]);
    const service = build(userFindMany);

    const results = await service.search(
      query,
      actorWith([Permission.NEWS_READ, Permission.DIRECTORY_READ]),
    );

    expect(userFindMany).toHaveBeenCalled();
    expect(results.filter((r) => r.type === 'person').map((r) => r.title)).toEqual(['Mariam Adel']);
  });

  it('treats an anonymous caller as having no permissions', async () => {
    const userFindMany = jest.fn();
    const service = build(userFindMany);

    await service.search(query, null);

    expect(userFindMany).not.toHaveBeenCalled();
  });
});
