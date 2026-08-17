import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/**
 * Turns a storage key into a public URL. Isolated in its own tiny module so
 * moving from local disk to S3 or a CDN later is a one-file change and does not
 * ripple through every service that serialises a DTO.
 */
@Injectable()
export class MediaUrlService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  toUrl(storageKey: string | null | undefined): string | null {
    if (!storageKey) return null;
    return `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/media/${storageKey}`;
  }
}
