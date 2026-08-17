import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokenService } from '../auth/token.service';
import { EntraService } from '../auth/entra.service';

/** Scheduled housekeeping. Small, boring and easy to reason about on purpose. */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly entra: EntraService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<void> {
    const [tokens, states] = await Promise.all([
      this.tokens.purgeExpired(),
      this.entra.purgeExpiredStates(),
    ]);
    if (tokens || states) {
      this.logger.log(
        `Housekeeping removed ${tokens} expired token(s) and ${states} stale sign-in state(s)`,
      );
    }
  }
}
