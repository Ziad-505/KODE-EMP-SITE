import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ContentStatus,
  Permission,
  type AdminListQuery,
  type ChangeStatusInput,
  type CreatePolicyInput,
  type Page,
  type PolicyDto,
  type PublicListQuery,
  type UpdatePolicyInput,
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
  create: Permission.POLICY_CREATE,
  update: Permission.POLICY_UPDATE,
  remove: Permission.POLICY_DELETE,
  publish: Permission.POLICY_PUBLISH,
};

const INCLUDE = {
  documentMedia: { select: { storageKey: true } },
  department: { select: { id: true, name: true, colour: true } },
} satisfies Prisma.PolicyInclude;

type PolicyRow = Prisma.PolicyGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ContentPolicy,
    private readonly urls: MediaUrlService,
  ) {}

  async listPublic(
    query: PublicListQuery,
    actor: AuthenticatedUser | null,
  ): Promise<Page<PolicyDto>> {
    const where: Prisma.PolicyWhereInput = {
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      AND: [
        ...this.policy.portalVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.policy.count({ where }),
      this.prisma.policy.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ departmentId: 'asc' }, { title: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async findPublicBySlug(slug: string, actor: AuthenticatedUser | null): Promise<PolicyDto> {
    const row = await this.prisma.policy.findFirst({
      where: { slug, AND: this.policy.portalVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('That policy is not available');
    return this.toDto(row);
  }

  async list(query: AdminListQuery, actor: AuthenticatedUser): Promise<Page<PolicyDto>> {
    const where: Prisma.PolicyWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      AND: [
        ...this.policy.cmsVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.policy.count({ where }),
      this.prisma.policy.findMany({
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

  async findOne(id: string, actor: AuthenticatedUser): Promise<PolicyDto> {
    return this.toDto(await this.getOwnedOrThrow(id, actor));
  }

  async create(input: CreatePolicyInput, actor: AuthenticatedUser): Promise<PolicyDto> {
    const departmentId =
      input.departmentId ?? (actor.scope === 'department' ? actor.departmentId : null);
    this.policy.assertCanWrite(actor, PERMISSIONS.create, departmentId);
    const status = this.policy.resolveInitialStatus(actor, input.status, PERMISSIONS.publish);

    const row = await this.prisma.policy.create({
      data: {
        slug: await this.nextSlug(input.slug ?? input.title),
        title: input.title,
        summary: input.summary ?? null,
        body: input.body,
        version: input.version,
        effectiveFrom: input.effectiveFrom ?? null,
        reviewDueAt: input.reviewDueAt ?? null,
        documentMediaId: input.documentMediaId ?? null,
        departmentId,
        status,
      },
      include: INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Policy',
      entityId: row.id,
      summary: `Created policy "${row.title}" v${row.version} (${row.status})`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async update(id: string, input: UpdatePolicyInput, actor: AuthenticatedUser): Promise<PolicyDto> {
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

    const row = await this.prisma.policy.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: await this.nextSlug(input.slug, id) } : {}),
        ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.effectiveFrom !== undefined
          ? { effectiveFrom: input.effectiveFrom ?? null }
          : {}),
        ...(input.reviewDueAt !== undefined ? { reviewDueAt: input.reviewDueAt ?? null } : {}),
        ...(input.documentMediaId !== undefined
          ? { documentMediaId: input.documentMediaId ?? null }
          : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Policy',
      entityId: id,
      summary: `Updated policy "${row.title}"`,
      actorId: actor.id,
      changes: AuditService.diff(flatten(existing), flatten(row)),
    });
    return this.toDto(row);
  }

  async changeStatus(
    id: string,
    input: ChangeStatusInput,
    actor: AuthenticatedUser,
  ): Promise<PolicyDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    this.policy.assertCanSetStatus(
      actor,
      PERMISSIONS,
      existing.status as ContentStatus,
      input.status,
    );
    const row = await this.prisma.policy.update({
      where: { id },
      data: { status: input.status },
      include: INCLUDE,
    });
    await this.audit.record({
      action: input.status === ContentStatus.ARCHIVED ? AuditAction.ARCHIVE : AuditAction.PUBLISH,
      entityType: 'Policy',
      entityId: id,
      summary: `Moved "${row.title}" from ${existing.status} to ${input.status}${input.note ? `: ${input.note}` : ''}`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.remove, existing.departmentId);
    await this.prisma.policy.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Policy',
      entityId: id,
      summary: `Deleted policy "${existing.title}"`,
      actorId: actor.id,
    });
  }

  private async getOwnedOrThrow(id: string, actor: AuthenticatedUser): Promise<PolicyRow> {
    const row = await this.prisma.policy.findFirst({
      where: { id, deletedAt: null, AND: this.policy.cmsVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Policy not found');
    return row;
  }

  private async nextSlug(desired: string, excludeId?: string): Promise<string> {
    const taken = await this.prisma.policy.findMany({
      where: excludeId ? { NOT: { id: excludeId } } : {},
      select: { slug: true },
    });
    return uniqueSlug(
      desired,
      taken.map((row) => row.slug),
    );
  }

  toDto(row: PolicyRow): PolicyDto {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      body: row.body,
      version: row.version,
      status: row.status as ContentStatus,
      effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
      reviewDueAt: row.reviewDueAt?.toISOString() ?? null,
      documentUrl: this.urls.toUrl(row.documentMedia?.storageKey),
      department: row.department,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function searchClause(q: string): Prisma.PolicyWhereInput[] {
  const mode = 'insensitive' as const;
  return [
    { title: { contains: q, mode } },
    { summary: { contains: q, mode } },
    { body: { contains: q, mode } },
  ];
}

function flatten(row: PolicyRow): Record<string, unknown> {
  return {
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    version: row.version,
    status: row.status,
    departmentId: row.departmentId,
    effectiveFrom: row.effectiveFrom,
    reviewDueAt: row.reviewDueAt,
  };
}
