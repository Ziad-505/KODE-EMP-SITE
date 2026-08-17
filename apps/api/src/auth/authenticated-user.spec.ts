import { Permission, Role, Scope } from '@kode/contracts';
import { AuthenticatedUser } from './authenticated-user';

function actor(role: Role, departmentId: string | null = null, extra: Permission[] = []) {
  return new AuthenticatedUser({
    id: 'u1',
    email: 'a@kode.test',
    role,
    departmentId,
    extraPermissions: extra,
    sessionId: 's1',
  });
}

describe('AuthenticatedUser', () => {
  it('gives Super Admin every permission', () => {
    const user = actor(Role.SUPER_ADMIN);
    expect(user.can(Permission.SETTINGS_MANAGE)).toBe(true);
    expect(user.can(Permission.AUDIT_READ)).toBe(true);
    expect(user.can(Permission.NEWS_PUBLISH)).toBe(true);
  });

  it('lets a Content Manager publish but keeps system access away from them', () => {
    const user = actor(Role.CONTENT_MANAGER);
    expect(user.can(Permission.NEWS_PUBLISH)).toBe(true);
    expect(user.can(Permission.POLICY_PUBLISH)).toBe(true);
    expect(user.can(Permission.SETTINGS_MANAGE)).toBe(false);
    expect(user.can(Permission.USER_ASSIGN_ROLE)).toBe(false);
    expect(user.can(Permission.AUDIT_READ)).toBe(false);
  });

  it('lets a Content Editor write but not publish', () => {
    const user = actor(Role.CONTENT_EDITOR);
    expect(user.can(Permission.NEWS_CREATE)).toBe(true);
    expect(user.can(Permission.NEWS_UPDATE)).toBe(true);
    expect(user.can(Permission.NEWS_PUBLISH)).toBe(false);
    expect(user.can(Permission.NEWS_DELETE)).toBe(false);
  });

  it('keeps an Employee out of the CMS entirely', () => {
    const user = actor(Role.EMPLOYEE);
    expect(user.can(Permission.CMS_ACCESS)).toBe(false);
    expect(user.can(Permission.NEWS_READ)).toBe(true);
    expect(user.can(Permission.NEWS_CREATE)).toBe(false);
    expect(user.can(Permission.TICKET_READ_ALL)).toBe(false);
    expect(user.can(Permission.TICKET_READ_OWN)).toBe(true);
  });

  it('honours directly granted extra permissions', () => {
    const user = actor(Role.CONTENT_EDITOR, null, [Permission.NEWS_PUBLISH]);
    expect(user.can(Permission.NEWS_PUBLISH)).toBe(true);
    expect(user.can(Permission.POLICY_PUBLISH)).toBe(false);
  });

  describe('department scoping', () => {
    const editor = actor(Role.DEPARTMENT_EDITOR, 'dept-ops');

    it('is department scoped', () => {
      expect(editor.scope).toBe(Scope.Department);
    });

    it('allows acting on its own department', () => {
      expect(editor.canActOn('dept-ops')).toBe(true);
    });

    it('refuses another department', () => {
      expect(editor.canActOn('dept-marketing')).toBe(false);
    });

    it('refuses club-wide content', () => {
      expect(editor.canActOn(null)).toBe(false);
    });

    it('lets a global-scope actor touch anything', () => {
      const manager = actor(Role.CONTENT_MANAGER);
      expect(manager.canActOn(null)).toBe(true);
      expect(manager.canActOn('dept-ops')).toBe(true);
    });
  });

  it('requires all permissions for canAll and any for canAny', () => {
    const user = actor(Role.CONTENT_EDITOR);
    expect(user.canAll([Permission.NEWS_CREATE, Permission.NEWS_PUBLISH])).toBe(false);
    expect(user.canAny([Permission.NEWS_CREATE, Permission.NEWS_PUBLISH])).toBe(true);
  });
});
