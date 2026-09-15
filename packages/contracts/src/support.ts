import type { TaxonomyRefDto } from './taxonomy';
import { z } from 'zod';
import { TicketPriority, TicketStatus } from './enums';
import { paginationQuerySchema, cuidSchema } from './common';

export const createTicketSchema = z.object({
  subject: z.string().trim().min(4, 'Give the request a short subject').max(160),
  body: z.string().trim().min(10, 'Tell IT what happened, where and when').max(4000),
  categoryId: cuidSchema,
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.NORMAL),
  location: z.string().trim().max(160).nullish(),
  attachmentIds: z.array(cuidSchema).max(5).default([]),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assigneeId: cuidSchema.nullish(),
  resolution: z.string().trim().max(4000).nullish(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  q: z.string().trim().max(120).optional(),
  mine: z.coerce.boolean().optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

export interface TicketDto {
  id: string;
  reference: string;
  subject: string;
  body: string;
  category: TaxonomyRefDto;
  priority: TicketPriority;
  status: TicketStatus;
  location: string | null;
  resolution: string | null;
  requester: { id: string; displayName: string; email: string; departmentName: string | null };
  assignee: { id: string; displayName: string } | null;
  createdAt: string;
  updatedAt: string;
}
