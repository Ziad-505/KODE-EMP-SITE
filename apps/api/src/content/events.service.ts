import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ContentStatus,
  Permission,
  slugify,
  TaxonomyKind,
  type ChangeStatusInput,
  type CreateEventInput,
  type EventDto,
  type ListEventsQuery,
  type Page,
  type PublicListQuery,
  type UpdateEventInput,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaUrlService } from '../media/media-url.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  ContentPolicy,
  auditActionForUpdate,
  orderByFor,
  pageMeta,
  uniqueSlug,
  type ContentPermissionSet,
} from './content.policy';

const PERMISSIONS: ContentPermissionSet = {
  create: Permission.EVENT_CREATE,
  update: Permission.EVENT_UPDATE,
  remove: Permission.EVENT_DELETE,
  publish: Permission.EVENT_PUBLISH,
};

const INCLUDE = {
  coverMedia: { select: { storageKey: true } },
  department: { select: { id: true, name: true, colour: true } },
  // The term travels with the event, carrying its own label and colour. That is
  // what lets a frontend deployed before a new kind existed render it correctly
  // instead of looking the key up in a compiled-in map and printing `undefined`.
  kind: { select: { id: true, key: true, label: true, colour: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ContentPolicy,
    private readonly urls: MediaUrlService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  async listPublic(
    query: PublicListQuery,
    actor: AuthenticatedUser | null,
  ): Promise<Page<EventDto>> {
    const where: Prisma.EventWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      AND: [
        ...this.policy.portalVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        include: INCLUDE,
        orderBy: { startsAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async listUpcomingPublic(limit: number, actor: AuthenticatedUser | null): Promise<EventDto[]> {
    const rows = await this.prisma.event.findMany({
      where: { startsAt: { gte: startOfToday() }, AND: this.policy.portalVisibility(actor) },
      include: INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toDto(row));
  }

  async findPublicBySlug(slug: string, actor: AuthenticatedUser | null): Promise<EventDto> {
    const row = await this.prisma.event.findFirst({
      where: { slug, AND: this.policy.portalVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('That event is not available');
    return this.toDto(row);
  }

  async list(query: ListEventsQuery, actor: AuthenticatedUser): Promise<Page<EventDto>> {
    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kindId ? { kindId: query.kindId } : {}),
      ...(query.upcoming ? { startsAt: { gte: startOfToday() } } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      AND: [
        ...this.policy.cmsVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
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

  async findOne(id: string, actor: AuthenticatedUser): Promise<EventDto> {
    return this.toDto(await this.getOwnedOrThrow(id, actor));
  }

  async create(input: CreateEventInput, actor: AuthenticatedUser): Promise<EventDto> {
    const departmentId =
      input.departmentId ?? (actor.scope === 'department' ? actor.departmentId : null);
    this.policy.assertCanWrite(actor, PERMISSIONS.create, departmentId);
    // Rejects an id from another namespace or an archived term, so a client
    // cannot file an event under a news category by passing its id.
    await this.taxonomy.assertUsable(input.kindId, TaxonomyKind.EVENT_KIND);
    const status = this.policy.resolveInitialStatus(actor, input.status, PERMISSIONS.publish);

    const row = await this.prisma.event.create({
      data: {
        slug: await this.nextSlug(input.slug ?? input.title),
        title: input.title,
        description: input.description,
        kindId: input.kindId,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        capacity: input.capacity ?? null,
        coverMediaId: input.coverMediaId ?? null,
        departmentId,
        status,
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Event',
      entityId: row.id,
      summary: `Created event "${row.title}" (${row.status})`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async update(id: string, input: UpdateEventInput, actor: AuthenticatedUser): Promise<EventDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    if (input.departmentId !== undefined) {
      this.policy.assertCanWrite(actor, PERMISSIONS.update, input.departmentId ?? null);
    }
    if (input.status) {
      this.policy.assertCanSetStatus(
        actor,
        PERMISSIONS,
        existing.status as ContentStatus,
        input.status,
      );
    }
    if (input.startsAt || input.endsAt !== undefined) {
      const startsAt = input.startsAt ?? existing.startsAt;
      const endsAt = input.endsAt !== undefined ? input.endsAt : existing.endsAt;
      if (endsAt && endsAt < startsAt) {
        // A cross-field validation failure, not a missing record.
        throw new BadRequestException('End time must be after the start time');
      }
    }

    // The same check `create` makes. The foreign key only proves the id names
    // some row in `taxonomies`; it cannot tell an event kind from a news
    // category, and it does not know about archiving. Without this, a term that
    // cannot be chosen on create is still applicable on edit.
    if (input.kindId !== undefined) {
      await this.taxonomy.assertUsable(input.kindId, TaxonomyKind.EVENT_KIND);
    }

    const row = await this.prisma.event.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: await this.nextSlug(input.slug, id) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.kindId !== undefined ? { kindId: input.kindId } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ?? null } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity ?? null } : {}),
        ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId ?? null } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: auditActionForUpdate(existing.status as ContentStatus, input.status),
      entityType: 'Event',
      entityId: id,
      summary: `Updated event "${row.title}"`,
      actorId: actor.id,
      changes: AuditService.diff(flatten(existing), flatten(row)),
    });
    return this.toDto(row);
  }

  async changeStatus(
    id: string,
    input: ChangeStatusInput,
    actor: AuthenticatedUser,
  ): Promise<EventDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    this.policy.assertCanSetStatus(
      actor,
      PERMISSIONS,
      existing.status as ContentStatus,
      input.status,
    );

    const row = await this.prisma.event.update({
      where: { id },
      data: { status: input.status },
      include: INCLUDE,
    });
    await this.audit.record({
      action: input.status === ContentStatus.ARCHIVED ? AuditAction.ARCHIVE : AuditAction.PUBLISH,
      entityType: 'Event',
      entityId: id,
      summary: `Moved "${row.title}" from ${existing.status} to ${input.status}${input.note ? `: ${input.note}` : ''}`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.remove, existing.departmentId);
    await this.prisma.event.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Event',
      entityId: id,
      summary: `Deleted event "${existing.title}"`,
      actorId: actor.id,
    });
  }

  private async getOwnedOrThrow(id: string, actor: AuthenticatedUser): Promise<EventRow> {
    const row = await this.prisma.event.findFirst({
      where: { id, deletedAt: null, AND: this.policy.cmsVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Event not found');
    return row;
  }

  /**
   * Next free slug for this table.
   *
   * Two changes from the original. It filters on the slug prefix instead of
   * loading every slug in the table into memory on each create, and it no
   * longer excludes soft-deleted rows implicitly: a soft-deleted row still owns
   * its slug at the database level (the unique index does not care about
   * `deletedAt`), so pretending otherwise produced a P2002 on what looked like
   * a free name.
   *
   * The check-then-insert is still not atomic — two editors publishing the same
   * title in the same instant both compute the same candidate and the second
   * gets a 409 from the unique index. That is the correct outcome, and the
   * index is the real guarantee; this only makes the common case pleasant.
   */
  private async nextSlug(desired: string, excludeId?: string): Promise<string> {
    const base = slugify(desired) || 'item';
    const taken = await this.prisma.event.findMany({
      where: {
        slug: { startsWith: base },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { slug: true },
    });
    return uniqueSlug(
      desired,
      taken.map((row) => row.slug),
    );
  }

  toDto(row: EventRow): EventDto {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      kind: {
        id: row.kind.id,
        key: row.kind.key,
        label: row.kind.label,
        colour: row.kind.colour,
      },
      location: row.location,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      capacity: row.capacity,
      status: row.status as ContentStatus,
      coverUrl: this.urls.toUrl(row.coverMedia?.storageKey),
      department: row.department,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Local midnight. Exported so the homepage counts use exactly the same
 * boundary as the list they sit beside; two definitions of "today" produced a
 * count that disagreed with the rows under it.
 */
export function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function searchClause(q: string): Prisma.EventWhereInput[] {
  const mode = 'insensitive' as const;
  return [
    { title: { contains: q, mode } },
    { description: { contains: q, mode } },
    { location: { contains: q, mode } },
  ];
}

function flatten(row: EventRow): Record<string, unknown> {
  return {
    title: row.title,
    slug: row.slug,
    description: row.description,
    kindId: row.kindId,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    status: row.status,
    departmentId: row.departmentId,
  };
}
