import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { OutboxModule } from '../outbox/outbox.module';
import { HealthController } from './health.controller';

@Module({ imports: [TerminusModule, OutboxModule], controllers: [HealthController] })
export class HealthModule {}
