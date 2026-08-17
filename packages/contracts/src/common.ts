import { z } from 'zod';

export const cuidSchema = z.string().min(1).max(64);
export const slugSchema = z
  .string()
  .min(1)
  .max(140)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphenated slug');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function emptyPage<T>(query: PaginationQuery): Page<T> {
  return {
    items: [],
    meta: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 },
  };
}

/** Shape of every error the API returns. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Field-level messages, present only on 422 validation failures. */
  details?: Record<string, string[]>;
  requestId: string;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}
