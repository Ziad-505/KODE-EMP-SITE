import { z } from 'zod';
import { AuditAction } from './enums';
import { paginationQuerySchema, cuidSchema } from './common';

export const listAuditQuerySchema = paginationQuerySchema.extend({
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.string().trim().max(60).optional(),
  actorId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export interface AuditEntryDto {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: { id: string; displayName: string; email: string } | null;
  ipAddress: string | null;
  userAgent: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}
