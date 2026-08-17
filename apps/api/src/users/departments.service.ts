import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, slugify, type DepartmentDto, type DepartmentInput } from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DepartmentDto[]> {
    const rows = await this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      colour: row.colour,
      memberCount: row._count.users,
    }));
  }

  async create(input: DepartmentInput, actor: AuthenticatedUser): Promise<DepartmentDto> {
    const row = await this.prisma.department.create({
      data: {
        name: input.name,
        slug: slugify(input.name),
        description: input.description ?? null,
        colour: input.colour,
      },
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Department',
      entityId: row.id,
      summary: `Created department "${row.name}"`,
      actorId: actor.id,
    });
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      colour: row.colour,
    };
  }

  async update(
    id: string,
    input: DepartmentInput,
    actor: AuthenticatedUser,
  ): Promise<DepartmentDto> {
    const existing = await this.prisma.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Department not found');

    const row = await this.prisma.department.update({
      where: { id },
      data: {
        name: input.name,
        slug: slugify(input.name),
        description: input.description ?? null,
        colour: input.colour,
      },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Department',
      entityId: id,
      summary: `Updated department "${row.name}"`,
      actorId: actor.id,
      changes: AuditService.diff({ ...existing }, { ...row }),
    });
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      colour: row.colour,
    };
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.department.findUnique({
      where: { id },
      // Every relation that points at a department must be counted here, not
      // just the three that were. Events, FAQs and gallery albums are all
      // `onDelete: SetNull`, so deleting a department that owned only those
      // succeeded silently and set their `departmentId` to NULL — which in
      // this system means "org-wide". Content restricted to one team became
      // visible to the entire club, with an audit line that said only
      // "Deleted department".
      include: {
        _count: {
          select: {
            users: true,
            articles: true,
            policies: true,
            events: true,
            faqs: true,
            albums: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Department not found');

    const counts = existing._count;
    const references =
      counts.users +
      counts.articles +
      counts.policies +
      counts.events +
      counts.faqs +
      counts.albums;
    if (references > 0) {
      throw new BadRequestException(
        `${existing.name} still has ${references} linked record${references === 1 ? '' : 's'}. Reassign them first.`,
      );
    }

    await this.prisma.department.delete({ where: { id } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Department',
      entityId: id,
      summary: `Deleted department "${existing.name}"`,
      actorId: actor.id,
    });
  }
}
