import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  createTaxonomySchema,
  listTaxonomyQuerySchema,
  updateTaxonomySchema,
  type CreateTaxonomyInput,
  type ListTaxonomyQuery,
  type TaxonomyDto,
  type UpdateTaxonomyInput,
} from '@kode/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { TaxonomyService } from './taxonomy.service';

@ApiTags('taxonomy')
@Controller('taxonomy')
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  /**
   * Readable by anyone signed in. The portal needs event kind labels to render
   * a calendar and the CMS needs them to populate a select; neither is
   * privileged information, and gating reads behind `settings:manage` would
   * mean an Employee could not see the name of the category they are looking at.
   *
   * Writes below require `settings:manage`, which only a Super Admin holds.
   */
  @Get()
  @ApiOperation({ summary: 'List admin-managed terms, optionally filtered by namespace' })
  list(@Query(ZodQuery(listTaxonomyQuerySchema)) query: ListTaxonomyQuery): Promise<TaxonomyDto[]> {
    return this.taxonomy.list(query);
  }

  @Post()
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Add a term, taking effect immediately with no deploy' })
  create(
    @Body(ZodBody(createTaxonomySchema)) input: CreateTaxonomyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TaxonomyDto> {
    return this.taxonomy.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Rename, recolour, reorder, archive or restore a term' })
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateTaxonomySchema)) input: UpdateTaxonomyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TaxonomyDto> {
    return this.taxonomy.update(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused, non-system term. Used terms archive instead.' })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.taxonomy.remove(id, actor);
  }
}
