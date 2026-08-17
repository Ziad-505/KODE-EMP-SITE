import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, type HealthIndicatorResult } from '@nestjs/terminus';
import { Public } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Liveness: is the process up. Used by the container healthcheck. */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /** Readiness: can it actually serve traffic. Used by the load balancer. */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe, including database connectivity' })
  ready() {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return { database: { status: 'up' } };
        } catch (error) {
          return {
            database: {
              status: 'down',
              message: error instanceof Error ? error.message : 'unreachable',
            },
          };
        }
      },
      /*
       * Reported, never fatal. This used to return `down` when a single message
       * had exhausted its delivery attempts, so one ticket email to a
       * temporarily unroutable inbox would dead-letter at 02:00 and the load
       * balancer would pull every replica out of rotation permanently. A
       * notification that cannot be delivered is an operational problem; it is
       * not a reason to take the portal offline. The count is still surfaced so
       * monitoring can alert on it.
       */
      async (): Promise<HealthIndicatorResult> => {
        const stuck = await this.outbox.deadLetterCount();
        return { outbox: { status: 'up', deadLettered: stuck } };
      },
    ]);
  }
}
