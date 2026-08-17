import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  TaxonomyKind,
  type CreateTaxonomyInput,
  type ListTaxonomyQuery,
  type TaxonomyDto,
  type UpdateTaxonomyInput,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * Admin-managed terms.
 *
 * Deliberately one service for all four namespaces rather than four services.
 * The rules are identical, and the reason the old model was painful is that the
 * same concept was implemented three different ways (two Postgres enums and two
 * unconstrained free-text columns) with no shared behaviour between them.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Usage counts drive the CMS delete affordance, so they are computed here
   * rather than left to the client. Only event kinds have a relation today; the
   * other three namespaces are wired in the same place when their columns move
   * off enums and free text.
   */
  private async usageFor(kind: TaxonomyKind, ids: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(ids.map((id) => [id, 0]));
    if (kind !== TaxonomyKind.EVENT_KIND || ids.length === 0) return counts;

    const grouped = await this.prisma.event.groupBy({
      by: ['kindId'],
      where: { kindId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    });
    for (const row of grouped) counts.set(row.kindId, row._count._all);
    return counts;
  }

  async list(query: ListTaxonomyQuery): Promise<TaxonomyDto[]> {
    const rows = await this.prisma.taxonomy.findMany({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    });

    // Usage is counted per namespace so the group-by stays on one indexed
    // column instead of degenerating into a query per term.
    const byKind = new Map<TaxonomyKind, string[]>();
    for (const row of rows) {
      const kind = row.kind as TaxonomyKind;
      byKind.set(kind, [...(byKind.get(kind) ?? []), row.id]);
    }
    const usage = new Map<string, number>();
    await Promise.all(
      [...byKind.entries()].map(async ([kind, ids]) => {
        for (const [id, count] of await this.usageFor(kind, ids)) usage.set(id, count);
      }),
    );

    return rows.map((row) => this.toDto(row, usage.get(row.id) ?? 0));
  }

  async create(input: CreateTaxonomyInput, actor: AuthenticatedUser): Promise<TaxonomyDto> {
    const clash = await this.prisma.taxonomy.findUnique({
      where: { kind_key: { kind: input.kind, key: input.key } },
    });
    if (clash) {
      throw new ConflictException(
        `${input.key} already exists in this list${clash.archivedAt ? ', archived. Restore it instead of creating a duplicate.' : '.'}`,
      );
    }

    const row = await this.prisma.taxonomy.create({
      data: {
        kind: input.kind,
        key: input.key,
        label: input.label,
        description: input.description ?? null,
        colour: input.colour,
        sortOrder: input.sortOrder,
        isSystem: false,
      },
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Taxonomy',
      entityId: row.id,
      summary: `Added "${row.label}" to ${row.kind}`,
      actorId: actor.id,
    });
    return this.toDto(row, 0);
  }

  async update(
    id: string,
    input: UpdateTaxonomyInput,
    actor: AuthenticatedUser,
  ): Promise<TaxonomyDto> {
    const existing = await this.prisma.taxonomy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('That term does not exist');

    // Archiving the last usable term in a namespace would leave the create form
    // with an empty required select and no way to recover from the UI.
    if (input.archived === true && existing.archivedAt === null) {
      const remaining = await this.prisma.taxonomy.count({
        where: { kind: existing.kind, archivedAt: null, id: { not: id } },
      });
      if (remaining === 0) {
        throw new BadRequestException(
          'This is the last active term in the list. Add another one before archiving this.',
        );
      }
    }

    const row = await this.prisma.taxonomy.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.colour !== undefined ? { colour: input.colour } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.archived !== undefined
          ? { archivedAt: input.archived ? (existing.archivedAt ?? new Date()) : null }
          : {}),
      },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Taxonomy',
      entityId: id,
      summary:
        input.archived === true
          ? `Archived "${row.label}"`
          : input.archived === false
            ? `Restored "${row.label}"`
            : `Updated "${row.label}"`,
      actorId: actor.id,
      changes: AuditService.diff(
        { label: existing.label, colour: existing.colour, archivedAt: existing.archivedAt },
        { label: row.label, colour: row.colour, archivedAt: row.archivedAt },
      ),
    });

    const usage = await this.usageFor(row.kind as TaxonomyKind, [row.id]);
    return this.toDto(row, usage.get(row.id) ?? 0);
  }

  /**
   * Hard delete, permitted only when nothing references the term and it was not
   * installed by the seed. Everything else archives. The database enforces the
   * first rule too (`onDelete: Restrict`), so a race between the count and the
   * delete fails safely rather than orphaning rows.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.taxonomy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('That term does not exist');
    if (existing.isSystem) {
      throw new BadRequestException(
        `"${existing.label}" is a built-in term. Rename or archive it instead of deleting it.`,
      );
    }

    const usage = await this.usageFor(existing.kind as TaxonomyKind, [id]);
    const count = usage.get(id) ?? 0;
    if (count > 0) {
      throw new BadRequestException(
        `"${existing.label}" is used by ${count} item${count === 1 ? '' : 's'}. Archive it instead, or move those items first.`,
      );
    }

    await this.prisma.taxonomy.delete({ where: { id } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Taxonomy',
      entityId: id,
      summary: `Deleted "${existing.label}" from ${existing.kind}`,
      actorId: actor.id,
    });
  }

  /**
   * Resolves a term id for a write, rejecting ids that belong to another
   * namespace or to an archived term. Content services call this so a client
   * cannot file an event under a news category by passing its id.
   */
  async assertUsable(id: string, kind: TaxonomyKind): Promise<void> {
    const row = await this.prisma.taxonomy.findUnique({ where: { id } });
    if (!row || row.kind !== kind) {
      throw new BadRequestException('That is not a valid option for this field');
    }
    if (row.archivedAt) {
      throw new BadRequestException(
        `"${row.label}" has been archived and cannot be applied to new items.`,
      );
    }
  }

  private toDto(
    row: {
      id: string;
      kind: string;
      key: string;
      label: string;
      description: string | null;
      colour: string;
      sortOrder: number;
      isSystem: boolean;
      archivedAt: Date | null;
    },
    usageCount: number,
  ): TaxonomyDto {
    return {
      id: row.id,
      kind: row.kind as TaxonomyKind,
      key: row.key,
      label: row.label,
      description: row.description,
      colour: row.colour,
      sortOrder: row.sortOrder,
      isSystem: row.isSystem,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      usageCount,
    };
  }
}
