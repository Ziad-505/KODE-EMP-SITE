import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  ALLOWED_IMAGE_MIME,
  ALLOWED_UPLOAD_MIME,
  AuditAction,
  Permission,
  type ListMediaQuery,
  type MediaDto,
  type Page,
  type UpdateMediaInput,
} from '@kode/contracts';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ContentPolicy } from '../content/content.policy';
import { MediaUrlService } from './media-url.service';
import { detectFileType, readImageDimensions, signatureMatchesDeclared } from './file-signature';

const IMAGE_MIME = new Set<string>(ALLOWED_IMAGE_MIME);
const ALLOWED_MIME = new Set<string>(ALLOWED_UPLOAD_MIME);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: MediaUrlService,
    private readonly policy: ContentPolicy,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get root(): string {
    return resolve(this.env.UPLOAD_DIR);
  }

  async upload(file: Express.Multer.File, actor: AuthenticatedUser): Promise<MediaDto> {
    if (!file?.buffer?.length) throw new BadRequestException('No file received');
    if (file.size > this.env.MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`Files must be ${this.env.MAX_UPLOAD_MB} MB or smaller`);
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(`${file.mimetype} files are not accepted`);
    }

    // Never trust the declared type: verify the actual leading bytes.
    const detected = detectFileType(file.buffer);
    if (!signatureMatchesDeclared(detected, file.mimetype)) {
      throw new BadRequestException(
        'The file contents do not match its type. Re-export the file and try again.',
      );
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    // Content-addressed de-duplication: the same asset uploaded twice is stored
    // once, which keeps the media library honest and the disk small.
    const existing = await this.prisma.media.findFirst({
      where: { checksum, deletedAt: null },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (existing) return this.toDto(existing);

    // The storage key is generated server-side. The original filename is kept as
    // metadata only and never touches the filesystem, so `../` in a filename is
    // structurally impossible rather than merely sanitised.
    const extension = EXTENSION_BY_MIME[file.mimetype] ?? '.bin';
    const shard = checksum.slice(0, 2);
    const storageKey = `${shard}/${randomUUID()}${extension}`;
    const absolutePath = join(this.root, storageKey);

    if (!absolutePath.startsWith(this.root + sep)) {
      throw new BadRequestException('Invalid storage path');
    }

    await mkdir(join(this.root, shard), { recursive: true });
    await writeFile(absolutePath, file.buffer, { mode: 0o640 });

    const dimensions = IMAGE_MIME.has(file.mimetype)
      ? readImageDimensions(file.buffer, file.mimetype)
      : null;

    const created = await this.prisma.media.create({
      data: {
        filename: safeDisplayName(file.originalname),
        storageKey,
        mimeType: file.mimetype,
        size: file.size,
        checksum,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        uploadedById: actor.id,
        // Stamped from the uploader so the file inherits their scope. A
        // club-wide uploader (no department) produces club-wide media, which is
        // the same convention every content model uses.
        departmentId: actor.departmentId,
      },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    });

    await this.audit.record({
      action: AuditAction.UPLOAD,
      entityType: 'Media',
      entityId: created.id,
      summary: `Uploaded ${created.filename} (${formatBytes(created.size)})`,
      actorId: actor.id,
    });

    return this.toDto(created);
  }

  async list(query: ListMediaQuery, actor: AuthenticatedUser): Promise<Page<MediaDto>> {
    const where = {
      deletedAt: null,
      // Same visibility rule as every content list: your own department plus
      // club-wide. This clause did not exist, so the library was the one place
      // a Department Editor could see the whole club's files.
      AND: this.policy.cmsVisibility(actor),
      ...(query.q
        ? {
            OR: [
              { filename: { contains: query.q, mode: 'insensitive' as const } },
              { title: { contains: query.q, mode: 'insensitive' as const } },
              { alt: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.kind === 'image' ? { mimeType: { startsWith: 'image/' } } : {}),
      ...(query.kind === 'document' ? { NOT: { mimeType: { startsWith: 'image/' } } } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<MediaDto> {
    const media = await this.prisma.media.findFirst({
      // Scoped for the same reason `list` is. A 404 rather than a 403 is
      // deliberate: an out-of-scope id should not be confirmable.
      where: { id, deletedAt: null, AND: this.policy.cmsVisibility(actor) },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!media) throw new NotFoundException('Media item not found');
    return this.toDto(media);
  }

  async update(id: string, input: UpdateMediaInput, actor: AuthenticatedUser): Promise<MediaDto> {
    const existing = await this.prisma.media.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Media item not found');

    const updated = await this.prisma.media.update({
      where: { id },
      // `?? null` made this a PUT wearing a PATCH's name: sending only `alt`
      // wiped `title`, because an absent key and an explicitly-null key were
      // treated identically. Every other update method in the codebase uses the
      // `!== undefined` guard; this one did not.
      data: {
        ...(input.alt !== undefined ? { alt: input.alt ?? null } : {}),
        ...(input.title !== undefined ? { title: input.title ?? null } : {}),
      },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Media',
      entityId: id,
      summary: `Updated metadata for ${updated.filename}`,
      actorId: actor.id,
      changes: AuditService.diff(
        { alt: existing.alt, title: existing.title },
        { alt: updated.alt, title: updated.title },
      ),
    });

    return this.toDto(updated);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    if (!actor.can(Permission.MEDIA_DELETE)) {
      throw new ForbiddenException('You cannot delete media');
    }

    const media = await this.prisma.media.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            articleCovers: true,
            eventCovers: true,
            policyDocs: true,
            albumCovers: true,
            galleryItems: true,
          },
        },
      },
    });
    if (!media) throw new NotFoundException('Media item not found');

    const references = Object.values(media._count).reduce((sum, count) => sum + count, 0);
    if (references > 0) {
      throw new BadRequestException(
        `This file is used by ${references} item${references === 1 ? '' : 's'}. Remove those references first.`,
      );
    }

    // Soft delete first so the audit row always has something to point at; the
    // bytes go afterwards and a failure there is not fatal.
    await this.prisma.media.update({ where: { id }, data: { deletedAt: new Date() } });
    await unlink(join(this.root, media.storageKey)).catch(() => undefined);

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Media',
      entityId: id,
      summary: `Deleted ${media.filename}`,
      actorId: actor.id,
    });
  }

  /** Resolves a storage key to an absolute path, refusing traversal attempts. */
  resolveStoragePath(storageKey: string): string {
    const absolute = resolve(this.root, storageKey);
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) {
      throw new NotFoundException('File not found');
    }
    return absolute;
  }

  toDto(media: {
    id: string;
    storageKey: string;
    filename: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    alt: string | null;
    title: string | null;
    createdAt: Date;
    uploadedBy?: { id: string; firstName: string; lastName: string } | null;
  }): MediaDto {
    return {
      id: media.id,
      url: this.urls.toUrl(media.storageKey)!,
      filename: media.filename,
      mimeType: media.mimeType,
      size: media.size,
      width: media.width,
      height: media.height,
      alt: media.alt,
      title: media.title,
      kind: media.mimeType.startsWith('image/') ? 'image' : 'document',
      uploadedBy: media.uploadedBy
        ? {
            id: media.uploadedBy.id,
            displayName: `${media.uploadedBy.firstName} ${media.uploadedBy.lastName}`.trim(),
          }
        : null,
      createdAt: media.createdAt.toISOString(),
    };
  }
}

/** Keeps a readable label without letting path characters through. */
function safeDisplayName(original: string): string {
  const base = original
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\- ]+/g, '')
    .trim();
  const name = base || 'upload';
  return name.length > 120 ? name.slice(-120) : name;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
