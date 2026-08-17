import { Injectable } from '@nestjs/common';
import { ContentStatus, Permission, type CmsDashboardDto } from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ContentPolicy } from './content.policy';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ContentPolicy,
  ) {}

  async build(actor: AuthenticatedUser): Promise<CmsDashboardDto> {
    const base = { deletedAt: null, AND: this.policy.cmsVisibility(actor) };

    const [
      publishedArticles,
      publishedEvents,
      publishedPolicies,
      publishedFaqs,
      reviewArticles,
      reviewEvents,
      reviewPolicies,
      draftArticles,
      draftEvents,
      draftPolicies,
      mediaItems,
      openTickets,
      people,
      attentionPolicies,
      attentionArticles,
      recentActivity,
      rhythm,
    ] = await Promise.all([
      this.prisma.article.count({ where: { ...base, status: ContentStatus.PUBLISHED } }),
      this.prisma.event.count({ where: { ...base, status: ContentStatus.PUBLISHED } }),
      this.prisma.policy.count({ where: { ...base, status: ContentStatus.PUBLISHED } }),
      this.prisma.faq.count({ where: { ...base, status: ContentStatus.PUBLISHED } }),
      this.prisma.article.count({ where: { ...base, status: ContentStatus.IN_REVIEW } }),
      this.prisma.event.count({ where: { ...base, status: ContentStatus.IN_REVIEW } }),
      this.prisma.policy.count({ where: { ...base, status: ContentStatus.IN_REVIEW } }),
      this.prisma.article.count({ where: { ...base, status: ContentStatus.DRAFT } }),
      this.prisma.event.count({ where: { ...base, status: ContentStatus.DRAFT } }),
      this.prisma.policy.count({ where: { ...base, status: ContentStatus.DRAFT } }),
      this.prisma.media.count({ where: { deletedAt: null } }),
      this.prisma.supportTicket.count({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
      }),
      this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.policy.findMany({
        where: { ...base, reviewDueAt: { not: null, lte: new Date(Date.now() + 14 * 86_400_000) } },
        select: { id: true, title: true, slug: true, status: true, reviewDueAt: true },
        orderBy: { reviewDueAt: 'asc' },
        take: 4,
      }),
      this.prisma.article.findMany({
        where: { ...base, status: ContentStatus.IN_REVIEW },
        select: { id: true, title: true, slug: true, status: true },
        orderBy: { updatedAt: 'asc' },
        take: 4,
      }),
      // The audit trail is gated on `audit:read`, which only a Super Admin
      // holds. Embedding it in a dashboard that requires only `cms:access`
      // handed the whole thing to every Department Editor, including lines
      // like "Changed X from Content Editor to Super Admin" and "Reset the
      // password for Y". The permission is now checked where the data is read,
      // not only on the dedicated endpoint.
      actor.can(Permission.AUDIT_READ) ? this.audit.recentActivity(6) : Promise.resolve([]),
      this.publishingRhythm(),
    ]);

    return {
      counts: {
        published: publishedArticles + publishedEvents + publishedPolicies + publishedFaqs,
        inReview: reviewArticles + reviewEvents + reviewPolicies,
        drafts: draftArticles + draftEvents + draftPolicies,
        mediaItems,
        openTickets,
        people,
      },
      needsAttention: [
        ...attentionPolicies.map((row) => ({
          id: row.id,
          type: 'policy' as const,
          title: row.title,
          reason:
            row.reviewDueAt && row.reviewDueAt < new Date()
              ? 'Policy review overdue'
              : 'Policy review due soon',
          status: row.status as ContentStatus,
          href: `/policies/${row.id}`,
        })),
        ...attentionArticles.map((row) => ({
          id: row.id,
          type: 'news' as const,
          title: row.title,
          reason: 'Awaiting final approval',
          status: row.status as ContentStatus,
          href: `/news/${row.id}`,
        })),
      ].slice(0, 6),
      publishingRhythm: rhythm,
      recentActivity,
    };
  }

  /** Published items per day for the current week, for the dashboard strip. */
  private async publishingRhythm(): Promise<{ date: string; count: number }[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() + (start.getDay() === 0 ? -6 : 1));

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });

    const published = await this.prisma.article.findMany({
      where: { status: ContentStatus.PUBLISHED, deletedAt: null, publishedAt: { gte: start } },
      select: { publishedAt: true },
    });

    return days.map((day) => {
      const next = new Date(day);
      next.setDate(day.getDate() + 1);
      const count = published.filter(
        (row) => row.publishedAt && row.publishedAt >= day && row.publishedAt < next,
      ).length;
      // Labelled in local time. `toISOString()` renders a *local* midnight as
      // its UTC date, so at UTC+4 every bar was attributed to the previous day:
      // the strip read Sunday to Saturday while counting Monday to Sunday.
      return { date: localDateKey(day), count };
    });
  }
}

/** `YYYY-MM-DD` in the server's own timezone, not shifted through UTC. */
function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
