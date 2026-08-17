import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ContentStatus,
  type CreateQuickLinkInput,
  type QuickLinkDto,
  type UpdateQuickLinkInput,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/** Small enough not to need pagination or department scoping. */
@Injectable()
export class QuickLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listPublic(): Promise<QuickLinkDto[]> {
    const rows = await this.prisma.quickLink.findMany({
      where: { status: ContentStatus.PUBLISHED, deletedAt: null },
      orderBy: [{ position: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toDto);
  }

  async list(): Promise<QuickLinkDto[]> {
    const rows = await this.prisma.quickLink.findMany({
      where: { deletedAt: null },
      orderBy: [{ position: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(input: CreateQuickLinkInput, actor: AuthenticatedUser): Promise<QuickLinkDto> {
    assertSafeUrl(input.url);
    const row = await this.prisma.quickLink.create({
      data: { ...input, description: input.description ?? null },
    });
    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'QuickLink',
      entityId: row.id,
      summary: `Added useful link "${row.title}"`,
      actorId: actor.id,
    });
    return toDto(row);
  }

  async update(
    id: string,
    input: UpdateQuickLinkInput,
    actor: AuthenticatedUser,
  ): Promise<QuickLinkDto> {
    if (input.url) assertSafeUrl(input.url);
    const existing = await this.prisma.quickLink.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Link not found');

    const row = await this.prisma.quickLink.update({
      where: { id },
      data: {
        ...input,
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      },
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'QuickLink',
      entityId: id,
      summary: `Updated useful link "${row.title}"`,
      actorId: actor.id,
      changes: AuditService.diff({ ...existing }, { ...row }),
    });
    return toDto(row);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.quickLink.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Link not found');
    await this.prisma.quickLink.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'QuickLink',
      entityId: id,
      summary: `Removed useful link "${existing.title}"`,
      actorId: actor.id,
    });
  }
}

function toDto(row: {
  id: string;
  title: string;
  url: string;
  description: string | null;
  icon: string;
  position: number;
  status: string;
}): QuickLinkDto {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description,
    icon: row.icon,
    position: row.position,
    status: row.status as ContentStatus,
  };
}

/**
 * Links are rendered as anchors in the portal, so only http(s) is acceptable.
 * `javascript:` and `data:` URLs would otherwise be a stored-XSS vector for
 * anyone with link:manage.
 */
function assertSafeUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // A rejected URL scheme is a validation failure, not a missing record.
    // Returning 404 made the CMS render "not found" for a link the user was
    // looking straight at.
    throw new BadRequestException('Only http and https links are allowed');
  }
}
