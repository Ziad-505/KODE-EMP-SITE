import type { Permission, Role } from '@kode/contracts';

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  email: string;
  role: Role;
  dept: string | null;
  /** Extra permissions granted directly to the user. */
  perm: Permission[];
  /** Refresh-token family id, so an access token can be tied to a session. */
  sid: string;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  /** Opaque per-token id; the hash of the whole token is what is stored. */
  jti: string;
  typ: 'refresh';
}
