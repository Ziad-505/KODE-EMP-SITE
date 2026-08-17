import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  Permission,
  createTicketSchema,
  listTicketsQuerySchema,
  updateTicketSchema,
  type CreateTicketInput,
  type ListTicketsQuery,
  type Page,
  type TicketDto,
  type UpdateTicketInput,
} from '@kode/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { SupportService } from './support.service';

@ApiTags('support')
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @RequirePermissions(Permission.TICKET_CREATE)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Raise an IT support request' })
  create(
    @Body(ZodBody(createTicketSchema)) input: CreateTicketInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TicketDto> {
    return this.support.create(input, actor);
  }

  @Get()
  @RequirePermissions(Permission.TICKET_READ_OWN)
  @ApiOperation({ summary: 'Your requests, or all of them with ticket:read:all' })
  list(
    @Query(ZodQuery(listTicketsQuerySchema)) query: ListTicketsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<TicketDto>> {
    return this.support.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.TICKET_READ_OWN)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<TicketDto> {
    return this.support.findOne(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TICKET_MANAGE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateTicketSchema)) input: UpdateTicketInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<TicketDto> {
    return this.support.update(id, input, actor);
  }
}
