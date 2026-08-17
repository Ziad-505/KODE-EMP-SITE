import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export const OutboxTopic = {
  TICKET_CREATED: 'ticket.created',
  TICKET_UPDATED: 'ticket.updated',
} as const;
export type OutboxTopic = (typeof OutboxTopic)[keyof typeof OutboxTopic];

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  ticketId?: string;
}

const MAX_ATTEMPTS = 6;

/** The subset of a claimed row the drain loop needs. */
interface OutboxRow {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * Transactional outbox.
 *
 * A support ticket and its notification are written in the same database
 * transaction, so the system can never be in a state where the ticket exists
 * but the email was lost, or the email went out for a ticket that rolled back.
 * A background worker drains the table with exponential backoff.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Call inside an existing transaction. */
  enqueue(tx: Prisma.TransactionClient, topic: OutboxTopic, payload: EmailPayload) {
    return tx.outboxMessage.create({
      data: { topic, payload: payload as unknown as Prisma.InputJsonValue },
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      /*
       * Claimed with `FOR UPDATE SKIP LOCKED` rather than selected and hoped
       * for. The `draining` flag above is per-process, so with more than one
       * API replica both ticks selected the same rows, IT received two
       * identical emails and Odoo opened two tickets for one request.
       *
       * The claim moves `nextAttemptAt` forward by the lease window inside the
       * same statement, so a replica that dies mid-send releases the row after
       * the lease rather than holding it forever.
       */
      const due = await this.prisma.$transaction(
        async (tx) =>
          tx.$queryRaw<OutboxRow[]>`
          UPDATE "outbox_messages" SET "nextAttemptAt" = NOW() + INTERVAL '2 minutes'
          WHERE "id" IN (
            SELECT "id" FROM "outbox_messages"
            WHERE "processedAt" IS NULL
              AND "attempts" < ${MAX_ATTEMPTS}
              AND "nextAttemptAt" <= NOW()
            ORDER BY "createdAt" ASC
            LIMIT 20
            FOR UPDATE SKIP LOCKED
          )
          RETURNING "id", "payload", "attempts"
        `,
      );

      for (const message of due) {
        const payload = message.payload as unknown as EmailPayload;
        try {
          await this.mail.send({
            to: payload.to,
            subject: payload.subject,
            text: payload.text,
            ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
          });
          await this.prisma.outboxMessage.update({
            where: { id: message.id },
            data: { processedAt: new Date(), lastError: null },
          });
          if (payload.ticketId) {
            await this.prisma.supportTicket
              .update({ where: { id: payload.ticketId }, data: { notifiedAt: new Date() } })
              .catch(() => undefined);
          }
        } catch (error) {
          const attempts = message.attempts + 1;
          // 1m, 2m, 4m, 8m, 16m, 32m
          const backoffMs = Math.min(2 ** attempts, 64) * 30_000;
          await this.prisma.outboxMessage.update({
            where: { id: message.id },
            data: {
              attempts,
              lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
              nextAttemptAt: new Date(Date.now() + backoffMs),
            },
          });
          this.logger.warn(
            `Outbox delivery failed (attempt ${attempts}/${MAX_ATTEMPTS}) for ${message.id}`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async deadLetterCount(): Promise<number> {
    return this.prisma.outboxMessage.count({
      where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } },
    });
  }
}
