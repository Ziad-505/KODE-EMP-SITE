import { z } from 'zod';
import { Role, type Permission } from './rbac';
import type { AuthProvider, UserStatus } from './enums';

/**
 * Password policy. Deliberately length-first rather than composition-first,
 * which is both stronger in practice and what NIST 800-63B recommends.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => !/^\s|\s$/.test(value), 'Cannot start or end with whitespace');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const roleSchema = z.nativeEnum(Role);

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  jobTitle: string | null;
  role: Role;
  status: UserStatus;
  provider: AuthProvider;
  departmentId: string | null;
  departmentName: string | null;
  avatarUrl: string | null;
  permissions: Permission[];
  mustChangePassword: boolean;
}

export interface LoginResponse {
  user: SessionUser;
  /** Seconds until the access token expires. The refresh happens via cookie. */
  expiresIn: number;
}
