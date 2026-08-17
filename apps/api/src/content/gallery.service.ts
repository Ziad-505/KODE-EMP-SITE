import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ContentStatus,
  Permission,
  type AdminListQuery,
  type AlbumDto,
  type ChangeStatusInput,
  type CreateAlbumInput,
  type Page,
  type PublicListQuery,
  type UpdateAlbumInput,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaUrlService } from '../media/media-url.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  ContentPolicy,
  orderByFor,
  pageMeta,
  uniqueSlug,
  type ContentPermissionSet,
} from './content.policy';

const PERMISSIONS: ContentPermissionSet = {
  create: Permission.GALLERY_CREATE,
  update: Permission.GALLERY_UPDATE,
  remove: Permission.GALLERY_DELETE,
  publish: Permission.GALLERY_PUBLISH,
};

const INCLUDE = {
  coverMedia: { select: { storageKey: true } },
  department: { select: { id: true, name: true, colour: true } },
  items: {
    orderBy: { position: 'asc' },
    include: { media: { select: { id: true, storageKey: true, alt: true } } },
  },
  _count: { select: { items: true } },
} satisfies Prisma.GalleryAlbumInclude;

type AlbumRow = Prisma.GalleryAlbumGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ContentPolicy,
    private readonly urls: MediaUrlService,
  ) {}

  async listPublic(
    query: PublicListQuery,
    actor: AuthenticatedUser | null,
  ): Promise<Page<AlbumDto>> {
    const where: Prisma.GalleryAlbumWhereInput = {
      AND: [
        ...this.policy.portalVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.galleryAlbum.count({ where }),
      this.prisma.galleryAlbum.findMany({
        where,
        include: INCLUDE,
        orderBy: { takenOn: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async findPublicBySlug(slug: string, actor: AuthenticatedUser | null): Promise<AlbumDto> {
    const row = await this.prisma.galleryAlbum.findFirst({
      where: { slug, AND: this.policy.portalVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('That album is not available');
    return this.toDto(row);
  }

  async list(query: AdminListQuery, actor: AuthenticatedUser): Promise<Page<AlbumDto>> {
    const where: Prisma.GalleryAlbumWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      AND: [
        ...this.policy.cmsVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.galleryAlbum.count({ where }),
      this.prisma.galleryAlbum.findMany({
        where,
        include: INCLUDE,
        orderBy: orderByFor(query, ['updatedAt', 'createdAt', 'title']),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<AlbumDto> {
    return this.toDto(await this.getOwnedOrThrow(id, actor));
  }

  async create(input: CreateAlbumInput, actor: AuthenticatedUser): Promise<AlbumDto> {
    const departmentId =
      input.departmentId ?? (actor.scope === 'department' ? actor.departmentId : null);
    this.policy.assertCanWrite(actor, PERMISSIONS.create, departmentId);
    const status = this.policy.resolveInitialStatus(actor, input.status, PERMISSIONS.publish);

    const row = await this.prisma.galleryAlbum.create({
      data: {
        slug: await this.nextSlug(input.slug ?? input.title),
        title: input.title,
        description: input.description ?? null,
        coverMediaId: input.coverMediaId ?? null,
        takenOn: input.takenOn ?? null,
        departmentId,
        status,
        items: { create: input.itemIds.map((mediaId, position) => ({ mediaId, position })) },
      },
      include: INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'GalleryAlbum',
      entityId: row.id,
      summary: `Created album "${row.title}" with ${row._count.items} item(s)`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async update(id: string, input: UpdateAlbumInput, actor: AuthenticatedUser): Promise<AlbumDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    if (input.status) {
      this.policy.assertCanSetStatus(
        actor,
        PERMISSIONS,
        existing.status as ContentStatus,
        input.status,
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.itemIds) {
        await tx.galleryItem.deleteMany({ where: { albumId: id } });
        await tx.galleryItem.createMany({
          data: input.itemIds.map((mediaId, position) => ({ albumId: id, mediaId, position })),
          skipDuplicates: true,
        });
      }
      return tx.galleryAlbum.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.slug !== undefined ? { slug: await this.nextSlug(input.slug, id) } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
          ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId ?? null } : {}),
          ...(input.takenOn !== undefined ? { takenOn: input.takenOn ?? null } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: INCLUDE,
      });
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'GalleryAlbum',
      entityId: id,
      summary: `Updated album "${row.title}"`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async changeStatus(
    id: string,
    input: ChangeStatusInput,
    actor: AuthenticatedUser,
  ): Promise<AlbumDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    this.policy.assertCanSetStatus(
      actor,
      PERMISSIONS,
      existing.status as ContentStatus,
      input.status,
    );
    const row = await this.prisma.galleryAlbum.update({
      where: { id },
      data: { status: input.status },
      include: INCLUDE,
    });
    await this.audit.record({
      action: input.status === ContentStatus.ARCHIVED ? AuditAction.ARCHIVE : AuditAction.PUBLISH,
      entityType: 'GalleryAlbum',
      entityId: id,
      summary: `Moved album "${row.title}" to ${input.status}`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.remove, existing.departmentId);
    await this.prisma.galleryAlbum.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'GalleryAlbum',
      entityId: id,
      summary: `Deleted album "${existing.title}"`,
      actorId: actor.id,
    });
  }

  private async getOwnedOrThrow(id: string, actor: AuthenticatedUser): Promise<AlbumRow> {
    const row = await this.prisma.galleryAlbum.findFirst({
      where: { id, deletedAt: null, AND: this.policy.cmsVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Album not found');
    return row;
  }

  private async nextSlug(desired: string, excludeId?: string): Promise<string> {
    const taken = await this.prisma.galleryAlbum.findMany({
      where: excludeId ? { NOT: { id: excludeId } } : {},
      select: { slug: true },
    });
    return uniqueSlug(
      desired,
      taken.map((row) => row.slug),
    );
  }

  toDto(row: AlbumRow): AlbumDto {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      status: row.status as ContentStatus,
      coverUrl: this.urls.toUrl(row.coverMedia?.storageKey),
      takenOn: row.takenOn?.toISOString() ?? null,
      itemCount: row._count.items,
      items: row.items.map((item) => ({
        id: item.media.id,
        url: this.urls.toUrl(item.media.storageKey)!,
        alt: item.caption ?? item.media.alt,
      })),
      department: row.department,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function searchClause(q: string): Prisma.GalleryAlbumWhereInput[] {
  const mode = 'insensitive' as const;
  return [{ title: { contains: q, mode } }, { description: { contains: q, mode } }];
}
