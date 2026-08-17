import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ALLOWED_UPLOAD_MIME,
  Permission,
  listMediaQuerySchema,
  updateMediaSchema,
  type ListMediaQuery,
  type MediaDto,
  type Page,
  type MediaLimitsDto,
  type UpdateMediaInput,
} from '@kode/contracts';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MediaService } from './media.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @RequirePermissions(Permission.MEDIA_UPLOAD)
  /*
   * The multer ceiling is a hard byte limit applied before the handler runs, so
   * it has to be at least as large as the configured limit or a legitimate
   * upload is truncated with an unhelpful error. It is derived from the same
   * env var the service checks against, plus a small margin for the multipart
   * envelope, rather than being a third independent number.
   */
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: uploadCeilingBytes(), files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload a file to the media library' })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MediaDto> {
    return this.media.upload(file, actor);
  }

  /**
   * The authoritative upload limit. The admin UI used a hardcoded constant from
   * the contracts package that had drifted from the server's, so a file the
   * server would have accepted was refused in the browser.
   */
  @Get('limits')
  @ApiOperation({ summary: 'Upload constraints, so the client does not guess' })
  limits(): MediaLimitsDto {
    return {
      maxUploadBytes: this.env.MAX_UPLOAD_BYTES,
      acceptedMimeTypes: ALLOWED_UPLOAD_MIME,
    };
  }

  @Get()
  @RequirePermissions(Permission.MEDIA_READ)
  @ApiOperation({ summary: 'Browse the media library' })
  list(
    @Query(ZodQuery(listMediaQuerySchema)) query: ListMediaQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<Page<MediaDto>> {
    return this.media.list(query, actor);
  }

  @Get('item/:id')
  @RequirePermissions(Permission.MEDIA_READ)
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<MediaDto> {
    return this.media.findOne(id, actor);
  }

  @Patch('item/:id')
  @RequirePermissions(Permission.MEDIA_UPLOAD)
  update(
    @Param('id') id: string,
    @Body(ZodBody(updateMediaSchema)) input: UpdateMediaInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MediaDto> {
    return this.media.update(id, input, actor);
  }

  @Delete('item/:id')
  @RequirePermissions(Permission.MEDIA_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.media.remove(id, actor);
  }

  /**
   * Serves the bytes.
   *
   * This route used to carry `@Public()`, on the reasoning that portal images
   * are embedded in pages that are themselves behind auth. That reasoning was
   * wrong: the page was protected, the file was not. Anyone holding a URL,
   * including someone with no account at all, could fetch any uploaded file,
   * and those URLs are handed out in every DTO carrying a `documentUrl`,
   * `coverUrl` or `avatarUrl`. A draft, department-scoped policy PDF was
   * readable by the open internet.
   *
   * Authentication is now the same session cookie as every other route. That
   * costs nothing in caching terms: cookies are sent with `<img>` and `<a>`
   * requests on the same site, and the response stays cacheable per user.
   *
   * `VERSION_NEUTRAL` is required, not cosmetic. The route is excluded from
   * the global `api` prefix, but the URI version segment is applied before that
   * exclusion is evaluated, so without this the route registers at
   * `/v1/media/:shard/:name` while `MediaUrlService` advertises
   * `/media/:shard/:name` and Caddy proxies `/media/*` verbatim. Every cover
   * image and policy document in production would 404.
   *
   * The response is forced to a download-safe disposition and a restrictive CSP
   * so an uploaded document can never execute in the API's origin.
   */
  @Get(':shard/:name')
  @Version(VERSION_NEUTRAL)
  async serve(
    @Param('shard') shard: string,
    @Param('name') name: string,
    @Res() response: Response,
  ): Promise<void> {
    const storageKey = `${shard}/${name}`;
    const record = await this.prisma.media.findFirst({
      where: { storageKey, deletedAt: null },
      select: { mimeType: true, filename: true, size: true },
    });
    if (!record) {
      response.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'File not found' });
      return;
    }

    const path = this.media.resolveStoragePath(storageKey);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      response.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'File not found' });
      return;
    }

    const isImage = record.mimeType.startsWith('image/');
    response.setHeader('Content-Type', record.mimeType);
    response.setHeader('Content-Length', info.size);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader(
      'Content-Disposition',
      `${isImage ? 'inline' : 'attachment'}; filename="${encodeURIComponent(record.filename)}"`,
    );
    // `private`, not `public`. The response is now authenticated, so a shared
    // cache must never hand one user's file to another. Storage keys are
    // server-generated UUIDs and never rewritten, so `immutable` still holds.
    response.setHeader(
      'Cache-Control',
      this.env.isProduction ? 'private, max-age=31536000, immutable' : 'no-store',
    );

    createReadStream(path).pipe(response);
  }
}

/**
 * Read once at module load, because Nest evaluates interceptor options when the
 * decorator is applied rather than per request. `MAX_UPLOAD_MB` is validated on
 * boot; this falls back to the schema default if the module is loaded before
 * config in a test.
 */
function uploadCeilingBytes(): number {
  const configured = Number(process.env.MAX_UPLOAD_MB);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : 15;
  return Math.round(megabytes * 1024 * 1024 * 1.05);
}
