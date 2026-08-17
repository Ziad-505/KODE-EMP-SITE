import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type CmsDashboardDto } from '@kode/contracts';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { DashboardService } from './dashboard.service';

@ApiTags('cms: dashboard')
@Controller('cms/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions(Permission.CMS_ACCESS)
  @ApiOperation({ summary: 'Counts, attention list and recent activity, scoped to the actor' })
  get(@CurrentUser() actor: AuthenticatedUser): Promise<CmsDashboardDto> {
    return this.dashboard.build(actor);
  }
}
