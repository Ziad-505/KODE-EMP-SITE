import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
// Provided directly rather than by importing ContentModule: ContentPolicy is a
// stateless policy object, and importing the module would create a cycle.
import { ContentPolicy } from '../content/content.policy';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaUrlModule } from './media-url.module';

@Module({
  imports: [AuditModule, MediaUrlModule],
  controllers: [MediaController],
  providers: [MediaService, ContentPolicy],
  exports: [MediaService, MediaUrlModule],
})
export class MediaModule {}
