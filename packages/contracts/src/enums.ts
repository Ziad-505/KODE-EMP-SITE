export const ContentStatus = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];
export const ALL_CONTENT_STATUSES = Object.values(ContentStatus) as readonly ContentStatus[];

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

/** Legal status transitions. Anything not listed here is rejected server-side. */
export const CONTENT_STATUS_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  DRAFT: ['IN_REVIEW', 'PUBLISHED', 'ARCHIVED'],
  IN_REVIEW: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED', 'DRAFT'],
  ARCHIVED: ['DRAFT'],
};

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const TicketStatus = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];
export const ALL_TICKET_PRIORITIES = Object.values(TicketPriority) as readonly TicketPriority[];

/**
 * Ticket categories moved to the `taxonomies` table alongside event kinds and
 * the two former free-text category columns, so all four are now one model an
 * administrator can manage. These keys are what the seed installs; they are
 * marked `isSystem` because IT's Odoo rules parse the category out of the
 * notification email and must not have a value deleted from under them.
 */
export const SEEDED_TICKET_CATEGORY_KEYS = [
  'HARDWARE',
  'SOFTWARE',
  'NETWORK',
  'ACCESS',
  'OTHER',
] as const;
export type SeededTicketCategoryKey = (typeof SEEDED_TICKET_CATEGORY_KEYS)[number];

/**
 * Event kinds are no longer an enum. They live in the `taxonomies` table so an
 * administrator can add one without a migration and a redeploy; see
 * `taxonomy.ts`. What remains here are the four keys the seed installs, which
 * exist so seed and test code can refer to them by name rather than by cuid.
 *
 * Nothing at runtime should switch on these. An event's kind arrives as a
 * `TaxonomyRefDto` carrying its own label and colour, precisely so a frontend
 * deployed before a new term was created still renders it correctly instead of
 * printing `undefined`.
 */
export const SEEDED_EVENT_KIND_KEYS = [
  'CLUB_MOMENT',
  'LEARNING',
  'WELLBEING',
  'ANNOUNCEMENT',
] as const;
export type SeededEventKindKey = (typeof SEEDED_EVENT_KIND_KEYS)[number];

export const AuthProvider = {
  LOCAL: 'LOCAL',
  ENTRA_ID: 'ENTRA_ID',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  PUBLISH: 'PUBLISH',
  ARCHIVE: 'ARCHIVE',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  ROLE_CHANGE: 'ROLE_CHANGE',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UPLOAD: 'UPLOAD',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
