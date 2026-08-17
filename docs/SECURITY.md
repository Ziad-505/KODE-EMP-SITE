# Security notes

What was decided, and why. Written for the person who inherits this and needs to
know whether a given control is load-bearing before they change it.

## Threat model

The realistic threats for a club intranet, in order:

1. A stolen or shared employee credential.
2. A curious employee reaching content or a screen meant for another team.
3. Stored XSS through content an editor writes, or a file an editor uploads.
4. An unpatched dependency.
5. Accidental data loss.

Explicitly out of scope: a determined attacker with server access, and
nation-state adversaries. If someone has shell on the host, none of this helps.

## Authentication

### Local accounts

Argon2id with OWASP's recommended parameters (19 MiB memory, t=2, p=1). Argon2id
was chosen over bcrypt for two concrete reasons: bcrypt silently truncates input
at 72 bytes, and it has no memory hardness, so it is far cheaper to attack with
a GPU.

The password policy is length-first (12 characters minimum, 128 maximum) rather
than composition-first, following NIST 800-63B. Composition rules push people
toward `Password1!` and produce weaker passwords in practice.

Failed sign-ins are constant-time: an unknown email burns the same Argon2 work
as a real one, and returns an identical message, so response timing and wording
do not reveal which addresses are registered. After `LOGIN_MAX_ATTEMPTS`
consecutive failures the account locks for `LOGIN_LOCKOUT_MINUTES`.

Hashes are transparently upgraded on successful sign-in if the cost parameters
have moved on.

### Microsoft Entra ID

OIDC authorization-code flow with PKCE (S256) and a nonce. The state and code
verifier are stored server-side in the `oidc_states` table, single-use, with a
ten-minute expiry — not in a cookie, which a cross-site attacker could fixate.
The ID token is verified against the tenant JWKS with issuer and audience checks.

Two policies worth knowing about:

- Linking an Entra identity to an existing local account never changes that
  account's role. SSO authenticates; it does not authorise.
- `ENTRA_AUTO_PROVISION=false` rejects a tenant user with no portal account
  instead of creating one. Set it that way if you want membership managed
  explicitly.

The post-sign-in redirect is validated against the configured portal and CMS
origins, so the callback cannot be used as an open redirect.

## Sessions

Access tokens are short-lived JWTs (15 minutes by default) in an `httpOnly`
cookie. Nothing readable by JavaScript is a credential, so an XSS bug cannot
exfiltrate a session.

Refresh tokens are long-lived, `httpOnly`, and scoped with `Path=/api/v1/auth`
so they are never sent on ordinary API calls. Only a SHA-256 hash is stored, so
a database leak cannot resume a session.

**Rotation with reuse detection.** Every refresh mints a new token and marks the
old one rotated. Presenting an already-rotated token means it was replayed,
which in practice means it was stolen — so the whole token family is revoked.
Both the attacker and the legitimate user are signed out, and the theft becomes
visible instead of persisting silently.

Sessions are revoked immediately, not at token expiry, when:

- a role, department, extra permissions or account status changes;
- a password is changed (all other sessions end);
- an administrator resets a password or deactivates the account.

## Authorization

See `packages/contracts/src/rbac.ts`. The whole model is one file that the API
and both frontends import.

- **Deny by default.** The global guard rejects every request unless the route
  carries `@Public()`. A forgotten annotation produces a locked door, not an
  open one.
- **Permissions, not roles.** Guards check permission strings. Roles are named
  bundles. Adding a capability is one line in one file.
- **Scope is checked on the row.** A guard cannot see the data, so department
  scope is enforced in the service layer against the actual record.
- **Publishing is separate from editing.** A Content Editor can move a draft to
  review but not to published, which is what makes the review step meaningful
  rather than advisory. A publish attempt by someone without the right is
  silently downgraded to review rather than rejected, because that is what the
  author meant.
- **No privilege escalation.** Nobody can grant a role at or above their own
  rank, or a permission they do not themselves hold.
- **The last Super Admin is protected.** They cannot be demoted, suspended or
  deactivated — otherwise a single mistake locks everyone out permanently.

Client-side gates in both applications are a usability affordance. The API
enforces the same rules independently on every request.

## CSRF

Cookie authentication means the browser attaches credentials automatically, so a
cross-site form post would otherwise be authenticated. `SameSite=Lax` blocks
most of that; the double-submit token in `csrf.guard.ts` covers the rest. Any
unsafe method must echo the readable `kode_csrf` cookie in an `X-CSRF-Token`
header, compared in constant time.

Requests carrying an explicit `Authorization: Bearer` header are exempt: they
are not ambient-credential requests, so CSRF does not apply to them.

## File uploads

The dangerous parts of an upload endpoint, and what is done about each:

| Risk                                   | Control                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path traversal via filename            | Storage keys are generated server-side from a UUID. The original filename is metadata only and never touches the filesystem.                                        |
| Type confusion (a script named `.png`) | The declared MIME type is ignored in favour of the actual leading bytes, and a mismatch is rejected. See `media/file-signature.ts`.                                 |
| Active content                         | SVG is not on the allow list. It is a document format that can carry script.                                                                                        |
| Serving a payload from our origin      | `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Content-Disposition: attachment` for anything that is not an image. |
| Storage exhaustion                     | Size limit at both the multipart layer and the service, plus content-addressed de-duplication by SHA-256.                                                           |

## Input validation

Every request body and query string is parsed by a Zod schema from
`@kode/contracts` before it reaches a service. The same schemas run in the
browser, so a user sees the same message the server would have produced.

Prisma parameterises all queries; there is no string-concatenated SQL anywhere
in the codebase.

## Output and rendering

Content is rendered as React children, never with `dangerouslySetInnerHTML`.
Content authors are authenticated staff, but "trusted author" is not a reason to
hand an editor a stored-XSS primitive. Quick links are restricted to `http` and
`https` at the API, so `javascript:` and `data:` URLs cannot be stored.

## Audit trail

`audit_logs` is append-only. The application exposes no update or delete path,
**and** a database trigger raises on UPDATE and DELETE. An audit log the
application can rewrite is not an audit log.

Recorded: sign-in, failed sign-in, sign-out, content create/update/publish/
archive/delete, role changes, password changes, uploads and permission denials —
with the actor, IP, user agent, request id and a field-level diff.

Audit writes never throw into the caller. Losing a business operation because
the log write failed would be worse than a gap in the log, and the gap is
itself logged loudly.

## Rate limiting

Two buckets: a general one, and a much tighter one on the sign-in endpoints.
Behind the proxy, `TRUST_PROXY=true` makes the API trust exactly one hop, so
`X-Forwarded-For` cannot be spoofed to bypass the limit.

## Transport and headers

Caddy terminates TLS with automatically renewed certificates and sets HSTS
(one year, `includeSubDomains`, `preload`), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, a strict `Referrer-Policy` and a restrictive
`Permissions-Policy`. The API adds Helmet on top. CORS uses an explicit origin
allow-list with credentials, never a wildcard.

## Secrets

Every secret comes from the environment and is validated at boot; the process
refuses to start on a missing or weak value rather than failing at the first
request that happens to need it. Production additionally refuses to start if the
access and refresh secrets are equal, or if `SameSite=None` is set without
`Secure`.

The seed script refuses to create accounts with the documented development
password when `NODE_ENV=production`.

## Known gaps

Stated plainly, because an unstated gap is worse than a known one:

1. **No multi-factor authentication on local accounts.** Entra ID accounts
   inherit whatever MFA the tenant enforces. Local accounts do not have it.
   Recommendation: use Entra for everyone, and keep local accounts only as a
   break-glass path for Super Admins.
2. **No automated dependency patching.** CI audits, but nothing opens the PR.
   Enable Dependabot or Renovate.
3. **Rate limiting is per process.** With more than one API replica the
   effective limit multiplies. Move the throttler storage to Redis before
   scaling out.
4. **Media is on a local volume.** Fine for one host; move to S3-compatible
   object storage before running multiple API replicas. `MediaUrlService` is
   isolated for exactly that reason.
5. **No virus scanning on uploads.** Type checking is not malware detection. Add
   ClamAV if staff will upload documents from outside the club.
6. **Search is substring matching.** Correct and indexed at this data volume,
   but it is not ranked full-text search.
