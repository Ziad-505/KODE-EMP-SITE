import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, type AuditEntryDto, type ListAuditQuery, type Page } from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextStore } from '../common/request-context';

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  summary: string;
  actorId: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
}

/**
 * Append-only activity trail.
 *
 * There is deliberately no update or delete method here, and the migration
 * revokes UPDATE and DELETE on the table from the application database role.
 * An audit log an application can rewrite is not an audit log.
 *
 * Writes never throw into the caller: losing a business operation because the
 * log write failed would be a worse outcome than a gap in the log, which is
 * itself logged loudly.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const context = RequestContextStore.get();
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          summary: input.summary.slice(0, 500),
          actorId: input.actorId ?? context?.userId ?? null,
          changes: (input.changes ?? undefined) as never,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
          requestId: context?.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry (${input.action} ${input.entityType})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Diff two records, keeping only fields that actually changed. */
  static diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    ignore: readonly string[] = ['updatedAt', 'createdAt'],
  ): Record<string, { from: unknown; to: unknown }> | null {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (ignore.includes(key)) continue;
      const from = normalise(before[key]);
      const to = normalise(after[key]);
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    return Object.keys(changes).length ? changes : null;
  }

  async list(query: ListAuditQuery): Promise<Page<AuditEntryDto>> {
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action as AuditAction,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        actor: row.actor
          ? {
              id: row.actor.id,
              displayName: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
              email: row.actor.email,
            }
          : null,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        changes: (row.changes as AuditEntryDto['changes']) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async recentActivity(limit = 8) {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { notIn: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action as string,
      summary: row.summary,
      actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}
