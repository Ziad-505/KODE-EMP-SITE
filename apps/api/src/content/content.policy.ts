import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  Permission,
  Scope,
  slugify,
  type AdminListQuery,
} from '@kode/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';

/**
 * A `where` fragment. Deliberately not typed against a single Prisma model: the
 * same shape is composed into six different `where` clauses, and every content
 * model has a nullable `departmentId`, so this stays assignable to all of them.
 *
 * Fragments are always combined with AND rather than spread into the parent
 * object. Spreading would let a later `OR` (a text search, say) silently
 * replace the visibility `OR` and leak other departments' rows.
 */
export interface WhereFragment {
  OR?: { departmentId: string | null }[];
  status?: ContentStatus;
  deletedAt?: null;
}

export interface ContentPermissionSet {
  create: Permission;
  update: Permission;
  remove: Permission;
  publish: Permission;
}

/**
 * Every authorization rule that applies to content, in one place.
 *
 * The guard has already answered "may this actor call this endpoint at all".
 * This class answers the questions the guard cannot, because they need the row:
 * department scope, publication rights, and legal status transitions.
 */
@Injectable()
export class ContentPolicy {
  /**
   * Department-scoped editors may only write rows in their own department, and
   * may not create org-wide content. Everyone else with the permission is global.
   */
  assertCanWrite(
    actor: AuthenticatedUser,
    permission: Permission,
    departmentId: string | null | undefined,
  ): void {
    if (!actor.can(permission)) {
      throw new ForbiddenException('You do not have permission to do that');
    }
    if (actor.scope === Scope.Global) return;

    // Scope.Own must not fall through to global. It previously did: the check
    // was `!== Scope.Department`, so an EMPLOYEE granted `news:update` through
    // `extraPermissions` got unrestricted write access to every department's
    // content. `canActOnDepartment` in the contracts package has always
    // returned false for Own; this is the API agreeing with it.
    if (actor.scope === Scope.Own) {
      throw new ForbiddenException('Your account can read this area but not change content in it.');
    }

    if (departmentId === null || departmentId === undefined) {
      throw new ForbiddenException(
        'You can only manage content for your own department, not club-wide content.',
      );
    }
    if (departmentId !== actor.departmentId) {
      throw new ForbiddenException('That content belongs to another department');
    }
  }

  /**
   * Publishing is a separate right from editing. An actor without it can move a
   * draft to IN_REVIEW but not to PUBLISHED, which is what makes the review
   * step meaningful rather than advisory.
   */
  assertCanSetStatus(
    actor: AuthenticatedUser,
    permissions: ContentPermissionSet,
    from: ContentStatus,
    to: ContentStatus,
  ): void {
    if (from === to) return;

    const allowed = CONTENT_STATUS_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Cannot move content from ${from} to ${to}`);
    }
    if (
      (to === ContentStatus.PUBLISHED || from === ContentStatus.PUBLISHED) &&
      !actor.can(permissions.publish)
    ) {
      throw new ForbiddenException(
        'You can prepare and submit this, but only a Content Manager can publish or unpublish it.',
      );
    }
    if (to === ContentStatus.ARCHIVED && !actor.can(permissions.publish)) {
      throw new ForbiddenException('Only a Content Manager can archive content');
    }
  }

  /** The status a new item may be created with, given who is creating it. */
  resolveInitialStatus(
    actor: AuthenticatedUser,
    requested: ContentStatus,
    publishPermission: Permission,
  ): ContentStatus {
    if (requested === ContentStatus.PUBLISHED && !actor.can(publishPermission)) {
      return ContentStatus.IN_REVIEW;
    }
    return requested;
  }

  /**
   * The `where` fragment restricting a CMS list to what the actor may see.
   * Department editors see their own department plus org-wide items (read-only
   * for them), which is what makes the CMS usable without leaking other teams'
   * drafts.
   */
  cmsVisibility(actor: AuthenticatedUser): WhereFragment[] {
    if (actor.scope === Scope.Global) return [];
    // `in: [id, null]` never matches NULL in SQL, so this has to be an OR.
    // Scope.Own is treated exactly like Scope.Department rather than falling
    // through to "see everything", which is what the previous
    // `!== Scope.Department` test did.
    return [{ OR: [{ departmentId: actor.departmentId }, { departmentId: null }] }];
  }

  /**
   * Portal-facing filter: published only, plus department visibility.
   *
   * The department fragment is applied unconditionally. It used to be added
   * only when the actor had a department, which inverted the intent: a user
   * with `departmentId: null` (a new hire before assignment, or a Super Admin
   * with no department) saw every department's private content, while their
   * assigned colleagues correctly did not. With `departmentId` null the OR
   * reduces to "org-wide only", which is the right answer.
   */
  portalVisibility(actor: AuthenticatedUser | null): WhereFragment[] {
    return [
      { status: ContentStatus.PUBLISHED, deletedAt: null },
      { OR: [{ departmentId: null }, { departmentId: actor?.departmentId ?? null }] },
    ];
  }
}

/**
 * Deterministic ordering for CMS lists.
 *
 * The query schema validates `sort` against the union of every sortable field
 * across all five content types, but no single table has all of them: only
 * `Article` has `publishedAt`, and `Faq` has neither `publishedAt` nor `title`.
 * Passing the raw value straight through meant `GET /cms/events?sort=publishedAt`
 * — a value the shared contract declares valid, and which the admin UI can
 * produce — reached Prisma as an unknown column and returned a 500.
 *
 * Each caller now declares the columns its own table actually has, and anything
 * outside that set falls back to `updatedAt` rather than crashing.
 */
export function orderByFor(
  query: AdminListQuery,
  allowed: readonly string[] = ['updatedAt', 'createdAt'],
): Record<string, 'asc' | 'desc'> {
  const field = allowed.includes(query.sort) ? query.sort : 'updatedAt';
  return { [field]: query.order };
}

/**
 * Produces a slug that does not collide, appending -2, -3 and so on.
 * `existing` is supplied by the caller so this stays a pure function.
 */
export function uniqueSlug(desired: string, existing: readonly string[]): string {
  const base = slugify(desired) || 'item';
  if (!existing.includes(base)) return base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function pageMeta(total: number, page: number, pageSize: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Sets publishedAt the first time something goes live, and never resets it. */
export function resolvePublishedAt(
  nextStatus: ContentStatus,
  currentPublishedAt: Date | null,
  explicit?: Date | null,
): Date | null {
  if (explicit !== undefined && explicit !== null) return explicit;
  if (nextStatus === ContentStatus.PUBLISHED) return currentPublishedAt ?? new Date();
  return currentPublishedAt;
}

/**
 * The audit action for a content update.
 *
 * Articles used to record `PUBLISH` for *any* status change, so moving a draft
 * to IN_REVIEW wrote an audit row saying it had been published; events recorded
 * `UPDATE` even for a genuine publish. `GET /audit?action=PUBLISH` therefore
 * returned things that were never published and missed things that were, which
 * meant the trail could not answer "who published what" — the one question an
 * audit trail of a CMS exists to answer.
 *
 * PUBLISH is now recorded only when the content actually crosses into or out of
 * the published state.
 */
export function auditActionForUpdate(
  from: ContentStatus,
  to: ContentStatus | undefined,
): AuditAction {
  if (!to || to === from) return AuditAction.UPDATE;
  const crossesPublished = to === ContentStatus.PUBLISHED || from === ContentStatus.PUBLISHED;
  return crossesPublished ? AuditAction.PUBLISH : AuditAction.UPDATE;
}
