import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  Permission,
  ROLE_LABEL,
  Role,
  UserStatus,
  canAssignRole,
  type CreateUserInput,
  type DirectoryEntryDto,
  type ListUsersQuery,
  type Page,
  type UpdateProfileInput,
  type UpdateUserInput,
  type UserDto,
} from '@kode/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { MediaUrlService } from '../media/media-url.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';

const INCLUDE = {
  department: { select: { id: true, name: true, slug: true, description: true, colour: true } },
  avatarMedia: { select: { storageKey: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly urls: MediaUrlService,
  ) {}

  async list(query: ListUsersQuery): Promise<Page<UserDto>> {
    const mode = 'insensitive' as const;
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode } },
              { lastName: { contains: query.q, mode } },
              { email: { contains: query.q, mode } },
              { jobTitle: { contains: query.q, mode } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(id: string): Promise<UserDto> {
    const row = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('That person is not in the directory');
    return this.toDto(row);
  }

  /**
   * Public staff directory. Returns a deliberately narrower shape than UserDto:
   * role, status and auth provider are internal facts that employees have no
   * reason to see about each other.
   */
  async directory(query: ListUsersQuery): Promise<Page<DirectoryEntryDto>> {
    // `role` is stripped, not just omitted from the response shape. The
    // directory reuses the CMS list query, which accepts `role` as a *filter*,
    // so `GET /directory?role=SUPER_ADMIN` returned exactly the Super Admins by
    // name and email. Withholding a field from the DTO is pointless while the
    // same field works as an oracle. `status` is forced rather than stripped
    // because the directory is defined as active people only.
    const { role: _role, status: _status, ...safe } = query;
    const page = await this.list({ ...safe, status: UserStatus.ACTIVE });
    return {
      items: page.items.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        jobTitle: user.jobTitle,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        department: user.department
          ? { id: user.department.id, name: user.department.name, colour: user.department.colour }
          : null,
      })),
      meta: page.meta,
    };
  }

  async create(
    input: CreateUserInput,
    actor: AuthenticatedUser,
  ): Promise<{ user: UserDto; temporaryPassword?: string }> {
    this.assertRoleAssignable(actor, input.role);
    this.assertPermissionsGrantable(actor, input.extraPermissions);

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new BadRequestException('An account with that email already exists');

    // Without an explicit password we mint a strong temporary one and force a
    // change at first sign-in, rather than creating an account with no secret.
    const temporaryPassword = input.password
      ? undefined
      : this.passwords.generateTemporaryPassword();
    const plain = input.password ?? temporaryPassword!;

    const row = await this.prisma.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        role: input.role,
        departmentId: input.departmentId ?? null,
        extraPermissions: input.extraPermissions,
        status: UserStatus.INVITED,
        passwordHash: await this.passwords.hash(plain),
        mustChangePassword: !input.password,
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: row.id,
      summary: `Created account for ${row.firstName} ${row.lastName} as ${ROLE_LABEL[row.role as Role]}`,
      actorId: actor.id,
    });

    return { user: this.toDto(row), ...(temporaryPassword ? { temporaryPassword } : {}) };
  }

  async update(id: string, input: UpdateUserInput, actor: AuthenticatedUser): Promise<UserDto> {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!existing) throw new NotFoundException('That person is not in the directory');

    if (input.role && input.role !== existing.role) {
      // Both ends of the change are checked. Validating only the target role
      // let an actor demote someone senior to them, because a *lower* role is
      // always assignable: a Content Manager holding `user:assign_role` could
      // set a Super Admin to Employee, since Employee passed the target check.
      this.assertOutranks(actor, existing.role as Role, 'change the role of');
      this.assertRoleAssignable(actor, input.role);
      // Guard against demoting the last Super Admin and locking everyone out.
      if (existing.role === Role.SUPER_ADMIN) await this.assertNotLastSuperAdmin(id);
    }
    if (input.extraPermissions) this.assertPermissionsGrantable(actor, input.extraPermissions);

    // Account status is a deactivation control, so it requires the deactivation
    // permission wherever it is written. It was previously enforced only on
    // DELETE, which meant an actor deliberately given `user:update` without
    // `user:deactivate` could still suspend anyone by sending
    // `{"status":"SUSPENDED"}` to this endpoint. The rank guard is applied for
    // the same reason it applies to role changes: you may not act on someone
    // senior to you.
    if (input.status !== undefined && input.status !== existing.status) {
      if (!actor.can(Permission.USER_DEACTIVATE)) {
        throw new ForbiddenException('You do not have permission to change account status');
      }
      this.assertOutranks(actor, existing.role as Role, 'change the account status of');
      if (input.status === UserStatus.SUSPENDED && existing.role === Role.SUPER_ADMIN) {
        await this.assertNotLastSuperAdmin(id);
      }
      if (id === actor.id) {
        throw new ForbiddenException('You cannot change your own account status');
      }
    }
    if (id === actor.id && input.role && input.role !== existing.role) {
      throw new ForbiddenException('You cannot change your own role');
    }

    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.extraPermissions !== undefined
          ? { extraPermissions: input.extraPermissions }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: INCLUDE,
    });

    // A privilege change must not wait for the access token to expire, so every
    // session for that user is ended immediately and re-issued on next request.
    const privilegeChanged =
      (input.role && input.role !== existing.role) ||
      (input.extraPermissions &&
        JSON.stringify(input.extraPermissions) !== JSON.stringify(existing.extraPermissions)) ||
      (input.departmentId !== undefined && input.departmentId !== existing.departmentId) ||
      input.status === UserStatus.SUSPENDED;

    if (privilegeChanged) {
      await this.tokens.revokeAllForUser(id, 'Permissions changed');
    }

    await this.audit.record({
      action:
        input.role && input.role !== existing.role ? AuditAction.ROLE_CHANGE : AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      summary:
        input.role && input.role !== existing.role
          ? `Changed ${row.firstName} ${row.lastName} from ${ROLE_LABEL[existing.role as Role]} to ${ROLE_LABEL[row.role as Role]}`
          : `Updated ${row.firstName} ${row.lastName}`,
      actorId: actor.id,
      changes: AuditService.diff(
        {
          role: existing.role,
          status: existing.status,
          departmentId: existing.departmentId,
          extraPermissions: existing.extraPermissions,
        },
        {
          role: row.role,
          status: row.status,
          departmentId: row.departmentId,
          extraPermissions: row.extraPermissions,
        },
      ),
    });

    return this.toDto(row);
  }

  async updateOwnProfile(id: string, input: UpdateProfileInput): Promise<UserDto> {
    /*
     * An avatar must be an image that exists. This was written straight
     * through, so any employee could point their avatar at a policy PDF's media
     * id and have the API hand back a `avatarUrl` for it. The column is also
     * `@unique`, so reusing another user's avatar id raised a P2002 that
     * surfaced as a 409 from a request that should have been a 422.
     */
    if (input.avatarMediaId) {
      const media = await this.prisma.media.findFirst({
        where: { id: input.avatarMediaId, deletedAt: null },
        select: { mimeType: true, id: true },
      });
      if (!media || !media.mimeType.startsWith('image/')) {
        throw new BadRequestException('Choose an image from the media library.');
      }
      const taken = await this.prisma.user.findFirst({
        where: { avatarMediaId: input.avatarMediaId, id: { not: id } },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException("That image is already in use as someone else's photo.");
      }
    }

    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.avatarMediaId !== undefined
          ? { avatarMediaId: input.avatarMediaId ?? null }
          : {}),
      },
      include: INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      summary: 'Updated their own profile',
      actorId: id,
    });
    return this.toDto(row);
  }

  async deactivate(id: string, actor: AuthenticatedUser): Promise<void> {
    if (id === actor.id) throw new ForbiddenException('You cannot deactivate your own account');
    const existing = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('That person is not in the directory');
    this.assertOutranks(actor, existing.role as Role, 'deactivate');
    if (existing.role === Role.SUPER_ADMIN) await this.assertNotLastSuperAdmin(id);

    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.SUSPENDED, deletedAt: new Date() },
    });
    await this.tokens.revokeAllForUser(id, 'Account deactivated');

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'User',
      entityId: id,
      summary: `Deactivated ${existing.firstName} ${existing.lastName} and ended their sessions`,
      actorId: actor.id,
    });
  }

  async resetPassword(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ temporaryPassword: string }> {
    const existing = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('That person is not in the directory');

    // Resetting someone's password and being handed the new value is
    // functionally the same as signing in as them, so it needs the same rank
    // guard that granting a role does. Without this an actor holding
    // `user:update` could reset a Super Admin's password, read the temporary
    // value out of the response body, and take the account over. Every other
    // privileged write on this service goes through `canAssignRole`; this one
    // did not.
    this.assertOutranks(actor, existing.role as Role, 'reset the password for');

    const temporaryPassword = this.passwords.generateTemporaryPassword();
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(temporaryPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllForUser(id, 'Password reset by an administrator');

    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: id,
      summary: `Reset the password for ${existing.firstName} ${existing.lastName}`,
      actorId: actor.id,
    });

    return { temporaryPassword };
  }

  /* ------------------------------ internals ----------------------------- */

  /**
   * Rank guard for acting *on* a person, as opposed to granting a role.
   *
   * `canAssignRole` answers "may this actor hand out this role". The question
   * here is different: "may this actor take a privileged action against an
   * account that currently holds this role". Reusing `canAssignRole` gives the
   * right answer for both, because both reduce to a strict rank comparison
   * plus the role-assignment permission.
   */
  private assertOutranks(actor: AuthenticatedUser, targetRole: Role, verb: string): void {
    if (!canAssignRole(actor, targetRole)) {
      throw new ForbiddenException(
        `You cannot ${verb} someone with the ${ROLE_LABEL[targetRole]} role`,
      );
    }
  }

  private assertRoleAssignable(actor: AuthenticatedUser, target: Role): void {
    if (!canAssignRole(actor, target)) {
      throw new ForbiddenException(`You cannot grant the ${ROLE_LABEL[target]} role`);
    }
  }

  /** Nobody may grant a permission they do not themselves hold. */
  private assertPermissionsGrantable(
    actor: AuthenticatedUser,
    permissions: readonly Permission[],
  ): void {
    const missing = permissions.filter((permission) => !actor.can(permission));
    if (missing.length) {
      throw new ForbiddenException(
        `You cannot grant permissions you do not hold: ${missing.join(', ')}`,
      );
    }
  }

  private async assertNotLastSuperAdmin(excludingId: string): Promise<void> {
    const remaining = await this.prisma.user.count({
      where: {
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        NOT: { id: excludingId },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'This is the last active Super Admin. Promote someone else before changing this account.',
      );
    }
  }

  toDto(row: UserRow): UserDto {
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      displayName: `${row.firstName} ${row.lastName}`.trim(),
      jobTitle: row.jobTitle,
      phone: row.phone,
      role: row.role as Role,
      status: row.status as UserStatus,
      provider: row.provider,
      department: row.department,
      avatarUrl: this.urls.toUrl(row.avatarMedia?.storageKey),
      extraPermissions: row.extraPermissions as Permission[],
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
