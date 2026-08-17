import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  publicListQuerySchema,
  searchQuerySchema,
  type AlbumDto,
  type ArticleDto,
  type EventDto,
  type FaqDto,
  type Page,
  type PolicyDto,
  type PortalHomeDto,
  type PublicListQuery,
  type QuickLinkDto,
  type SearchQuery,
  type SearchResultDto,
} from '@kode/contracts';
import { ZodQuery } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ContentPolicy } from './content.policy';
import { ArticlesService } from './articles.service';
import { EventsService, startOfToday } from './events.service';
import { PoliciesService } from './policies.service';
import { FaqsService } from './faqs.service';
import { GalleryService } from './gallery.service';
import { QuickLinksService } from './quick-links.service';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Everything the employee portal reads. Authenticated but low-privilege: the
 * EMPLOYEE role holds every permission used here.
 */
@ApiTags('portal')
@Controller('portal')
export class PortalController {
  constructor(
    private readonly articles: ArticlesService,
    private readonly events: EventsService,
    private readonly policies: PoliciesService,
    private readonly faqs: FaqsService,
    private readonly gallery: GalleryService,
    private readonly links: QuickLinksService,
    private readonly search: SearchService,
    private readonly prisma: PrismaService,
    private readonly policy: ContentPolicy,
  ) {}

  @Get('home')
  @RequirePermissions(Permission.NEWS_READ)
  @ApiOperation({ summary: 'Everything the homepage needs, in one request' })
  async home(@CurrentUser() actor: AuthenticatedUser): Promise<PortalHomeDto> {
    /*
     * These three counts were the only content queries in the system issued
     * from a controller, and consequently the only ones that skipped
     * ContentPolicy. They counted every department's content regardless of who
     * was asking, so the homepage could say "24 published stories" above a list
     * drawn from the eight that reader could actually see.
     *
     * They now compose the same visibility fragments as every list. The event
     * count additionally uses the same day boundary as the list beside it: it
     * used `new Date()` while `listUpcomingPublic` uses local midnight, so at
     * 14:00 an event that started at 09:00 today appeared in the list and was
     * missing from the count.
     */
    const visible = this.policy.portalVisibility(actor);
    const [news, events, links, publishedArticles, upcomingEvents, activePolicies] =
      await Promise.all([
        this.articles.listPublic({ page: 1, pageSize: 3 }, actor),
        this.events.listUpcomingPublic(3, actor),
        this.links.listPublic(),
        this.prisma.article.count({ where: { AND: visible } }),
        this.prisma.event.count({
          where: { AND: [...visible, { startsAt: { gte: startOfToday() } }] },
        }),
        this.prisma.policy.count({ where: { AND: visible } }),
      ]);

    return {
      news: news.items,
      events,
      links,
      stats: { publishedArticles, upcomingEvents, activePolicies },
    };
  }

  @Get('search')
  @ApiOperation({ summary: 'Cross-content search for the command palette' })
  searchAll(
    @Query(ZodQuery(searchQuerySchema)) query: SearchQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SearchResultDto[]> {
    return this.search.search(query, actor);
  }

  @Get('news')
  @RequirePermissions(Permission.NEWS_READ)
  listNews(
    @Query(ZodQuery(publicListQuerySchema)) query: PublicListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<ArticleDto>> {
    return this.articles.listPublic(query, actor);
  }

  @Get('news/:slug')
  @RequirePermissions(Permission.NEWS_READ)
  getNews(
    @Param('slug') slug: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ArticleDto> {
    return this.articles.findPublicBySlug(slug, actor);
  }

  @Get('events')
  @RequirePermissions(Permission.EVENT_READ)
  listEvents(
    @Query(ZodQuery(publicListQuerySchema)) query: PublicListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<EventDto>> {
    return this.events.listPublic(query, actor);
  }

  @Get('events/:slug')
  @RequirePermissions(Permission.EVENT_READ)
  getEvent(
    @Param('slug') slug: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<EventDto> {
    return this.events.findPublicBySlug(slug, actor);
  }

  @Get('policies')
  @RequirePermissions(Permission.POLICY_READ)
  listPolicies(
    @Query(ZodQuery(publicListQuerySchema)) query: PublicListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<PolicyDto>> {
    return this.policies.listPublic(query, actor);
  }

  @Get('policies/:slug')
  @RequirePermissions(Permission.POLICY_READ)
  getPolicy(
    @Param('slug') slug: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PolicyDto> {
    return this.policies.findPublicBySlug(slug, actor);
  }

  @Get('faqs')
  @RequirePermissions(Permission.FAQ_READ)
  listFaqs(
    @Query(ZodQuery(publicListQuerySchema)) query: PublicListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<FaqDto>> {
    return this.faqs.listPublic(query, actor);
  }

  @Get('gallery')
  @RequirePermissions(Permission.GALLERY_READ)
  listAlbums(
    @Query(ZodQuery(publicListQuerySchema)) query: PublicListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<AlbumDto>> {
    return this.gallery.listPublic(query, actor);
  }

  @Get('gallery/:slug')
  @RequirePermissions(Permission.GALLERY_READ)
  getAlbum(
    @Param('slug') slug: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AlbumDto> {
    return this.gallery.findPublicBySlug(slug, actor);
  }

  @Get('links')
  @RequirePermissions(Permission.LINK_READ)
  listLinks(): Promise<QuickLinkDto[]> {
    return this.links.listPublic();
  }
}
