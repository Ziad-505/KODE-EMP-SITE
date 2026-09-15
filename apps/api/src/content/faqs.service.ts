import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ContentStatus,
  Permission,
  TaxonomyKind,
  type AdminListQuery,
  type ChangeStatusInput,
  type CreateFaqInput,
  type FaqDto,
  type Page,
  type PublicListQuery,
  type UpdateFaqInput,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ContentPolicy, orderByFor, pageMeta, type ContentPermissionSet } from './content.policy';

const PERMISSIONS: ContentPermissionSet = {
  create: Permission.FAQ_CREATE,
  update: Permission.FAQ_UPDATE,
  remove: Permission.FAQ_DELETE,
  publish: Permission.FAQ_PUBLISH,
};

const CATEGORY_SELECT = { select: { id: true, key: true, label: true, colour: true } };

const INCLUDE = {
  category: CATEGORY_SELECT,
  department: { select: { id: true, name: true, colour: true } },
} satisfies Prisma.FaqInclude;
type FaqRow = Prisma.FaqGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class FaqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ContentPolicy,
    private readonly taxonomy: TaxonomyService,
  ) {}

  async listPublic(query: PublicListQuery, actor: AuthenticatedUser | null): Promise<Page<FaqDto>> {
    const where: Prisma.FaqWhereInput = {
      AND: [
        ...this.policy.portalVisibility(actor),
        // `departmentId` is part of the shared public list query. It was
        // accepted and silently discarded here while articles, events and
        // policies honoured it, so the filter returned 200 and did nothing.
        ...(query.departmentId ? [{ departmentId: query.departmentId }] : []),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.faq.count({ where }),
      this.prisma.faq.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ position: 'asc' }, { question: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async list(query: AdminListQuery, actor: AuthenticatedUser): Promise<Page<FaqDto>> {
    const where: Prisma.FaqWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      AND: [
        ...this.policy.cmsVisibility(actor),
        ...(query.q ? [{ OR: searchClause(query.q) }] : []),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.faq.count({ where }),
      this.prisma.faq.findMany({
        where,
        include: INCLUDE,
        orderBy: orderByFor(query, ['updatedAt', 'createdAt']),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<FaqDto> {
    return this.toDto(await this.getOwnedOrThrow(id, actor));
  }

  async create(input: CreateFaqInput, actor: AuthenticatedUser): Promise<FaqDto> {
    const departmentId =
      input.departmentId ?? (actor.scope === 'department' ? actor.departmentId : null);
    this.policy.assertCanWrite(actor, PERMISSIONS.create, departmentId);
    await this.taxonomy.assertUsable(input.categoryId, TaxonomyKind.FAQ_CATEGORY);
    const status = this.policy.resolveInitialStatus(actor, input.status, PERMISSIONS.publish);

    const row = await this.prisma.faq.create({
      data: {
        question: input.question,
        answer: input.answer,
        categoryId: input.categoryId,
        position: input.position,
        departmentId,
        status,
      },
      include: INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Faq',
      entityId: row.id,
      summary: `Created FAQ "${row.question}" (${row.status})`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async update(id: string, input: UpdateFaqInput, actor: AuthenticatedUser): Promise<FaqDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    if (input.departmentId !== undefined) {
      this.policy.assertCanWrite(actor, PERMISSIONS.update, input.departmentId ?? null);
    }
    // The same check `create` makes. The foreign key only proves the id names
    // some row in `taxonomies`; it cannot tell an FAQ category from a ticket
    // category, and it does not know about archiving. Without this, a term that
    // cannot be chosen on create is still applicable on edit.
    if (input.categoryId !== undefined) {
      await this.taxonomy.assertUsable(input.categoryId, TaxonomyKind.FAQ_CATEGORY);
    }
    if (input.status) {
      this.policy.assertCanSetStatus(
        actor,
        PERMISSIONS,
        existing.status as ContentStatus,
        input.status,
      );
    }
    const row = await this.prisma.faq.update({
      where: { id },
      data: {
        ...(input.question !== undefined ? { question: input.question } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Faq',
      entityId: id,
      summary: `Updated FAQ "${row.question}"`,
      actorId: actor.id,
      changes: AuditService.diff(flatten(existing), flatten(row)),
    });
    return this.toDto(row);
  }

  async changeStatus(
    id: string,
    input: ChangeStatusInput,
    actor: AuthenticatedUser,
  ): Promise<FaqDto> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.update, existing.departmentId);
    this.policy.assertCanSetStatus(
      actor,
      PERMISSIONS,
      existing.status as ContentStatus,
      input.status,
    );
    const row = await this.prisma.faq.update({
      where: { id },
      data: { status: input.status },
      include: INCLUDE,
    });
    await this.audit.record({
      action: input.status === ContentStatus.ARCHIVED ? AuditAction.ARCHIVE : AuditAction.PUBLISH,
      entityType: 'Faq',
      entityId: id,
      summary: `Moved FAQ "${row.question}" to ${input.status}`,
      actorId: actor.id,
    });
    return this.toDto(row);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.getOwnedOrThrow(id, actor);
    this.policy.assertCanWrite(actor, PERMISSIONS.remove, existing.departmentId);
    await this.prisma.faq.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Faq',
      entityId: id,
      summary: `Deleted FAQ "${existing.question}"`,
      actorId: actor.id,
    });
  }

  private async getOwnedOrThrow(id: string, actor: AuthenticatedUser): Promise<FaqRow> {
    const row = await this.prisma.faq.findFirst({
      where: { id, deletedAt: null, AND: this.policy.cmsVisibility(actor) },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('FAQ not found');
    return row;
  }

  toDto(row: FaqRow): FaqDto {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      category: {
        id: row.category.id,
        key: row.category.key,
        label: row.category.label,
        colour: row.category.colour,
      },
      position: row.position,
      status: row.status as ContentStatus,
      department: row.department,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function searchClause(q: string): Prisma.FaqWhereInput[] {
  const mode = 'insensitive' as const;
  return [
    { question: { contains: q, mode } },
    { answer: { contains: q, mode } },
    { category: { label: { contains: q, mode } } },
  ];
}

function flatten(row: FaqRow): Record<string, unknown> {
  return {
    question: row.question,
    answer: row.answer,
    categoryId: row.categoryId,
    position: row.position,
    status: row.status,
    departmentId: row.departmentId,
  };
}
