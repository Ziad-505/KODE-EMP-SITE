import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  listAuditQuerySchema,
  type AuditEntryDto,
  type ListAuditQuery,
  type Page,
} from '@kode/contracts';
import { ZodQuery } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/auth.decorators';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
@RequirePermissions(Permission.AUDIT_READ)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Search the activity trail (Super Admin only)' })
  list(@Query(ZodQuery(listAuditQuerySchema)) query: ListAuditQuery): Promise<Page<AuditEntryDto>> {
    return this.audit.list(query);
  }
}
