import { z } from 'zod';
import { paginationQuerySchema } from './common';

/**
 * Fallback only. The real ceiling is `MAX_UPLOAD_MB` on the server and is
 * reported by `GET /media/limits`, because there were three separate values:
 * this constant, the env var, and a hardcoded 25 MB in the multer interceptor.
 * Setting `MAX_UPLOAD_MB=25` produced a server that accepted 25 MB and a UI
 * that refused at 15.
 *
 * A client should prefer the reported limit and use this only before it loads.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface MediaLimitsDto {
  maxUploadBytes: number;
  /** MIME types the server will accept, for the file picker's `accept`. */
  acceptedMimeTypes: readonly string[];
}

export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const;

export const ALLOWED_DOCUMENT_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const ALLOWED_UPLOAD_MIME = [...ALLOWED_IMAGE_MIME, ...ALLOWED_DOCUMENT_MIME] as const;
export type AllowedUploadMime = (typeof ALLOWED_UPLOAD_MIME)[number];

export const updateMediaSchema = z.object({
  alt: z.string().trim().max(300).nullish(),
  title: z.string().trim().max(200).nullish(),
});
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export const listMediaQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  kind: z.enum(['image', 'document']).optional(),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

export interface MediaDto {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  title: string | null;
  kind: 'image' | 'document';
  uploadedBy: { id: string; displayName: string } | null;
  createdAt: string;
}
