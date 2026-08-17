import { z } from 'zod';

/**
 * Admin-managed terms.
 *
 * The namespaces are a closed set, because adding a *kind of list* is a
 * modelling decision. The terms inside them are open, because adding an entry
 * to a list is an editorial decision. Conflating the two is what made "add an
 * event kind" a schema migration plus a coordinated redeploy of three
 * artifacts.
 */
export const TaxonomyKind = {
  EVENT_KIND: 'EVENT_KIND',
  ARTICLE_CATEGORY: 'ARTICLE_CATEGORY',
  FAQ_CATEGORY: 'FAQ_CATEGORY',
  TICKET_CATEGORY: 'TICKET_CATEGORY',
} as const;
export type TaxonomyKind = (typeof TaxonomyKind)[keyof typeof TaxonomyKind];
export const ALL_TAXONOMY_KINDS = Object.values(TaxonomyKind) as readonly TaxonomyKind[];

/** What each namespace is called in the CMS, and what it governs. */
export const TAXONOMY_KIND_LABEL: Record<TaxonomyKind, string> = {
  EVENT_KIND: 'Event kinds',
  ARTICLE_CATEGORY: 'News categories',
  FAQ_CATEGORY: 'FAQ categories',
  TICKET_CATEGORY: 'Support categories',
};

export const TAXONOMY_KIND_HINT: Record<TaxonomyKind, string> = {
  EVENT_KIND: 'How events are grouped on the portal calendar.',
  ARTICLE_CATEGORY: 'The label above each story in the news list.',
  FAQ_CATEGORY: 'How questions are grouped on the FAQ page.',
  TICKET_CATEGORY: 'The categories employees pick from when raising an IT ticket.',
};

/**
 * `key` is machine-facing and immutable once created: it is what any external
 * integration, saved filter or bookmarked URL refers to. `label` is what people
 * see and may be renamed freely, which is what stops "Club Life" and
 * "club life" existing as two separate things.
 */
export const taxonomyKeySchema = z
  .string()
  .trim()
  .min(2, 'Give it at least two characters')
  .max(40)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'Use capitals, digits and underscores only, starting with a letter (for example COMMUNITY_OUTREACH)',
  );

export const createTaxonomySchema = z.object({
  kind: z.nativeEnum(TaxonomyKind),
  key: taxonomyKeySchema,
  label: z.string().trim().min(1, 'Give it a name people will recognise').max(60),
  description: z.string().trim().max(200).nullish(),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour, for example #244EA2')
    .default('#244EA2'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type CreateTaxonomyInput = z.infer<typeof createTaxonomySchema>;

/**
 * `kind` and `key` are absent by design. A term cannot move between namespaces,
 * and its key is what other systems hold, so both are set once at creation.
 */
export const updateTaxonomySchema = createTaxonomySchema
  .omit({ kind: true, key: true })
  .partial()
  .extend({ archived: z.boolean().optional() });
export type UpdateTaxonomyInput = z.infer<typeof updateTaxonomySchema>;

export const listTaxonomyQuerySchema = z.object({
  kind: z.nativeEnum(TaxonomyKind).optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type ListTaxonomyQuery = z.infer<typeof listTaxonomyQuerySchema>;

export interface TaxonomyDto {
  id: string;
  kind: TaxonomyKind;
  key: string;
  label: string;
  description: string | null;
  colour: string;
  sortOrder: number;
  /** Installed by the seed. May be renamed or archived, never deleted. */
  isSystem: boolean;
  archivedAt: string | null;
  /** How many rows currently reference this term. Drives the delete affordance. */
  usageCount: number;
}

/**
 * The shape embedded in content DTOs. Deliberately narrow: a consumer rendering
 * an event card needs the label and the colour, not the whole record.
 *
 * Sending the label rather than only the key is what stops a portal bundle
 * deployed before a new term was added from rendering `01 / undefined`.
 */
export interface TaxonomyRefDto {
  id: string;
  key: string;
  label: string;
  colour: string;
}
