/*
 * A unit test of this service has no business loading a database client. The
 * module is stubbed so the suite exercises the guard logic in isolation and
 * stays runnable in environments where the Prisma engine is not present.
 */
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TaxonomyKind } from '@kode/contracts';
import { TaxonomyService } from './taxonomy.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * The guard rails around admin-managed terms.
 *
 * The database enforces the two hard rules (unique key per namespace, and no
 * deleting a term events still reference) and those are verified directly
 * against PostgreSQL. What is tested here is the behaviour the database cannot
 * express: refusing to archive the last usable term, refusing to delete a
 * seeded term, and refusing an id that belongs to another namespace.
 */
describe('TaxonomyService', () => {
  const actor = { id: 'admin-1' } as AuthenticatedUser;

  function term(overrides: Record<string, unknown> = {}) {
    return {
      id: 't1',
      kind: TaxonomyKind.EVENT_KIND,
      key: 'CLUB_MOMENT',
      label: 'Club moment',
      description: null,
      colour: '#244EA2',
      sortOrder: 10,
      isSystem: false,
      archivedAt: null,
      ...overrides,
    };
  }

  function build(prisma: Partial<Record<string, unknown>>) {
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    return new TaxonomyService(prisma as unknown as PrismaService, audit);
  }

  describe('create', () => {
    it('refuses a key that already exists in the same namespace', async () => {
      const service = build({
        taxonomy: { findUnique: async () => term() },
      });
      await expect(
        service.create(
          {
            kind: TaxonomyKind.EVENT_KIND,
            key: 'CLUB_MOMENT',
            label: 'Duplicate',
            colour: '#244EA2',
            sortOrder: 0,
          },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('points at the archived original rather than allowing a duplicate', async () => {
      const service = build({
        taxonomy: { findUnique: async () => term({ archivedAt: new Date() }) },
      });
      await expect(
        service.create(
          {
            kind: TaxonomyKind.EVENT_KIND,
            key: 'CLUB_MOMENT',
            label: 'Duplicate',
            colour: '#244EA2',
            sortOrder: 0,
          },
          actor,
        ),
      ).rejects.toThrow(/Restore it/);
    });

    it('creates a term an admin can use immediately, never as a system term', async () => {
      const created: Record<string, unknown>[] = [];
      const service = build({
        taxonomy: {
          findUnique: async () => null,
          create: async (args: { data: Record<string, unknown> }) => {
            created.push(args.data);
            return term({ id: 't9', key: 'COMMUNITY', label: 'Community outreach', ...args.data });
          },
        },
      });
      const dto = await service.create(
        {
          kind: TaxonomyKind.EVENT_KIND,
          key: 'COMMUNITY',
          label: 'Community outreach',
          colour: '#ED0C6E',
          sortOrder: 50,
        },
        actor,
      );
      expect(dto.key).toBe('COMMUNITY');
      expect(dto.usageCount).toBe(0);
      // An admin-created term must never be marked system, or nobody could
      // ever remove their own mistake.
      expect(created[0]?.isSystem).toBe(false);
    });
  });

  describe('update', () => {
    it('refuses to archive the last active term in a namespace', async () => {
      // Otherwise the event create form is left with an empty required select
      // and no way to recover from inside the CMS.
      const service = build({
        taxonomy: {
          findUnique: async () => term(),
          count: async () => 0,
        },
      });
      await expect(service.update('t1', { archived: true }, actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows archiving when another active term remains', async () => {
      const service = build({
        taxonomy: {
          findUnique: async () => term(),
          count: async () => 2,
          update: async (args: { data: Record<string, unknown> }) =>
            term({ archivedAt: args.data.archivedAt }),
        },
        event: { groupBy: async () => [] },
      });
      const dto = await service.update('t1', { archived: true }, actor);
      expect(dto.archivedAt).not.toBeNull();
    });

    it('does not run the last-term check when restoring', async () => {
      const count = jest.fn();
      const service = build({
        taxonomy: {
          findUnique: async () => term({ archivedAt: new Date() }),
          count,
          update: async () => term({ archivedAt: null }),
        },
        event: { groupBy: async () => [] },
      });
      const dto = await service.update('t1', { archived: false }, actor);
      expect(dto.archivedAt).toBeNull();
      expect(count).not.toHaveBeenCalled();
    });

    it('rejects an unknown id', async () => {
      const service = build({ taxonomy: { findUnique: async () => null } });
      await expect(service.update('nope', { label: 'x' }, actor)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a seeded term', async () => {
      const service = build({ taxonomy: { findUnique: async () => term({ isSystem: true }) } });
      await expect(service.remove('t1', actor)).rejects.toThrow(/built-in/);
    });

    it('refuses to delete a term that is still in use, and says how many', async () => {
      const service = build({
        taxonomy: { findUnique: async () => term() },
        event: { groupBy: async () => [{ kindId: 't1', _count: { _all: 7 } }] },
      });
      await expect(service.remove('t1', actor)).rejects.toThrow(/used by 7 items/);
    });

    it('deletes an unused, admin-created term', async () => {
      const deleted: string[] = [];
      const service = build({
        taxonomy: {
          findUnique: async () => term(),
          delete: async (args: { where: { id: string } }) => {
            deleted.push(args.where.id);
            return term();
          },
        },
        event: { groupBy: async () => [] },
      });
      await service.remove('t1', actor);
      expect(deleted).toEqual(['t1']);
    });
  });

  describe('assertUsable', () => {
    it('rejects an id belonging to another namespace', async () => {
      // Without this a client could file an event under a news category by
      // passing that category's id, because both are just cuids on the wire.
      const service = build({
        taxonomy: { findUnique: async () => term({ kind: TaxonomyKind.ARTICLE_CATEGORY }) },
      });
      await expect(service.assertUsable('t1', TaxonomyKind.EVENT_KIND)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an archived term on a new item', async () => {
      const service = build({
        taxonomy: { findUnique: async () => term({ archivedAt: new Date() }) },
      });
      await expect(service.assertUsable('t1', TaxonomyKind.EVENT_KIND)).rejects.toThrow(/archived/);
    });

    it('accepts an active term in the right namespace', async () => {
      const service = build({ taxonomy: { findUnique: async () => term() } });
      await expect(service.assertUsable('t1', TaxonomyKind.EVENT_KIND)).resolves.toBeUndefined();
    });
  });

  describe('usage counts across every namespace', () => {
    // Each namespace reads a different table and a different column; getting
    // one wrong would silently report every term as unused, which is what
    // enables the delete button.
    const cases = [
      [TaxonomyKind.EVENT_KIND, 'event', 'kindId'],
      [TaxonomyKind.ARTICLE_CATEGORY, 'article', 'categoryId'],
      [TaxonomyKind.FAQ_CATEGORY, 'faq', 'categoryId'],
      [TaxonomyKind.TICKET_CATEGORY, 'supportTicket', 'categoryId'],
    ] as const;

    it.each(cases)('counts %s usage from the right table', async (kind, model, column) => {
      const service = build({
        taxonomy: { findMany: async () => [term({ kind })] },
        [model]: { groupBy: async () => [{ [column]: 't1', _count: { _all: 4 } }] },
      });
      const rows = await service.list({ kind, includeArchived: false });
      expect(rows[0]?.usageCount).toBe(4);
    });

    it('refuses to delete a used term in any namespace', async () => {
      const service = build({
        taxonomy: { findUnique: async () => term({ kind: TaxonomyKind.TICKET_CATEGORY }) },
        supportTicket: { groupBy: async () => [{ categoryId: 't1', _count: { _all: 3 } }] },
      });
      await expect(service.remove('t1', actor)).rejects.toThrow(/used by 3 items/);
    });
  });
});
