import { Injectable } from '@nestjs/common';
import { type SearchQuery, type SearchResultDto } from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ContentPolicy } from './content.policy';

/**
 * Cross-content search for the portal command palette.
 *
 * Uses case-insensitive substring matching across the small set of tables that
 * matter. At the club's data volume this is well inside acceptable latency; the
 * migration adds trigram indexes so it stays that way. Swapping in Postgres
 * full-text ranking later is a change to this one file.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ContentPolicy,
  ) {}

  async search(query: SearchQuery, actor: AuthenticatedUser | null): Promise<SearchResultDto[]> {
    const q = query.q;
    const mode = 'insensitive' as const;
    // Visibility comes from ContentPolicy rather than being re-derived here.
    // This file used to carry its own copy of the fragment, including the same
    // `actor?.departmentId ? ... : {}` hole, so a user with no department got
    // every department's private content back from search while the list
    // endpoints correctly withheld it. Two implementations of one rule is the
    // bug; one implementation is the fix.
    //
    // AND-composed so the per-table text `OR` below cannot displace it.
    const visible = { AND: this.policy.portalVisibility(actor) };
    const take = Math.ceil(query.limit / 2);

    const [articles, events, policies, faqs, albums, people] = await Promise.all([
      this.prisma.article.findMany({
        where: {
          ...visible,
          OR: [{ title: { contains: q, mode } }, { excerpt: { contains: q, mode } }],
        },
        select: { id: true, slug: true, title: true, category: true },
        take,
      }),
      this.prisma.event.findMany({
        where: {
          ...visible,
          OR: [{ title: { contains: q, mode } }, { location: { contains: q, mode } }],
        },
        select: { id: true, slug: true, title: true, location: true, startsAt: true },
        take,
      }),
      this.prisma.policy.findMany({
        where: {
          ...visible,
          OR: [{ title: { contains: q, mode } }, { summary: { contains: q, mode } }],
        },
        select: { id: true, slug: true, title: true, department: { select: { name: true } } },
        take,
      }),
      this.prisma.faq.findMany({
        where: {
          ...visible,
          OR: [{ question: { contains: q, mode } }, { answer: { contains: q, mode } }],
        },
        select: { id: true, question: true, category: true },
        take,
      }),
      this.prisma.galleryAlbum.findMany({
        where: { ...visible, title: { contains: q, mode } },
        select: { id: true, slug: true, title: true, _count: { select: { items: true } } },
        take,
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          OR: [
            { firstName: { contains: q, mode } },
            { lastName: { contains: q, mode } },
            { email: { contains: q, mode } },
            { jobTitle: { contains: q, mode } },
          ],
        },
        select: { id: true, firstName: true, lastName: true, jobTitle: true },
        take,
      }),
    ]);

    const results: SearchResultDto[] = [
      ...articles.map((row) =>
        item('news', row.id, row.slug, row.title, row.category, `/news/${row.slug}`, q),
      ),
      ...events.map((row) =>
        item(
          'event',
          row.id,
          row.slug,
          row.title,
          `${row.location} · ${formatDate(row.startsAt)}`,
          `/events/${row.slug}`,
          q,
        ),
      ),
      ...policies.map((row) =>
        item(
          'policy',
          row.id,
          row.slug,
          row.title,
          row.department?.name ?? 'General',
          `/policies/${row.slug}`,
          q,
        ),
      ),
      ...faqs.map((row) =>
        item('faq', row.id, null, row.question, row.category, `/faqs#${row.id}`, q),
      ),
      ...albums.map((row) =>
        item(
          'gallery',
          row.id,
          row.slug,
          row.title,
          `${row._count.items} photos`,
          `/gallery/${row.slug}`,
          q,
        ),
      ),
      ...people.map((row) =>
        item(
          'person',
          row.id,
          null,
          `${row.firstName} ${row.lastName}`.trim(),
          row.jobTitle,
          `/directory?person=${row.id}`,
          q,
        ),
      ),
    ];

    return results.sort((a, b) => b.rank - a.rank).slice(0, query.limit);
  }
}

/** Prefix matches outrank mid-string ones so exact typing feels responsive. */
function item(
  type: SearchResultDto['type'],
  id: string,
  slug: string | null,
  title: string,
  subtitle: string | null,
  href: string,
  q: string,
): SearchResultDto {
  const lower = title.toLowerCase();
  const needle = q.toLowerCase();
  const rank = lower === needle ? 3 : lower.startsWith(needle) ? 2 : 1;
  return { type, id, slug, title, subtitle, href, rank };
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
