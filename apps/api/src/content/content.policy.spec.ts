import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentStatus, Permission, Role, canAssignRole } from '@kode/contracts';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  ContentPolicy,
  orderByFor,
  resolvePublishedAt,
  uniqueSlug,
  type ContentPermissionSet,
} from './content.policy';

const PERMISSIONS: ContentPermissionSet = {
  create: Permission.NEWS_CREATE,
  update: Permission.NEWS_UPDATE,
  remove: Permission.NEWS_DELETE,
  publish: Permission.NEWS_PUBLISH,
};

function actor(role: Role, departmentId: string | null = null) {
  return new AuthenticatedUser({
    id: 'u1',
    email: 'a@kode.test',
    role,
    departmentId,
    extraPermissions: [],
    sessionId: 's1',
  });
}

describe('ContentPolicy', () => {
  const policy = new ContentPolicy();

  describe('assertCanWrite', () => {
    it('permits a Content Manager on club-wide content', () => {
      expect(() =>
        policy.assertCanWrite(actor(Role.CONTENT_MANAGER), PERMISSIONS.create, null),
      ).not.toThrow();
    });

    it('refuses an Employee outright', () => {
      expect(() => policy.assertCanWrite(actor(Role.EMPLOYEE), PERMISSIONS.create, null)).toThrow(
        ForbiddenException,
      );
    });

    it('stops a department editor creating club-wide content', () => {
      expect(() =>
        policy.assertCanWrite(actor(Role.DEPARTMENT_EDITOR, 'ops'), PERMISSIONS.create, null),
      ).toThrow(ForbiddenException);
    });

    it("stops a department editor touching another team's content", () => {
      expect(() =>
        policy.assertCanWrite(
          actor(Role.DEPARTMENT_EDITOR, 'ops'),
          PERMISSIONS.update,
          'marketing',
        ),
      ).toThrow(ForbiddenException);
    });

    it('permits a department editor on their own department', () => {
      expect(() =>
        policy.assertCanWrite(actor(Role.DEPARTMENT_EDITOR, 'ops'), PERMISSIONS.update, 'ops'),
      ).not.toThrow();
    });
  });

  describe('assertCanSetStatus', () => {
    it('lets an editor submit for review', () => {
      expect(() =>
        policy.assertCanSetStatus(
          actor(Role.CONTENT_EDITOR),
          PERMISSIONS,
          ContentStatus.DRAFT,
          ContentStatus.IN_REVIEW,
        ),
      ).not.toThrow();
    });

    it('stops an editor publishing', () => {
      expect(() =>
        policy.assertCanSetStatus(
          actor(Role.CONTENT_EDITOR),
          PERMISSIONS,
          ContentStatus.IN_REVIEW,
          ContentStatus.PUBLISHED,
        ),
      ).toThrow(ForbiddenException);
    });

    it('stops an editor unpublishing', () => {
      expect(() =>
        policy.assertCanSetStatus(
          actor(Role.CONTENT_EDITOR),
          PERMISSIONS,
          ContentStatus.PUBLISHED,
          ContentStatus.DRAFT,
        ),
      ).toThrow(ForbiddenException);
    });

    it('lets a manager publish', () => {
      expect(() =>
        policy.assertCanSetStatus(
          actor(Role.CONTENT_MANAGER),
          PERMISSIONS,
          ContentStatus.IN_REVIEW,
          ContentStatus.PUBLISHED,
        ),
      ).not.toThrow();
    });

    it('rejects an illegal transition even for a Super Admin', () => {
      expect(() =>
        policy.assertCanSetStatus(
          actor(Role.SUPER_ADMIN),
          PERMISSIONS,
          ContentStatus.ARCHIVED,
          ContentStatus.PUBLISHED,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('resolveInitialStatus', () => {
    it('downgrades a publish attempt by someone who cannot publish', () => {
      expect(
        policy.resolveInitialStatus(
          actor(Role.CONTENT_EDITOR),
          ContentStatus.PUBLISHED,
          PERMISSIONS.publish,
        ),
      ).toBe(ContentStatus.IN_REVIEW);
    });

    it('leaves it alone for someone who can', () => {
      expect(
        policy.resolveInitialStatus(
          actor(Role.CONTENT_MANAGER),
          ContentStatus.PUBLISHED,
          PERMISSIONS.publish,
        ),
      ).toBe(ContentStatus.PUBLISHED);
    });
  });

  describe('visibility filters', () => {
    it('adds no constraint for a global actor', () => {
      expect(policy.cmsVisibility(actor(Role.CONTENT_MANAGER))).toEqual([]);
    });

    it('restricts a department editor to their department plus club-wide', () => {
      expect(policy.cmsVisibility(actor(Role.DEPARTMENT_EDITOR, 'ops'))).toEqual([
        { OR: [{ departmentId: 'ops' }, { departmentId: null }] },
      ]);
    });

    it('always filters the portal to published, undeleted rows', () => {
      const [first] = policy.portalVisibility(actor(Role.EMPLOYEE));
      expect(first).toEqual({ status: ContentStatus.PUBLISHED, deletedAt: null });
    });
  });
});

describe('uniqueSlug', () => {
  it('slugifies', () => {
    expect(uniqueSlug("Inside KODE's busiest month", [])).toBe('inside-kodes-busiest-month');
  });

  it('appends a suffix on collision', () => {
    expect(uniqueSlug('Club news', ['club-news'])).toBe('club-news-2');
    expect(uniqueSlug('Club news', ['club-news', 'club-news-2'])).toBe('club-news-3');
  });

  it('falls back when the input has no usable characters', () => {
    expect(uniqueSlug('***', [])).toBe('item');
  });
});

describe('resolvePublishedAt', () => {
  it('stamps the first publish', () => {
    expect(resolvePublishedAt(ContentStatus.PUBLISHED, null)).toBeInstanceOf(Date);
  });

  it('does not move an existing publish date', () => {
    const original = new Date('2026-01-01T00:00:00.000Z');
    expect(resolvePublishedAt(ContentStatus.PUBLISHED, original)).toBe(original);
  });

  it('keeps the date when archiving so republishing is not backdated', () => {
    const original = new Date('2026-01-01T00:00:00.000Z');
    expect(resolvePublishedAt(ContentStatus.ARCHIVED, original)).toBe(original);
  });
});

describe('canAssignRole', () => {
  it('lets a Super Admin grant anything', () => {
    const admin = actor(Role.SUPER_ADMIN);
    expect(canAssignRole(admin, Role.SUPER_ADMIN)).toBe(true);
    expect(canAssignRole(admin, Role.EMPLOYEE)).toBe(true);
  });

  it('stops anyone else granting roles at all', () => {
    expect(canAssignRole(actor(Role.CONTENT_MANAGER), Role.EMPLOYEE)).toBe(false);
  });
});

/**
 * Regression tests for the authorization holes found in the August audit.
 * Each of these passed silently before the fix, which is the point.
 */
describe('ContentPolicy: scope regressions', () => {
  const policy = new ContentPolicy();

  /** An EMPLOYEE handed a content permission through extraPermissions. */
  function ownScopeEditor(departmentId: string | null = 'dept-ops') {
    return new AuthenticatedUser({
      id: 'u9',
      email: 'employee@kode.test',
      role: Role.EMPLOYEE,
      departmentId,
      extraPermissions: [Permission.NEWS_UPDATE, Permission.NEWS_READ],
      sessionId: 's9',
    });
  }

  it('refuses a write from an Own-scope actor even when they hold the permission', () => {
    // Previously `actor.scope !== Scope.Department` returned early for Own,
    // which granted unrestricted, cross-department write access.
    expect(() =>
      policy.assertCanWrite(ownScopeEditor(), Permission.NEWS_UPDATE, 'dept-finance'),
    ).toThrow(ForbiddenException);
  });

  it('refuses an Own-scope write to their own department too', () => {
    expect(() =>
      policy.assertCanWrite(ownScopeEditor('dept-ops'), Permission.NEWS_UPDATE, 'dept-ops'),
    ).toThrow(ForbiddenException);
  });

  it('does not hand an Own-scope actor an unfiltered CMS list', () => {
    const fragments = policy.cmsVisibility(ownScopeEditor('dept-ops'));
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.OR).toEqual([{ departmentId: 'dept-ops' }, { departmentId: null }]);
  });

  it('still gives a Global-scope actor an unfiltered CMS list', () => {
    expect(policy.cmsVisibility(actor(Role.SUPER_ADMIN))).toEqual([]);
  });

  it('restricts a departmentless portal reader to org-wide content', () => {
    // The department fragment used to be skipped entirely when departmentId was
    // null, so a user awaiting assignment saw every department's content.
    const fragments = policy.portalVisibility(actor(Role.EMPLOYEE, null));
    expect(fragments).toHaveLength(2);
    expect(fragments[1]?.OR).toEqual([{ departmentId: null }, { departmentId: null }]);
  });

  it('restricts an anonymous portal reader to org-wide content', () => {
    const fragments = policy.portalVisibility(null);
    expect(fragments[1]?.OR).toEqual([{ departmentId: null }, { departmentId: null }]);
  });

  it('gives a departmental portal reader their department plus org-wide', () => {
    const fragments = policy.portalVisibility(actor(Role.EMPLOYEE, 'dept-ops'));
    expect(fragments[1]?.OR).toEqual([{ departmentId: null }, { departmentId: 'dept-ops' }]);
  });
});

describe('orderByFor', () => {
  const base = { page: 1, pageSize: 20, sort: 'updatedAt', order: 'desc' } as never;

  it('passes through a column the table actually has', () => {
    expect(
      orderByFor({ ...(base as object), sort: 'title', order: 'asc' } as never, [
        'updatedAt',
        'title',
      ]),
    ).toEqual({ title: 'asc' });
  });

  it('falls back instead of sending an unknown column to Prisma', () => {
    // `sort=publishedAt` is valid per the shared contract but only Article has
    // the column; events, policies, gallery and FAQs used to 500 on it.
    expect(
      orderByFor({ ...(base as object), sort: 'publishedAt', order: 'desc' } as never, [
        'updatedAt',
        'createdAt',
        'title',
      ]),
    ).toEqual({ updatedAt: 'desc' });
  });
});
