import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ContentStatus,
  Permission,
  type AdminListQuery,
  type ArticleDto,
  type ChangeStatusInput,
  type CreateArticleInput,
  type Page,
  type PublicListQuery,
  type UpdateArticleInput,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaUrlService } from '../media/media-url.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  ContentPolicy,
  auditActionForUpdate,
  orderByFor,
  pageMeta,
  resolvePublishedAt,
  uniqueSlug,
  type ContentPermissionSet,
} from './content.policy';

const PERMISSIONS: ContentPermissionSet = {
  create: Permission.NEWS_CREATE,
  update: Permission.NEWS_UPDATE,
  remove: Permission.NEWS_DELETE,
  publish: Permission.NEWS_PUBLISH,
};

const INCLUDE = {
  coverMedia: { select: { storageKey: true } },
  department: { select: { id: true, name: true, colour: true } },
  author: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ArticleInclude;

type ArticleRow = Prisma.ArticleGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ContentPolicy,
    private readonly urls: MediaUrlService,
  ) {}

  /* ------------------------------- portal ------------------------------- */

  async listPublic(
    query: PublicListQuery,
    actor: AuthenticatedUser | null,
  ): Promise<Page<ArticleDto>> {
    const where: Prisma.ArticleWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      AND: [
        ...this.policy.portalVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async findPublicBySlug(slug: string, actor: AuthenticatedUser | null): Promise<ArticleDto> {
    const row = await this.prisma.article.findFirst({
      where: { slug, AND: this.policy.portalVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('That story is not available');
    return this.toDto(row);
  }

  /* --------------------------------- CMS -------------------------------- */

  async list(query: AdminListQuery, actor: AuthenticatedUser): Promise<Page<ArticleDto>> {
    const where: Prisma.ArticleWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      AND: [
        ...this.policy.cmsVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        include: INCLUDE,
        orderBy: orderByFor(query, ['updatedAt', 'createdAt', 'title', 'publishedAt']),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<ArticleDto> {
    const row = await this.getOwnedOrThrow(id, actor);
    return this.toDto(row);
  }

  async create(input: CreateArticleInput, actor: AuthenticatedUser): Promise<ArticleDto> {
    const departmentId = this.resolveDepartment(input.departmentId, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.create, departmentId);

    const status = this.policy.resolveInitialStatus(actor, input.status, PERMISSIONS.publish);
    const slug = await this.nextSlug(input.slug ?? input.title);

    const row = await this.prisma.article.create({
      data: {
        slug,
        title: input.title,
        excerpt: input.excerpt ?? null,
        body: input.body,
        category: input.category,
        pinned: input.pinned,
        status,
        coverMediaId: input.coverMediaId ?? null,
        departmentId,
        authorId: actor.id,
        publishedAt: resolvePublishedAt(status, null, input.publishedAt ?? undefined),
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Article',
      entityId: row.id,
      summary: `Created news story "${row.title}" (${row.status})`,
      actorId: actor.id,
    });

    return this.toDto(row);
  }

  async update(
    id: string,
    input: UpdateArticleInput,
    actor: AuthenticatedUser,
  ): Promise<ArticleDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);

    if (input.departmentId !== undefined) {
      this.policy.assertCanWrite(actor, PERMISSIONS.update, input.departmentId ?? null);
    }

    const nextStatus = input.status ?? (existing.status as ContentStatus);
    if (input.status) {
      this.policy.assertCanSetStatus(
        actor,
        PERMISSIONS,
        existing.status as ContentStatus,
        input.status,
      );
    }

    const row = await this.prisma.article.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: await this.nextSlug(input.slug, id) } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt ?? null } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId ?? null } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        /*
         * `publishedAt` is only honoured from the request when the actor may
         * actually publish. It was applied unconditionally, so an editor who
         * cannot publish could set it to 2030; `resolvePublishedAt` then keeps
         * the existing value on a later publish, and the story sat at the top
         * of `orderBy publishedAt desc` permanently.
         */
        publishedAt: resolvePublishedAt(
          nextStatus,
          existing.publishedAt,
          actor.can(PERMISSIONS.publish) ? (input.publishedAt ?? undefined) : undefined,
        ),
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: auditActionForUpdate(existing.status as ContentStatus, input.status),
      entityType: 'Article',
      entityId: id,
      summary: `Updated news story "${row.title}"`,
      actorId: actor.id,
      changes: AuditService.diff(flatten(existing), flatten(row)),
    });

    return this.toDto(row);
  }

  async changeStatus(
    id: string,
    input: ChangeStatusInput,
    actor: AuthenticatedUser,
  ): Promise<ArticleDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    this.policy.assertCanSetStatus(
      actor,
      PERMISSIONS,
      existing.status as ContentStatus,
      input.status,
    );

    const row = await this.prisma.article.update({
      where: { id },
      data: {
        status: input.status,
        publishedAt: resolvePublishedAt(input.status, existing.publishedAt),
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: input.status === ContentStatus.ARCHIVED ? AuditAction.ARCHIVE : AuditAction.PUBLISH,
      entityType: 'Article',
      entityId: id,
      summary: `Moved "${row.title}" from ${existing.status} to ${input.status}${input.note ? `: ${input.note}` : ''}`,
      actorId: actor.id,
    });

    return this.toDto(row);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.remove, existing.departmentId);

    // Soft delete: the row stays so the audit trail keeps pointing somewhere real.
    await this.prisma.article.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Article',
      entityId: id,
      summary: `Deleted news story "${existing.title}"`,
      actorId: actor.id,
    });
  }

  /* ------------------------------ internals ----------------------------- */

  private async getOwnedOrThrow(id: string, actor: AuthenticatedUser): Promise<ArticleRow> {
    const row = await this.prisma.article.findFirst({
      where: { id, deletedAt: null, AND: this.policy.cmsVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('News story not found');
    return row;
  }

  private resolveDepartment(
    requested: string | null | undefined,
    actor: AuthenticatedUser,
  ): string | null {
    if (requested !== undefined && requested !== null) return requested;
    // A department-scoped author defaults to their own department rather than
    // accidentally creating club-wide content.
    return actor.scope === 'department' ? actor.departmentId : null;
  }

  private async nextSlug(desired: string, excludeId?: string): Promise<string> {
    const taken = await this.prisma.article.findMany({
      where: excludeId ? { NOT: { id: excludeId } } : {},
      select: { slug: true },
    });
    return uniqueSlug(
      desired,
      taken.map((row) => row.slug),
    );
  }

  toDto(row: ArticleRow): ArticleDto {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      body: row.body,
      category: row.category,
      pinned: row.pinned,
      status: row.status as ContentStatus,
      coverUrl: this.urls.toUrl(row.coverMedia?.storageKey),
      department: row.department,
      author: row.author
        ? {
            id: row.author.id,
            displayName: `${row.author.firstName} ${row.author.lastName}`.trim(),
          }
        : null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function searchClause(q: string): Prisma.ArticleWhereInput[] {
  const mode = 'insensitive' as const;
  return [
    { title: { contains: q, mode } },
    { excerpt: { contains: q, mode } },
    { body: { contains: q, mode } },
    { category: { contains: q, mode } },
  ];
}

function flatten(row: ArticleRow): Record<string, unknown> {
  return {
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    body: row.body,
    category: row.category,
    pinned: row.pinned,
    status: row.status,
    departmentId: row.departmentId,
    coverMediaId: row.coverMediaId,
  };
}
