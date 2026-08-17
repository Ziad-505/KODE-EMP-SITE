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
  adminListQuerySchema,
  changeStatusSchema,
  createAlbumSchema,
  createArticleSchema,
  createEventSchema,
  createFaqSchema,
  createPolicySchema,
  createQuickLinkSchema,
  listEventsQuerySchema,
  updateAlbumSchema,
  updateArticleSchema,
  updateEventSchema,
  updateFaqSchema,
  updatePolicySchema,
  updateQuickLinkSchema,
  type AdminListQuery,
  type AlbumDto,
  type ArticleDto,
  type ChangeStatusInput,
  type CreateAlbumInput,
  type CreateArticleInput,
  type CreateEventInput,
  type CreateFaqInput,
  type CreatePolicyInput,
  type CreateQuickLinkInput,
  type EventDto,
  type FaqDto,
  type ListEventsQuery,
  type Page,
  type PolicyDto,
  type QuickLinkDto,
  type UpdateAlbumInput,
  type UpdateArticleInput,
  type UpdateEventInput,
  type UpdateFaqInput,
  type UpdatePolicyInput,
  type UpdateQuickLinkInput,
} from '@kode/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ArticlesService } from './articles.service';
import { EventsService } from './events.service';
import { PoliciesService } from './policies.service';
import { FaqsService } from './faqs.service';
import { GalleryService } from './gallery.service';
import { QuickLinksService } from './quick-links.service';

@ApiTags('cms: news')
@Controller('cms/news')
export class CmsArticlesController {
  constructor(private readonly service: ArticlesService) {}

  @Get()
  @RequirePermissions(Permission.NEWS_READ, Permission.CMS_ACCESS)
  @ApiOperation({ summary: 'List news stories visible to the actor' })
  list(
    @Query(ZodQuery(adminListQuerySchema)) query: AdminListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<ArticleDto>> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.NEWS_READ, Permission.CMS_ACCESS)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<ArticleDto> {
    return this.service.findOne(id, actor);
  }

  @Post()
  @RequirePermissions(Permission.NEWS_CREATE)
  create(
    @Body(ZodBody(createArticleSchema)) input: CreateArticleInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ArticleDto> {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.NEWS_UPDATE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateArticleSchema)) input: UpdateArticleInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ArticleDto> {
    return this.service.update(id, input, actor);
  }

  @Post(':id/status')
  @RequirePermissions(Permission.NEWS_UPDATE)
  @ApiOperation({ summary: 'Move a story through the publication workflow' })
  changeStatus(
    @Param('id') id: string,
    @Body(ZodBody(changeStatusSchema)) input: ChangeStatusInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ArticleDto> {
    return this.service.changeStatus(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.NEWS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, actor);
  }
}

@ApiTags('cms: events')
@Controller('cms/events')
export class CmsEventsController {
  constructor(private readonly service: EventsService) {}

  @Get()
  @RequirePermissions(Permission.EVENT_READ, Permission.CMS_ACCESS)
  list(
    @Query(ZodQuery(listEventsQuerySchema)) query: ListEventsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<EventDto>> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.EVENT_READ, Permission.CMS_ACCESS)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<EventDto> {
    return this.service.findOne(id, actor);
  }

  @Post()
  @RequirePermissions(Permission.EVENT_CREATE)
  create(
    @Body(ZodBody(createEventSchema)) input: CreateEventInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EventDto> {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.EVENT_UPDATE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateEventSchema)) input: UpdateEventInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EventDto> {
    return this.service.update(id, input, actor);
  }

  @Post(':id/status')
  @RequirePermissions(Permission.EVENT_UPDATE)
  changeStatus(
    @Param('id') id: string,
    @Body(ZodBody(changeStatusSchema)) input: ChangeStatusInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EventDto> {
    return this.service.changeStatus(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.EVENT_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, actor);
  }
}

@ApiTags('cms: policies')
@Controller('cms/policies')
export class CmsPoliciesController {
  constructor(private readonly service: PoliciesService) {}

  @Get()
  @RequirePermissions(Permission.POLICY_READ, Permission.CMS_ACCESS)
  list(
    @Query(ZodQuery(adminListQuerySchema)) query: AdminListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<PolicyDto>> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.POLICY_READ, Permission.CMS_ACCESS)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<PolicyDto> {
    return this.service.findOne(id, actor);
  }

  @Post()
  @RequirePermissions(Permission.POLICY_CREATE)
  create(
    @Body(ZodBody(createPolicySchema)) input: CreatePolicyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PolicyDto> {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.POLICY_UPDATE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updatePolicySchema)) input: UpdatePolicyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PolicyDto> {
    return this.service.update(id, input, actor);
  }

  @Post(':id/status')
  @RequirePermissions(Permission.POLICY_UPDATE)
  changeStatus(
    @Param('id') id: string,
    @Body(ZodBody(changeStatusSchema)) input: ChangeStatusInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PolicyDto> {
    return this.service.changeStatus(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.POLICY_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, actor);
  }
}

@ApiTags('cms: faqs')
@Controller('cms/faqs')
export class CmsFaqsController {
  constructor(private readonly service: FaqsService) {}

  @Get()
  @RequirePermissions(Permission.FAQ_READ, Permission.CMS_ACCESS)
  list(
    @Query(ZodQuery(adminListQuerySchema)) query: AdminListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<FaqDto>> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.FAQ_READ, Permission.CMS_ACCESS)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<FaqDto> {
    return this.service.findOne(id, actor);
  }

  @Post()
  @RequirePermissions(Permission.FAQ_CREATE)
  create(
    @Body(ZodBody(createFaqSchema)) input: CreateFaqInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FaqDto> {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.FAQ_UPDATE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateFaqSchema)) input: UpdateFaqInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FaqDto> {
    return this.service.update(id, input, actor);
  }

  @Post(':id/status')
  @RequirePermissions(Permission.FAQ_UPDATE)
  changeStatus(
    @Param('id') id: string,
    @Body(ZodBody(changeStatusSchema)) input: ChangeStatusInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<FaqDto> {
    return this.service.changeStatus(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.FAQ_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, actor);
  }
}

@ApiTags('cms: gallery')
@Controller('cms/gallery')
export class CmsGalleryController {
  constructor(private readonly service: GalleryService) {}

  @Get()
  @RequirePermissions(Permission.GALLERY_READ, Permission.CMS_ACCESS)
  list(
    @Query(ZodQuery(adminListQuerySchema)) query: AdminListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<AlbumDto>> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.GALLERY_READ, Permission.CMS_ACCESS)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<AlbumDto> {
    return this.service.findOne(id, actor);
  }

  @Post()
  @RequirePermissions(Permission.GALLERY_CREATE)
  create(
    @Body(ZodBody(createAlbumSchema)) input: CreateAlbumInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AlbumDto> {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.GALLERY_UPDATE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateAlbumSchema)) input: UpdateAlbumInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AlbumDto> {
    return this.service.update(id, input, actor);
  }

  @Post(':id/status')
  @RequirePermissions(Permission.GALLERY_UPDATE)
  changeStatus(
    @Param('id') id: string,
    @Body(ZodBody(changeStatusSchema)) input: ChangeStatusInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AlbumDto> {
    return this.service.changeStatus(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.GALLERY_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, actor);
  }
}

@ApiTags('cms: links')
@Controller('cms/links')
export class CmsQuickLinksController {
  constructor(private readonly service: QuickLinksService) {}

  @Get()
  @RequirePermissions(Permission.LINK_READ, Permission.CMS_ACCESS)
  list(): Promise<QuickLinkDto[]> {
    return this.service.list();
  }

  @Post()
  @RequirePermissions(Permission.LINK_MANAGE)
  create(
    @Body(ZodBody(createQuickLinkSchema)) input: CreateQuickLinkInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<QuickLinkDto> {
    return this.service.create(input, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.LINK_MANAGE)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateQuickLinkSchema)) input: UpdateQuickLinkInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<QuickLinkDto> {
    return this.service.update(id, input, actor);
  }

  @Delete(':id')
  @RequirePermissions(Permission.LINK_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, actor);
  }
}
