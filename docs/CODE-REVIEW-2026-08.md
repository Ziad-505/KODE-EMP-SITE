# KODE employee portal: code review

**Date:** 16 August 2026
**Scope:** `apps/api`, `apps/admin`, `apps/portal`, `packages/contracts`, `infra`
**Method:** direct source reading, unit and bootstrap test execution, headless
Chromium rendering at 390 / 768 / 1024 / 1440. Prisma's engine CDN is blocked in
the review environment, so nothing below was verified against a live database
unless it says so.

---

## 1. Summary

**59 findings verified by reading the code**, of which **14 are now fixed and
installed**. The remainder are catalogued here with severity, file, line and a
concrete failure scenario.

| Area | Critical | High | Medium | Low |
| --- | --- | --- | --- | --- |
| Authorization and permissions | 1 | 6 | 6 | 1 |
| Logic errors | 0 | 5 | 9 | 5 |
| Architecture | 0 | 1 | 5 | 1 |
| Capability foreclosed by the data model | 0 | 1 | 2 | 0 |
| Dead code | — | — | — | 16 items |

Two things are worth saying plainly.

**The security model is well designed and unevenly enforced.** `rbac.ts` is
genuinely good: permissions rather than role names, a single source of truth
shared by three packages, publish separated from edit. The defects are not
design failures, they are places where a code path skipped the model. That is
the better problem to have, because each fix is local.

**One finding is a live data breach, not a theoretical one.** Every uploaded
file was served with no authentication at all. That is fixed.

**Correction to an earlier statement in this session:** I said "147 findings
across two audits". That was wrong. One deep audit ran, against the API and
contracts, producing 59 findings; the CMS and portal issues I cite below come
from my own direct inspection, not a systematic audit. A full CMS and portal
audit has not been done. I would rather correct that than let the number stand.

---

## 2. Fixed in this pass

All 14 are installed, typecheck clean, lint clean, and covered by 58 passing
unit tests (9 of them new regression tests written specifically for these).

| # | Severity | What was wrong | File |
| --- | --- | --- | --- |
| 1 | **Critical** | Uploaded files served with `@Public()`. Any draft, department-scoped policy PDF was fetchable by anyone on the internet holding the URL, and those URLs are handed out in every DTO carrying `documentUrl`, `coverUrl` or `avatarUrl`. | `api/src/media/media.controller.ts` |
| 2 | **High** | The same route registered at `/v1/media/...` while `MediaUrlService` advertised `/media/...` and Caddy proxied `/media/*` verbatim. Every cover image and document would have 404'd in production. Fixed with `@Version(VERSION_NEUTRAL)`. | `api/src/media/media.controller.ts` |
| 3 | **High** | `Cache-Control: public` on a now-authenticated response would let a shared cache serve one user's file to another. Changed to `private`. | `api/src/media/media.controller.ts` |
| 4 | **High** | `assertCanWrite` tested `scope !== Department`, so `Scope.Own` fell through to unrestricted global write. An employee granted `news:update` could edit any department's content. | `api/src/content/content.policy.ts` |
| 5 | **High** | Same hole on the read side in `cmsVisibility`: that employee also saw every department's unpublished drafts. | `api/src/content/content.policy.ts` |
| 6 | **High** | `portalVisibility` applied the department filter only when the actor *had* a department, so a new hire awaiting assignment saw strictly more than their assigned colleagues. | `api/src/content/content.policy.ts` |
| 7 | **Medium** | Search carried its own copy of the visibility fragment, including the same hole. Now calls `ContentPolicy.portalVisibility`. | `api/src/content/search.service.ts` |
| 8 | **High** | Password reset had no rank check and returned the new password in the body. An actor with `user:update` could reset a Super Admin's password and read the value. | `api/src/users/users.service.ts` |
| 9 | **High** | Account status was writable via `PATCH /cms/users/:id` with only `user:update`, bypassing `user:deactivate` entirely, with no rank check. | `api/src/users/users.service.ts` |
| 10 | **High** | Role changes validated only the *target* role, so a Content Manager could demote a Super Admin to Employee (a lower role is always assignable). Both ends are now checked. | `api/src/users/users.service.ts` |
| 11 | **High** | Deactivating someone revoked refresh tokens but not the access token they already held, so a leaver stayed fully privileged for up to 15 minutes. Now a cached live account check bounds it to 15 seconds. | `api/src/auth/jwt-auth.guard.ts` |
| 12 | **High** | The CMS dashboard embedded the audit trail behind only `cms:access`, handing every Department Editor lines like "Changed X to Super Admin" and "Reset the password for Y". | `api/src/content/dashboard.service.ts` |
| 13 | **High** | Deleting a department counted only users, articles and policies. Events, FAQs and albums are `SetNull`, so deleting a department that owned only those silently made restricted content org-wide. | `api/src/users/departments.service.ts` |
| 14 | **High** | **Data loss.** Saving a gallery album from the CMS forced `itemIds: []` onto the payload, and the API treats that as the complete desired set. Fixing a title typo detached every photo in the album, behind a success toast. | `admin/src/routes/content-editor.tsx` |

Two more fixed alongside them:

- `GET /cms/events?sort=publishedAt` returned a 500. The shared contract
  declares that sort value valid for all five content types, but only `Article`
  has the column. Each service now declares its own sortable columns.
  (`content.policy.ts`, five services.)
- `PATCH /media/item/:id` behaved like a PUT: sending `alt` silently nulled
  `title`. (`media.service.ts`.)
- The CMS had **no navigation at all below 650px** — the sidebar was
  `display: none` with nothing in its place, so once you left the dashboard the
  only way back was the browser's back button. It is now a fixed bottom tab bar.
  The collapsed 980px rail was also broken, styling `nav button` when the nav
  renders anchors. (`admin/src/styles/base.css`.)

---

## 3. Authorization, still open

**A9 — high — `api/src/media/media.service.ts:129`, `:167`**
The media library has no department scoping at all; the `where` clause contains
only `deletedAt`, `q` and `kind`. A Department Editor in Sports can enumerate
every document in the club. Fixing this properly needs a `departmentId` column
on `Media` and a migration, which is why it is not in the fixed list.

**A10 — medium — `api/src/users/users.service.ts:244`**
`avatarMediaId` is written with no check that the media exists, is an image, or
relates to the caller. Any employee can point their avatar at a policy PDF. The
column is `@unique`, so pointing at another user's avatar raises P2002 and
surfaces as a 409 from a request that should have been a 422.

**A11 — medium — `api/src/support/support.service.ts:70`**
`attachmentIds` are attached to a ticket with no ownership or existence check.

**A12 — low — `api/src/content/portal.controller.ts:49`, `:72`**
Two of fourteen portal routes carry no `@RequirePermissions`. Not currently
exploitable, but `search` returns people rows with no `directory:read` check, so
removing that permission from a role would not remove people from search.

**Negative results worth recording.** I could not find any path by which a
Content Editor publishes: `create` downgrades via `resolveInitialStatus`,
`update` calls `assertCanSetStatus` when status is present, and `changeStatus`
always calls it. Nor can anyone elevate their own role, or grant a permission
they do not hold. Those parts work.

---

## 4. Logic errors

**L1 — high — `api/src/auth/entra.service.ts:61`**
`authority` is `https://login.microsoftonline.com/{tid}/v2.0`, which is the
correct *issuer* but the wrong *base for endpoints*. Authorize and token live
under `/{tid}/oauth2/v2.0/`, JWKS under `/{tid}/discovery/v2.0/keys`. With
`ENTRA_ENABLED=true`, every SSO attempt fails. **SSO has never worked against a
real tenant.** This matters before you point it at your Azure directory.

**L2 — high — `api/src/support/support.service.ts:191`**
Ticket references are `count() + 1`. `requesterId` is `onDelete: Cascade`, so
hard-deleting a departed employee drops the count and the next submissions
collide with existing references. The employee simply cannot raise a ticket.
Use a Postgres sequence.

**L3 — high — `api/src/outbox/outbox.service.ts:53`**
`drain()` has no `FOR UPDATE SKIP LOCKED` and no lease; the `draining` flag is
per-process. With two API replicas, IT gets two identical emails and Odoo gets
two tickets for one request.

**L4 — high — `api/src/health/health.controller.ts:45`**
Readiness reports `down` whenever one message has exhausted its delivery
attempts. One ticket email to a temporarily unroutable inbox dead-letters at
02:00 and the load balancer pulls every replica out of rotation permanently. A
non-critical email should not be able to take the portal offline.

**L5 — medium — `api/src/auth/token.service.ts:87`**
Refresh replay detection is a read followed by an unguarded write. Two
simultaneous uses of the same token both pass, and the theft is never detected.
Needs `updateMany({where: {id, rotatedAt: null}})` with a count check.

**L6 — medium — `api/src/content/gallery.service.ts:172`**
`nextSlug` runs a `findMany` on a different connection from inside an open
interactive transaction. With `DATABASE_POOL_SIZE=10` and ten concurrent album
edits, every connection is held by a transaction waiting for an eleventh.

**L7 — medium — slug generation, four services**
Every slug in the table is loaded into memory per create, unfiltered by
`deletedAt`, and check-then-insert is not atomic. Two editors publishing "Club
news" simultaneously both compute `club-news-2` and the second gets a 409.
Soft-deleted rows also permanently occupy their slug with no visible reason.

**L8 — medium — `api/src/content/dashboard.service.ts:127`**
`toISOString().slice(0,10)` labels a *local* midnight with its *UTC* date. At
UTC+4 every bar in the seven-day publishing strip is attributed to the previous
day.

**L9 — medium — `api/src/content/events.service.ts:295`**
Upcoming events use local midnight while the count beside them uses `new Date()`,
so the homepage renders "2 upcoming events" above a list of three.

**L10 — medium — audit action inconsistency**
Articles record `PUBLISH` for *any* status change; events record `UPDATE` even
for a genuine publish. `GET /audit?action=PUBLISH` therefore returns things that
were never published and misses things that were. The audit trail cannot answer
"who published what". (`articles.service.ts:206`, `events.service.ts:203`.)

**L11 — low — `api/src/content/events.service.ts:180`**
A failed start/end-time comparison throws `NotFoundException`, so the UI treats
a validation failure as a missing record. Same in `quick-links.service.ts:122`.

**L12 — low — `packages/contracts/src/content.ts:81`**
`updateEventSchema = createEventSchema.innerType().partial()` strips the
cross-field `.refine`, so the contract both frontends import no longer rejects
`endsAt < startsAt` on edit.

**L13 — low — `api/src/content/articles.service.ts:196`**
`publishedAt` is caller-supplied and applied regardless of publish rights. An
editor who cannot publish can set it to 2030 and pin the story to the top of the
list forever.

**L14 — low — `api/src/auth/token.service.ts:156`**
Revoked tokens are hard-deleted after 24 hours, which also deletes the evidence
replay detection depends on. A token replayed at 25 hours produces no warning.

**L15 — low — `faqs.service.ts:40`, `gallery.service.ts:59`**
`departmentId` is accepted and silently ignored by these two, while the other
three honour it. The filter appears to work and does nothing.

---

## 5. Dead code

Sixteen items. The notable ones:

- `RequireRoles` and `RequireAnyPermission` decorators are never applied, so the
  corresponding branches in `jwt-auth.guard.ts` are unreachable.
- `Permission.SETTINGS_MANAGE` and the entire `Setting` model. The table is
  created by the initial migration and never read or written. **This is the
  natural home for admin-managed taxonomies** (see §7).
- `TicketAttachment` rows are written but never selected, never in `TicketDto`,
  and never in the notification email. A user attaches a screenshot of the
  broken screen and neither IT nor the portal can ever see it.
- Three different upload size limits: `MAX_UPLOAD_MB` in env, a hardcoded 15 MB
  in contracts, and a hardcoded 25 MB in the multer interceptor. Setting the env
  var to 25 gives a UI that refuses at 15.
- `AUTH_RATE_LIMIT_MAX` is overridden by hardcoded literals on both routes that
  use it, so changing it has no effect.
- The schema header claims every content table carries a `searchVector`. No model
  has one and no migration creates one.
- `apps/deploytest/` is a workspace package containing only `node_modules`.
- Unused helpers: `dueForReview`, `extensionFor`, `constantTimeEquals` (which is
  duplicated inline in `csrf.guard.ts`), `notDeleted`, `isUniqueViolation`,
  `isNotFound`, `isConfigured`, `verify`, `emptyPage`, `sortOrderSchema`,
  `ALL_TICKET_STATUSES`, `QUICK_LINK_PERMISSION`.

---

## 6. Architecture

**R1 — high — `api/src/media/media-url.service.ts` vs `api/src/main.ts:61`**
Covered as fix #2. The structural lesson: nothing tested a media URL end to end.
`bootstrap.e2e-spec.ts` replicates the prefix setup and never requests one.

**R2 — medium — `api/src/content/portal.controller.ts:46`**
The controller injects `PrismaService` and issues three `count()` queries inline.
They are the only content queries outside a service and outside `ContentPolicy`,
and consequently the only unscoped ones: `stats.publishedArticles` counts every
department regardless of who is asking, disagreeing with the list beside it.

**R3 — medium — `apps/admin/src/lib/api-client.ts` and `apps/portal/src/lib/api-client.ts`**
Byte-identical, 183 lines each. `diff` produces no output. The refresh-coalescing
logic, `ApiError` and the CSRF echo exist twice and in neither case in
`@kode/contracts`. This belongs in the shared package.

**R4 — medium — `apps/admin/src/routes/people.tsx:61`**
The rule "nobody may grant a role at or above their own rank" is re-implemented
in the UI from `ROLE_RANK` instead of calling the exported `canAssignRole` —
precisely the drift `rbac.ts`'s own header comment claims is impossible. The UI
copy also omits the `USER_ASSIGN_ROLE` check, so it offers options the server
will reject.

**R5 — medium — validation outside contracts**
Three server-side rules exist only in service code and are unavailable to the
frontends the contracts package exists to keep in step: the event time check,
the quick-link URL scheme check, and the upload ceiling.

**Worth keeping.** The `WhereFragment[]` composition in `ContentPolicy` is
correct and subtle: fragments are AND-composed rather than spread, so a text
search `OR` cannot displace the visibility `OR`. The append-only audit trail
enforced by database trigger rather than convention is the right call. The
transactional outbox is the right pattern, it just needs locking.

---

## 7. Capability the data model forecloses

This is the root of your "admin cannot add an event kind" complaint, and it is
worse than it looks, because the same concept is modelled three different ways.

| Concept | Modelled as | Runtime-manageable |
| --- | --- | --- |
| Event kind | Postgres enum `EventKind` | No |
| Ticket category | Postgres enum `TicketCategory` | No |
| Article category | Free-text `String`, default "Club life" | No, and unconstrained |
| FAQ category | Free-text `String`, default "Workplace" | No, and unconstrained |

**Adding one event kind today** requires: a schema edit, a hand-written
migration (`ALTER TYPE ... ADD VALUE` cannot run inside a transaction, which is
how Prisma Migrate executes migration files, so it needs a separately applied
step), a contracts rebuild, and a coordinated redeploy of the API and both SPAs.
Deploy the API first and an older portal bundle renders `01 / undefined`. Nine
files change.

Meanwhile the free-text categories have the opposite failure: two editors type
"Club Life" and "club life", the portal shows both as distinct facets, and
renaming across 400 articles is a manual `UPDATE`.

**The fix is one shape for all four.** A `Taxonomy` table with
`(kind, key, label, colour, sortOrder, archivedAt)`, an admin screen under
Settings, and a `taxonomyId` foreign key replacing each enum and string. The
`Setting` model and `SETTINGS_MANAGE` permission already exist and are unused,
so the permission and navigation slot are already there. This is the single
highest-leverage change remaining, and it is a prerequisite for the CMS work you
asked for.

---

## 8. Front end, what I have verified so far

Directly confirmed:

- **CMS below 650px had no navigation.** Fixed.
- **The 980px collapsed rail was styling `nav button` when the nav renders
  anchors.** Fixed.
- **Portal inner pages have no responsive work beyond the shared banner.** The
  home page carries essentially all the design and motion; the other nine tabs
  are a banner, a search box and a list. This is accurate and is the main body
  of work outstanding.
- **`rush-events > button` selectors were dead** across the events list, so
  those rows had no grid layout at all. Fixed earlier in this session.

Not yet audited systematically: the CMS editor screens, the media library, the
people screen, and the portal tabs at each breakpoint. I did not want to report
a defect count for work I had not actually done.

---

## 9. Recommended order

1. **Taxonomy table** (§7). Unblocks the admin control you asked for and removes
   three inconsistent models at once.
2. **Media department scoping** (A9) plus the avatar and attachment validation
   (A10, A11). One migration, one service.
3. **Entra endpoints** (L1) before you point this at your Azure tenant.
4. **Outbox locking and ticket references** (L2, L3) before more than one replica.
5. **Readiness decoupled from the outbox** (L4). One line, prevents an outage.
6. **Portal inner pages**: responsive and journey work, nine tabs.
7. **CMS screens**: editor, media, people at mobile widths.
8. **Shared `api-client`** into contracts (R3), and the UI calling `canAssignRole`
   instead of reimplementing it (R4).
9. Dead code sweep (§5) last, because it is the only section that cannot break
   anything.

---

## 10. Verification state

| Check | Result |
| --- | --- |
| API typecheck (`tsc --noEmit`) | Clean |
| Portal and CMS builds | Clean |
| ESLint, `--max-warnings=0` | Clean |
| API unit tests | 58 passing, up from 49 |
| Bootstrap wiring tests | 34, not re-run this pass |
| Prisma SQL execution | **Not verified.** Engine CDN blocked here. |
| `auth-rbac` e2e suite | **Not verified.** Needs a live database. |

The two unverified rows matter. Every authorization fix in §2 is covered by unit
tests against `ContentPolicy` in isolation, but the department-scoping fixes
change Prisma `where` clauses, and nothing in this environment executes SQL. Run
`pnpm test:e2e` against your local Postgres before deploying.
