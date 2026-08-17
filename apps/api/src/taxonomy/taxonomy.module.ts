import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';

/**
 * Exported so ContentModule can validate a term id on write without reaching
 * into another module's Prisma calls.
 */
@Module({
  imports: [AuditModule],
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
