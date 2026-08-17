import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { MediaUrlModule } from '../media/media-url.module';
import { ArticlesService } from './articles.service';
import { EventsService } from './events.service';
import { PoliciesService } from './policies.service';
import { FaqsService } from './faqs.service';
import { GalleryService } from './gallery.service';
import { QuickLinksService } from './quick-links.service';
import { SearchService } from './search.service';
import { DashboardService } from './dashboard.service';
import { ContentPolicy } from './content.policy';
import { PortalController } from './portal.controller';
import { DashboardController } from './dashboard.controller';
import {
  CmsArticlesController,
  CmsEventsController,
  CmsFaqsController,
  CmsGalleryController,
  CmsPoliciesController,
  CmsQuickLinksController,
} from './content.controller';

@Module({
  imports: [AuditModule, MediaUrlModule, TaxonomyModule],
  controllers: [
    PortalController,
    DashboardController,
    CmsArticlesController,
    CmsEventsController,
    CmsPoliciesController,
    CmsFaqsController,
    CmsGalleryController,
    CmsQuickLinksController,
  ],
  providers: [
    ContentPolicy,
    ArticlesService,
    EventsService,
    PoliciesService,
    FaqsService,
    GalleryService,
    QuickLinksService,
    SearchService,
    DashboardService,
  ],
  exports: [ArticlesService, EventsService, PoliciesService, FaqsService, GalleryService],
})
export class ContentModule {}
