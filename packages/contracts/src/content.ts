import { z } from 'zod';
import { ContentStatus } from './enums';
import type { TaxonomyRefDto } from './taxonomy';
import { cuidSchema, paginationQuerySchema, slugSchema } from './common';

const richTextSchema = z.string().trim().min(1).max(60_000);
const titleSchema = z.string().trim().min(3).max(200);

export const contentStatusSchema = z.nativeEnum(ContentStatus);

/** Query shared by every public (portal) content list. */
export const publicListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(160).optional(),
  departmentId: cuidSchema.optional(),
});
export type PublicListQuery = z.infer<typeof publicListQuerySchema>;

/** Query shared by every CMS content list. Adds status filtering. */
export const adminListQuerySchema = publicListQuerySchema.extend({
  status: contentStatusSchema.optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'title', 'publishedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

/* ------------------------------------------------------------------ articles */

export const createArticleSchema = z.object({
  title: titleSchema,
  slug: slugSchema.optional(),
  excerpt: z.string().trim().max(400).nullish(),
  body: richTextSchema,
  categoryId: cuidSchema,
  coverMediaId: cuidSchema.nullish(),
  departmentId: cuidSchema.nullish(),
  pinned: z.boolean().default(false),
  status: contentStatusSchema.default(ContentStatus.DRAFT),
  publishedAt: z.coerce.date().nullish(),
});
export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export const updateArticleSchema = createArticleSchema.partial();
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

export interface ArticleDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  category: TaxonomyRefDto;
  pinned: boolean;
  status: ContentStatus;
  coverUrl: string | null;
  department: { id: string; name: string; colour: string } | null;
  author: { id: string; displayName: string } | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------- events */

export const createEventSchema = z
  .object({
    title: titleSchema,
    slug: slugSchema.optional(),
    description: richTextSchema,
    kindId: cuidSchema,
    location: z.string().trim().min(1).max(160),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullish(),
    capacity: z.coerce.number().int().min(1).max(10_000).nullish(),
    coverMediaId: cuidSchema.nullish(),
    departmentId: cuidSchema.nullish(),
    status: contentStatusSchema.default(ContentStatus.DRAFT),
  })
  .refine((value) => !value.endsAt || value.endsAt >= value.startsAt, {
    message: 'End time must be after the start time',
    path: ['endsAt'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;
/**
 * `.partial()` on the inner object drops the cross-field `.refine`, which meant
 * the contract both frontends import stopped rejecting an end time before the
 * start time on edit; only a hand-written server check caught it, and the form
 * showed no field-level error. The rule is reapplied here, guarding against the
 * partial case where only one of the two fields is present.
 */
export const updateEventSchema = createEventSchema
  .innerType()
  .partial()
  .refine((value) => !value.endsAt || !value.startsAt || value.endsAt >= value.startsAt, {
    message: 'End time must be after the start time',
    path: ['endsAt'],
  });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const listEventsQuerySchema = adminListQuerySchema.extend({
  upcoming: z.coerce.boolean().optional(),
  /** A taxonomy id. Filtering by the human-facing key is a UI concern. */
  kindId: cuidSchema.optional(),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export interface EventDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: TaxonomyRefDto;
  location: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number | null;
  status: ContentStatus;
  coverUrl: string | null;
  department: { id: string; name: string; colour: string } | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ policies */

export const createPolicySchema = z.object({
  title: titleSchema,
  slug: slugSchema.optional(),
  summary: z.string().trim().max(500).nullish(),
  body: richTextSchema,
  /** null means the policy is general and visible to every employee. */
  departmentId: cuidSchema.nullish(),
  documentMediaId: cuidSchema.nullish(),
  version: z.string().trim().max(20).default('1.0'),
  effectiveFrom: z.coerce.date().nullish(),
  reviewDueAt: z.coerce.date().nullish(),
  status: contentStatusSchema.default(ContentStatus.DRAFT),
});
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export const updatePolicySchema = createPolicySchema.partial();
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

export interface PolicyDto {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  version: string;
  status: ContentStatus;
  effectiveFrom: string | null;
  reviewDueAt: string | null;
  documentUrl: string | null;
  department: { id: string; name: string; colour: string } | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------- faqs */

export const createFaqSchema = z.object({
  question: z.string().trim().min(5).max(300),
  answer: richTextSchema,
  categoryId: cuidSchema,
  position: z.coerce.number().int().min(0).max(9999).default(0),
  departmentId: cuidSchema.nullish(),
  status: contentStatusSchema.default(ContentStatus.DRAFT),
});
export type CreateFaqInput = z.infer<typeof createFaqSchema>;
export const updateFaqSchema = createFaqSchema.partial();
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;

export interface FaqDto {
  id: string;
  question: string;
  answer: string;
  category: TaxonomyRefDto;
  position: number;
  status: ContentStatus;
  department: { id: string; name: string; colour: string } | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------- gallery */

export const createAlbumSchema = z.object({
  title: titleSchema,
  slug: slugSchema.optional(),
  description: z.string().trim().max(500).nullish(),
  coverMediaId: cuidSchema.nullish(),
  takenOn: z.coerce.date().nullish(),
  departmentId: cuidSchema.nullish(),
  status: contentStatusSchema.default(ContentStatus.DRAFT),
  itemIds: z.array(cuidSchema).max(200).default([]),
});
export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
export const updateAlbumSchema = createAlbumSchema.partial();
export type UpdateAlbumInput = z.infer<typeof updateAlbumSchema>;

export interface AlbumDto {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: ContentStatus;
  coverUrl: string | null;
  takenOn: string | null;
  itemCount: number;
  items: { id: string; url: string; alt: string | null }[];
  department: { id: string; name: string; colour: string } | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------- quicklinks */

export const createQuickLinkSchema = z.object({
  title: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(500),
  description: z.string().trim().max(240).nullish(),
  icon: z.string().trim().max(40).default('external'),
  position: z.coerce.number().int().min(0).max(9999).default(0),
  status: contentStatusSchema.default(ContentStatus.PUBLISHED),
});
export type CreateQuickLinkInput = z.infer<typeof createQuickLinkSchema>;
export const updateQuickLinkSchema = createQuickLinkSchema.partial();
export type UpdateQuickLinkInput = z.infer<typeof updateQuickLinkSchema>;

export interface QuickLinkDto {
  id: string;
  title: string;
  url: string;
  description: string | null;
  icon: string;
  position: number;
  status: ContentStatus;
}

/* --------------------------------------------------------------------- misc */

export const changeStatusSchema = z.object({
  status: contentStatusSchema,
  /** Optional note recorded on the audit entry. */
  note: z.string().trim().max(500).optional(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters').max(160),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export type SearchResultType = 'news' | 'event' | 'policy' | 'faq' | 'gallery' | 'person' | 'link';

export interface SearchResultDto {
  type: SearchResultType;
  id: string;
  slug: string | null;
  title: string;
  subtitle: string | null;
  href: string;
  rank: number;
}

export interface PortalHomeDto {
  news: ArticleDto[];
  events: EventDto[];
  links: QuickLinkDto[];
  stats: { publishedArticles: number; upcomingEvents: number; activePolicies: number };
}

export interface CmsDashboardDto {
  counts: {
    published: number;
    inReview: number;
    drafts: number;
    mediaItems: number;
    openTickets: number;
    people: number;
  };
  needsAttention: {
    id: string;
    type: SearchResultType;
    title: string;
    reason: string;
    status: ContentStatus;
    href: string;
  }[];
  publishingRhythm: { date: string; count: number }[];
  recentActivity: {
    id: string;
    action: string;
    summary: string;
    actorName: string | null;
    createdAt: string;
  }[];
}
