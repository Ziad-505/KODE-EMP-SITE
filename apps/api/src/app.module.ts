import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { ContentModule } from './content/content.module';
import { MediaModule } from './media/media.module';
import { SupportModule } from './support/support.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { OutboxModule } from './outbox/outbox.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CsrfGuard } from './auth/csrf.guard';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { MaintenanceService } from './common/maintenance.service';
import { loadEnv } from './config/env';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_MAX },
      { name: 'auth', ttl: 60_000, limit: env.AUTH_RATE_LIMIT_MAX },
    ]),
    MailModule,
    OutboxModule,
    AuditModule,
    AuthModule,
    UsersModule,
    MediaModule,
    TaxonomyModule,
    ContentModule,
    SupportModule,
    HealthModule,
  ],
  providers: [
    MaintenanceService,
    // Order matters: rate limit, then authenticate and authorize, then CSRF.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
