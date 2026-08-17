import { Module } from '@nestjs/common';
import { MediaUrlService } from './media-url.service';

@Module({ providers: [MediaUrlService], exports: [MediaUrlService] })
export class MediaUrlModule {}
