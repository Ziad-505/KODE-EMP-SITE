import { z } from 'zod';
import { roleSchema, passwordSchema } from './auth';
import { UserStatus } from './enums';
import { paginationQuerySchema, cuidSchema } from './common';
import { ALL_PERMISSIONS, type Permission, type Role } from './rbac';

const permissionSchema = z.enum(ALL_PERMISSIONS as unknown as [Permission, ...Permission[]]);

const nameSchema = z.string().trim().min(1).max(80);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  firstName: nameSchema,
  lastName: nameSchema,
  jobTitle: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(40).nullish(),
  role: roleSchema,
  departmentId: cuidSchema.nullish(),
  /** Omit to create an Entra-only account with no local password. */
  password: passwordSchema.optional(),
  extraPermissions: z.array(permissionSchema).max(64).default([]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .omit({ password: true, email: true })
  .partial()
  .extend({ status: z.nativeEnum(UserStatus).optional() });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateProfileSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  jobTitle: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(40).nullish(),
  avatarMediaId: cuidSchema.nullish(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  role: roleSchema.optional(),
  departmentId: cuidSchema.optional(),
  status: z.nativeEnum(UserStatus).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).nullish(),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour')
    .default('#244EA2'),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export interface DepartmentDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  colour: string;
  memberCount?: number;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  jobTitle: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
  provider: string;
  department: DepartmentDto | null;
  avatarUrl: string | null;
  extraPermissions: Permission[];
  lastLoginAt: string | null;
  createdAt: string;
}

/** Public directory entry. Never exposes role, status or auth provider. */
export interface DirectoryEntryDto {
  id: string;
  displayName: string;
  jobTitle: string | null;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  department: { id: string; name: string; colour: string } | null;
}
