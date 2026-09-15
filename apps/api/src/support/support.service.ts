import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  TaxonomyKind,
  Permission,
  TicketPriority,
  TicketStatus,
  type CreateTicketInput,
  type ListTicketsQuery,
  type Page,
  type TicketDto,
  type UpdateTicketInput,
} from '@kode/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService, OutboxTopic } from '../outbox/outbox.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

const INCLUDE = {
  category: { select: { id: true, key: true, label: true, colour: true } },
  requester: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      department: { select: { name: true } },
    },
  },
  assignee: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SupportTicketInclude;

type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly taxonomy: TaxonomyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(input: CreateTicketInput, actor: AuthenticatedUser): Promise<TicketDto> {
    const requester = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        department: { select: { name: true } },
      },
    });

    /*
     * Resolved before the transaction opens, not inside it. `assertUsable` runs
     * its own query on `this.prisma` — a different connection from `tx` — so
     * calling it from inside an interactive transaction held one connection
     * while waiting for a second: with `DATABASE_POOL_SIZE=10` and ten
     * concurrent submissions, every connection was held by a transaction
     * waiting for an eleventh that would never come. The category is not part
     * of what this transaction has to make atomic.
     */
    await this.taxonomy.assertUsable(input.categoryId, TaxonomyKind.TICKET_CATEGORY);

    // Ticket row and outbound notification commit together, so a crash cannot
    // produce a ticket nobody was told about.
    const ticket = await this.prisma.$transaction(async (tx) => {
      /*
       * Attachments must be files this person actually uploaded. They were
       * attached with no existence or ownership check at all, so a ticket could
       * reference any media id in the club. Nothing readable leaked, because
       * attachments are never served back, but it wrote junk join rows against
       * files the requester had nothing to do with.
       */
      if (input.attachmentIds.length) {
        const owned = await tx.media.count({
          where: {
            id: { in: input.attachmentIds },
            deletedAt: null,
            uploadedById: actor.id,
          },
        });
        if (owned !== input.attachmentIds.length) {
          throw new BadRequestException('Attach only files you uploaded with this request.');
        }
      }

      const reference = await this.nextReference(tx);
      const created = await tx.supportTicket.create({
        data: {
          reference,
          subject: input.subject,
          body: input.body,
          categoryId: input.categoryId,
          priority: input.priority,
          location: input.location ?? null,
          requesterId: actor.id,
          ...(input.attachmentIds.length
            ? { attachments: { create: input.attachmentIds.map((mediaId) => ({ mediaId })) } }
            : {}),
        },
        include: INCLUDE,
      });

      await this.outbox.enqueue(tx, OutboxTopic.TICKET_CREATED, {
        to: this.env.IT_SUPPORT_INBOX,
        replyTo: requester.email,
        subject: `[${reference}] ${input.subject}`,
        text: buildTicketEmail(created, requester),
        ticketId: created.id,
      });

      return created;
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'SupportTicket',
      entityId: ticket.id,
      summary: `Raised IT request ${ticket.reference}: ${ticket.subject}`,
      actorId: actor.id,
    });

    return this.toDto(ticket);
  }

  async list(query: ListTicketsQuery, actor: AuthenticatedUser): Promise<Page<TicketDto>> {
    // Anyone can read their own tickets; reading everyone's needs a permission.
    const canSeeAll = actor.can(Permission.TICKET_READ_ALL);
    const mode = 'insensitive' as const;

    const where: Prisma.SupportTicketWhereInput = {
      ...(canSeeAll && !query.mine ? {} : { requesterId: actor.id }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.q
        ? {
            OR: [
              { subject: { contains: query.q, mode } },
              { body: { contains: query.q, mode } },
              { reference: { contains: query.q, mode } },
              // News and FAQ search both reach through the relation for the
              // label. Without the same clause here, searching "network" misses
              // every ticket whose only match is its category.
              { category: { label: { contains: query.q, mode } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<TicketDto> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, include: INCLUDE });
    if (!ticket) throw new NotFoundException('Request not found');
    if (ticket.requesterId !== actor.id && !actor.can(Permission.TICKET_READ_ALL)) {
      throw new ForbiddenException('That request belongs to someone else');
    }
    return this.toDto(ticket);
  }

  async update(id: string, input: UpdateTicketInput, actor: AuthenticatedUser): Promise<TicketDto> {
    if (!actor.can(Permission.TICKET_MANAGE)) {
      throw new ForbiddenException('You cannot manage support requests');
    }
    const existing = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!existing) throw new NotFoundException('Request not found');

    const ticket = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId ?? null } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution ?? null } : {}),
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'SupportTicket',
      entityId: id,
      summary: `Updated ${ticket.reference} (${existing.status} to ${ticket.status})`,
      actorId: actor.id,
      changes: AuditService.diff(
        { status: existing.status, priority: existing.priority, assigneeId: existing.assigneeId },
        { status: ticket.status, priority: ticket.priority, assigneeId: ticket.assigneeId },
      ),
    });

    return this.toDto(ticket);
  }

  /**
   * KODE-IT-000001 upward, from a Postgres sequence.
   *
   * This was `count() + 1`, which is neither collision-proof at READ COMMITTED
   * nor monotonic. `SupportTicket.requesterId` is `onDelete: Cascade`, so hard
   * deleting a departed employee who had three tickets dropped the count by
   * three and the next three submissions collided with references that already
   * existed. The employee then simply could not raise a ticket, and the error
   * they saw was "A record with these details already exists".
   *
   * A sequence never reuses a value, is transactional without being
   * transaction-scoped, and costs one round trip.
   */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('support_ticket_reference_seq') AS value
    `;
    const value = rows[0]?.value;
    if (value === undefined) {
      // Only reachable if the sequence is missing, which means the migration
      // did not run. Failing loudly beats silently minting a duplicate.
      throw new Error('support_ticket_reference_seq is missing; run the migrations');
    }
    return `KODE-IT-${String(value).padStart(6, '0')}`;
  }

  toDto(row: TicketRow): TicketDto {
    return {
      id: row.id,
      reference: row.reference,
      subject: row.subject,
      body: row.body,
      category: {
        id: row.category.id,
        key: row.category.key,
        label: row.category.label,
        colour: row.category.colour,
      },
      priority: row.priority as TicketPriority,
      status: row.status as TicketStatus,
      location: row.location,
      resolution: row.resolution,
      requester: {
        id: row.requester.id,
        displayName: `${row.requester.firstName} ${row.requester.lastName}`.trim(),
        email: row.requester.email,
        departmentName: row.requester.department?.name ?? null,
      },
      assignee: row.assignee
        ? {
            id: row.assignee.id,
            displayName: `${row.assignee.firstName} ${row.assignee.lastName}`.trim(),
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Plain text on purpose. The IT inbox feeds Odoo, which parses the body; a
 * predictable key/value block survives that better than styled HTML.
 */
function buildTicketEmail(
  ticket: {
    reference: string;
    subject: string;
    body: string;
    category: { key: string; label: string };
    priority: string;
    location: string | null;
  },
  requester: {
    firstName: string;
    lastName: string;
    email: string;
    department: { name: string } | null;
  },
): string {
  return [
    `Reference: ${ticket.reference}`,
    `Requester: ${requester.firstName} ${requester.lastName} <${requester.email}>`,
    `Department: ${requester.department?.name ?? 'Not set'}`,
    // The key, not the label. IT's Odoo rules parse this line, and an admin
    // renaming "Access" to "Access and logins" must not silently break routing.
    `Category: ${ticket.category.key} (${ticket.category.label})`,
    `Priority: ${ticket.priority}`,
    `Location: ${ticket.location ?? 'Not given'}`,
    '',
    `Subject: ${ticket.subject}`,
    '',
    ticket.body,
    '',
    '--',
    'Raised from the KODE Sports Club employee portal.',
  ].join('\n');
}
