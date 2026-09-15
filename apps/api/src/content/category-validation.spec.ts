/*
 * A unit test of these services has no business loading a database client. The
 * module is stubbed so the suite exercises the validation order in isolation
 * and stays runnable where the Prisma engine is not present.
 */
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { BadRequestException } from '@nestjs/common';
import { ContentStatus, TaxonomyKind } from '@kode/contracts';
import { ArticlesService } from './articles.service';
import { EventsService } from './events.service';
import { FaqsService } from './faqs.service';
import { ContentPolicy } from './content.policy';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { MediaUrlService } from '../media/media-url.service';
import type { TaxonomyService } from '../taxonomy/taxonomy.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * Terms are validated on update, not only on create.
 *
 * The foreign key proves the id names *some* row in `taxonomies`. It cannot
 * tell a news category from a ticket category, and it knows nothing about
 * archiving — so without an explicit check the update path accepted both: a
 * story could be filed under "Hardware", and a term deliberately archived so it
 * could not be chosen on create was still applicable on edit.
 *
 * Each case asserts two things: that the service consulted the taxonomy with
 * the *right namespace*, and that a refusal stops the write rather than being
 * swallowed. Passing the namespace of a neighbouring service is the specific
 * mistake four near-identical call sites invite.
 */
describe('Category validation on update', () => {
  const actor = {
    id: 'user-1',
    scope: 'global',
    departmentId: null,
    can: () => true,
  } as unknown as AuthenticatedUser;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const urls = { toUrl: () => null } as unknown as MediaUrlService;

  /** Accepts every id, and records which namespace it was asked about. */
  function permissiveTaxonomy() {
    return { assertUsable: jest.fn().mockResolvedValue(undefined) };
  }

  /** Refuses every id, the way a foreign-namespace or archived term does. */
  function refusingTaxonomy() {
    return {
      assertUsable: jest
        .fn()
        .mockRejectedValue(new BadRequestException('That is not a valid option for this field')),
    };
  }

  /**
   * The row the service loads before writing, plus the `update` it would then
   * perform. `update` throwing marks the test as failed when a refusal should
   * have prevented it from being reached at all.
   */
  function prismaFor(model: string, row: Record<string, unknown>) {
    const stub = {
      findFirst: async () => row,
      findMany: async () => [],
      update: jest.fn().mockResolvedValue(row),
    };
    return { prisma: { [model]: stub } as unknown as PrismaService, stub };
  }

  const baseRow = {
    id: 'row-1',
    slug: 'a-row',
    status: ContentStatus.DRAFT,
    departmentId: null,
    deletedAt: null,
    category: { id: 't1', key: 'CLUB_LIFE', label: 'Club life', colour: '#244EA2' },
    kind: { id: 't1', key: 'CLUB_MOMENT', label: 'Club moment', colour: '#244EA2' },
    department: null,
    author: null,
    coverMedia: null,
    startsAt: new Date('2026-09-01T10:00:00.000Z'),
    endsAt: null,
    publishedAt: null,
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    updatedAt: new Date('2026-08-02T09:00:00.000Z'),
  };

  describe('news', () => {
    it('checks the id against ARTICLE_CATEGORY before writing', async () => {
      const { prisma, stub } = prismaFor('article', { ...baseRow, title: 'A story', body: 'Body' });
      const taxonomy = permissiveTaxonomy();
      const service = new ArticlesService(
        prisma,
        audit,
        new ContentPolicy(),
        urls,
        taxonomy as unknown as TaxonomyService,
      );

      await service.update('row-1', { categoryId: 'cat-2' }, actor);

      expect(taxonomy.assertUsable).toHaveBeenCalledWith('cat-2', TaxonomyKind.ARTICLE_CATEGORY);
      expect(stub.update).toHaveBeenCalled();
    });

    it('does not write when the term is refused', async () => {
      const { prisma, stub } = prismaFor('article', { ...baseRow, title: 'A story', body: 'Body' });
      const service = new ArticlesService(
        prisma,
        audit,
        new ContentPolicy(),
        urls,
        refusingTaxonomy() as unknown as TaxonomyService,
      );

      await expect(service.update('row-1', { categoryId: 'ticket-term' }, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(stub.update).not.toHaveBeenCalled();
    });

    it('leaves the term alone when the payload does not mention it', async () => {
      const { prisma } = prismaFor('article', { ...baseRow, title: 'A story', body: 'Body' });
      const taxonomy = permissiveTaxonomy();
      const service = new ArticlesService(
        prisma,
        audit,
        new ContentPolicy(),
        urls,
        taxonomy as unknown as TaxonomyService,
      );

      await service.update('row-1', { title: 'Renamed' }, actor);

      expect(taxonomy.assertUsable).not.toHaveBeenCalled();
    });
  });

  describe('faqs', () => {
    it('checks the id against FAQ_CATEGORY before writing', async () => {
      const { prisma, stub } = prismaFor('faq', {
        ...baseRow,
        question: 'A question?',
        answer: 'An answer.',
        position: 0,
      });
      const taxonomy = permissiveTaxonomy();
      const service = new FaqsService(
        prisma,
        audit,
        new ContentPolicy(),
        taxonomy as unknown as TaxonomyService,
      );

      await service.update('row-1', { categoryId: 'cat-2' }, actor);

      expect(taxonomy.assertUsable).toHaveBeenCalledWith('cat-2', TaxonomyKind.FAQ_CATEGORY);
      expect(stub.update).toHaveBeenCalled();
    });

    it('does not write when the term is refused', async () => {
      const { prisma, stub } = prismaFor('faq', {
        ...baseRow,
        question: 'A question?',
        answer: 'An answer.',
        position: 0,
      });
      const service = new FaqsService(
        prisma,
        audit,
        new ContentPolicy(),
        refusingTaxonomy() as unknown as TaxonomyService,
      );

      await expect(service.update('row-1', { categoryId: 'news-term' }, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(stub.update).not.toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('checks the id against EVENT_KIND before writing', async () => {
      const { prisma, stub } = prismaFor('event', {
        ...baseRow,
        title: 'An event',
        description: 'Details.',
        kindId: 't1',
      });
      const taxonomy = permissiveTaxonomy();
      const service = new EventsService(
        prisma,
        audit,
        new ContentPolicy(),
        urls,
        taxonomy as unknown as TaxonomyService,
      );

      await service.update('row-1', { kindId: 'kind-2' }, actor);

      expect(taxonomy.assertUsable).toHaveBeenCalledWith('kind-2', TaxonomyKind.EVENT_KIND);
      expect(stub.update).toHaveBeenCalled();
    });

    it('does not write when the term is refused', async () => {
      const { prisma, stub } = prismaFor('event', {
        ...baseRow,
        title: 'An event',
        description: 'Details.',
        kindId: 't1',
      });
      const service = new EventsService(
        prisma,
        audit,
        new ContentPolicy(),
        urls,
        refusingTaxonomy() as unknown as TaxonomyService,
      );

      await expect(service.update('row-1', { kindId: 'faq-term' }, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(stub.update).not.toHaveBeenCalled();
    });
  });
});
