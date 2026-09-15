import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

// TaxonomyModule: ticket categories moved onto the taxonomy table, so
// SupportService resolves and validates a category id through TaxonomyService
// rather than switching on an enum.
@Module({
  imports: [AuditModule, OutboxModule, TaxonomyModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
