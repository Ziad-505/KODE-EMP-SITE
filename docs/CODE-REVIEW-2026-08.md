# KODE employee portal: code review

**Date:** 16 August 2026
**Scope:** `apps/api`, `apps/admin`, `apps/portal`, `packages/contracts`, `infra`
**Method:** direct source reading, unit and bootstrap test execution, headless
Chromium rendering at 390 / 768 / 1024 / 1440. Prisma's engine CDN is blocked in
the review environment, so nothing below was verified against a live database
unless it says so.

---

## 1. Summary

**59 findings verified by reading the code**, of which **48 are now fixed and
installed**. Sections 3 to 7 keep the original audit list whole; each entry that
a later round closed is marked **RESOLVED** with the number that closed it, and
anything unmarked is still open.

**Four database migrations were written and executed against a real
PostgreSQL 16 instance**, not merely reasoned about, and all six migrations were
then replayed from scratch on an empty database to confirm they apply in order.
Each backfill was verified against deliberately messy seeded data, and the
failure scenario the audit described for ticket references was reproduced and
confirmed fixed.

| Area                                    | Critical | High | Medium | Low      |
| --------------------------------------- | -------- | ---- | ------ | -------- |
| Authorization and permissions           | 1        | 6    | 6      | 1        |
| Logic errors                            | 0        | 5    | 9      | 5        |
| Architecture                            | 0        | 1    | 5      | 1        |
| Capability foreclosed by the data model | 0        | 1    | 2      | 0        |
| Dead code                               | —        | —    | —      | 16 items |

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

## 2. Fixed

All installed. Typecheck clean, lint clean, both frontends building, **83
passing unit tests** (up from 49; 34 written specifically for these fixes).

### Round one: security and data loss

| #   | Severity     | What was wrong                                                                                                                                                                                                                             | File                                   |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 1   | **Critical** | Uploaded files served with `@Public()`. Any draft, department-scoped policy PDF was fetchable by anyone on the internet holding the URL, and those URLs are handed out in every DTO carrying `documentUrl`, `coverUrl` or `avatarUrl`.     | `api/src/media/media.controller.ts`    |
| 2   | **High**     | The same route registered at `/v1/media/...` while `MediaUrlService` advertised `/media/...` and Caddy proxied `/media/*` verbatim. Every cover image and document would have 404'd in production. Fixed with `@Version(VERSION_NEUTRAL)`. | `api/src/media/media.controller.ts`    |
| 3   | **High**     | `Cache-Control: public` on a now-authenticated response would let a shared cache serve one user's file to another. Changed to `private`.                                                                                                   | `api/src/media/media.controller.ts`    |
| 4   | **High**     | `assertCanWrite` tested `scope !== Department`, so `Scope.Own` fell through to unrestricted global write. An employee granted `news:update` could edit any department's content.                                                           | `api/src/content/content.policy.ts`    |
| 5   | **High**     | Same hole on the read side in `cmsVisibility`: that employee also saw every department's unpublished drafts.                                                                                                                               | `api/src/content/content.policy.ts`    |
| 6   | **High**     | `portalVisibility` applied the department filter only when the actor _had_ a department, so a new hire awaiting assignment saw strictly more than their assigned colleagues.                                                               | `api/src/content/content.policy.ts`    |
| 7   | **Medium**   | Search carried its own copy of the visibility fragment, including the same hole. Now calls `ContentPolicy.portalVisibility`.                                                                                                               | `api/src/content/search.service.ts`    |
| 8   | **High**     | Password reset had no rank check and returned the new password in the body. An actor with `user:update` could reset a Super Admin's password and read the value.                                                                           | `api/src/users/users.service.ts`       |
| 9   | **High**     | Account status was writable via `PATCH /cms/users/:id` with only `user:update`, bypassing `user:deactivate` entirely, with no rank check.                                                                                                  | `api/src/users/users.service.ts`       |
| 10  | **High**     | Role changes validated only the _target_ role, so a Content Manager could demote a Super Admin to Employee (a lower role is always assignable). Both ends are now checked.                                                                 | `api/src/users/users.service.ts`       |
| 11  | **High**     | Deactivating someone revoked refresh tokens but not the access token they already held, so a leaver stayed fully privileged for up to 15 minutes. Now a cached live account check bounds it to 15 seconds.                                 | `api/src/auth/jwt-auth.guard.ts`       |
| 12  | **High**     | The CMS dashboard embedded the audit trail behind only `cms:access`, handing every Department Editor lines like "Changed X to Super Admin" and "Reset the password for Y".                                                                 | `api/src/content/dashboard.service.ts` |
| 13  | **High**     | Deleting a department counted only users, articles and policies. Events, FAQs and albums are `SetNull`, so deleting a department that owned only those silently made restricted content org-wide.                                          | `api/src/users/departments.service.ts` |
| 14  | **High**     | **Data loss.** Saving a gallery album from the CMS forced `itemIds: []` onto the payload, and the API treats that as the complete desired set. Fixing a title typo detached every photo in the album, behind a success toast.              | `admin/src/routes/content-editor.tsx`  |

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

### Round two: logic, concurrency and capability

| #   | Severity   | What was wrong                                                                                                                                                                                                                                                                 | File                                                       |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 17  | **High**   | **Microsoft SSO had never worked.** `authority` used the issuer URL as the endpoint base, so authorize, token and JWKS all 404'd and every sign-in threw. Issuer and endpoints are now separate values.                                                                        | `api/src/auth/entra.service.ts`                            |
| 18  | **High**   | Ticket references were `count() + 1`. Cascade-deleting a departed employee lowered the count and the next submissions collided with existing references, leaving the employee unable to raise a ticket at all. Now a Postgres sequence.                                        | `api/src/support/support.service.ts` + migration           |
| 19  | **High**   | The outbox drained with no locking, so two API replicas sent every notification twice and opened two Odoo tickets per request. Now `FOR UPDATE SKIP LOCKED` with a two-minute lease.                                                                                           | `api/src/outbox/outbox.service.ts`                         |
| 20  | **High**   | Readiness returned `down` on a single dead-lettered email, so one unroutable inbox would pull every replica out of rotation permanently. Now reported, never fatal.                                                                                                            | `api/src/health/health.controller.ts`                      |
| 21  | **High**   | Refresh replay detection was a read followed by an unguarded write, so a stolen token replayed concurrently with a legitimate refresh went undetected. Now a conditional `updateMany` claim.                                                                                   | `api/src/auth/token.service.ts`                            |
| 22  | **High**   | The media library had no department scoping at all; a Department Editor could enumerate every document in the club. Media now carries a department, backfilled from the uploader.                                                                                              | `api/src/media/*` + migration                              |
| 23  | **High**   | **Event kinds were a Postgres enum.** Adding one meant a schema edit, a hand-written `ALTER TYPE`, a contracts rebuild and a coordinated redeploy of three artifacts. Now an admin-managed table with a CMS screen.                                                            | 25 files + migration                                       |
| 24  | **Medium** | Homepage statistics were the only content queries outside `ContentPolicy` and counted every department regardless of the reader, so the count disagreed with the list beside it.                                                                                               | `api/src/content/portal.controller.ts`                     |
| 25  | **Medium** | The upcoming-events count used `new Date()` while the list beside it used local midnight, so the page could say "2 upcoming" above three rows. Both now share one boundary.                                                                                                    | `api/src/content/events.service.ts`                        |
| 26  | **Medium** | The publishing strip labelled a local midnight with its UTC date, so at UTC+4 every bar was attributed to the previous day.                                                                                                                                                    | `api/src/content/dashboard.service.ts`                     |
| 27  | **Medium** | Articles recorded `PUBLISH` for any status change and events recorded `UPDATE` even for a real publish, so the audit trail could not answer "who published what". One shared helper now.                                                                                       | `articles.service.ts`, `events.service.ts`                 |
| 28  | **Medium** | `publishedAt` was caller-supplied and applied regardless of publish rights, letting an editor pin a story to the top of the list permanently.                                                                                                                                  | `api/src/content/articles.service.ts`                      |
| 29  | **Medium** | Avatars accepted any media id, so an employee could point their photo at a policy PDF, and a reused id surfaced as a 409 instead of a validation error.                                                                                                                        | `api/src/users/users.service.ts`                           |
| 30  | **Medium** | Ticket attachments were written with no ownership or existence check.                                                                                                                                                                                                          | `api/src/support/support.service.ts`                       |
| 31  | **Medium** | Three different upload limits existed: the env var, a hardcoded 15 MB in contracts, and a hardcoded 25 MB in the multer interceptor. Setting `MAX_UPLOAD_MB=25` gave a server that accepted 25 MB and a UI that refused at 15. Now one value, served from `GET /media/limits`. | contracts, `media.controller.ts`, `admin/routes/media.tsx` |
| 32  | **Medium** | `AUTH_RATE_LIMIT_MAX` was overridden by hardcoded literals on both routes that used it, so changing it had no effect.                                                                                                                                                          | `api/src/auth/auth.controller.ts`                          |
| 33  | **Low**    | A rejected event time and a rejected URL scheme both threw `NotFoundException`, so the CMS rendered "not found" for a record the user was looking at.                                                                                                                          | `events.service.ts`, `quick-links.service.ts`              |
| 34  | **Low**    | `updateEventSchema` used `.partial()` on the inner object, silently dropping the cross-field refine so the shared contract stopped rejecting an end time before the start.                                                                                                     | `packages/contracts/src/content.ts`                        |

### Round three: front end

| #   | What was wrong                                                                                                                                                                                         | Evidence                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 35  | The inner pages carried up to **120px of dead vertical space** between the banner and the first row, because the toolbar and the grid each had their own generous top margin.                          | One rhythm scale now, applied once                  |
| 36  | Every interactive control on the portal was **below the 36px minimum tap size** at 390px: footer links at 18px, inline links at 11px, the brand at 27px, search at 31px, header controls at 34px.      | Measured sweep: 6 categories before, **zero after** |
| 37  | The page title ran under a 100px gold band in the banner at 1440px, because the decorative ring had no z-index and painted over the heading.                                                           | Type raised above the ring                          |
| 38  | The scroll reveal defaulted to `opacity: 0`, so any failure of `IntersectionObserver` — an old WebView, printing — would hide the page's content permanently rather than merely skipping an animation. | Failsafe reveal plus a print rule                   |

### Round four: the remaining taxonomies and logic errors

| #     | Severity   | What was wrong                                                                                                                                                                                                                                                                                                                                                                                                | File                                    |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 39    | **High**   | The same domain concept was modelled **three different ways**: `EventKind` and `TicketCategory` were Postgres enums, `Article.category` and `Faq.category` were unconstrained free text with hardcoded defaults. None was manageable at runtime; the free-text pair additionally let "Club Life", "club life" and "CLUB LIFE" exist as three separate facets with no rename path. All four are now one table. | schema + migration + 14 files           |
| 40    | **Medium** | Slug generation loaded **every slug in the table** into memory on each create and ignored soft-deleted rows, which still own their slug at the unique index. Now prefix-scoped.                                                                                                                                                                                                                               | four services                           |
| 41    | **Medium** | The gallery update called `nextSlug` from inside an interactive transaction, so it held one connection while waiting for a second. Ten concurrent album edits exhausted the pool. Resolved before the transaction opens.                                                                                                                                                                                      | `gallery.service.ts`                    |
| 42    | **Medium** | `departmentId` was accepted and silently discarded by the FAQ and gallery public lists while the other three honoured it, so the filter returned 200 and did nothing.                                                                                                                                                                                                                                         | `faqs.service.ts`, `gallery.service.ts` |
| 43–48 | Low        | Dead code removed: `QUICK_LINK_PERMISSION`, `dueForReview`, `extensionFor`, `mail.verify`, `sortOrderSchema`, `ALL_TICKET_STATUSES`.                                                                                                                                                                                                                                                                          | various                                 |

**On the ticket email.** The notification now prints the category **key** with
the label in brackets, not the label alone. IT's Odoo rules parse that line, and
an admin renaming "Access" to "Access and logins" must not silently break
routing. That is the one place a rename is deliberately not allowed to matter.

### Round five: pre-rollout review, 14 September 2026

A review of round four before handing the repository over. Thirteen findings,
all fixed; seven unit tests added.

| #     | Severity    | What was wrong                                                                                                                                                                                                                                                         | File                                  |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 49    | **Blocker** | The migration created `articles_categoryId_idx`, `faqs_categoryId_idx` and `support_tickets_categoryId_idx`, but no model declared `@@index([categoryId])`. CI runs `prisma migrate diff --exit-code` precisely to catch that, so the branch could not go green.       | `prisma/schema.prisma`                |
| 50    | **Blocker** | Seven build archives and a stray lockfile were tracked under `_to_delete/` — most of the repository's object size. Untracked and ignored, along with the 87 MB `prototype/` copy.                                                                                      | `.gitignore`                          |
| 51    | **Blocker** | Two `vercel.json` files rewrote to a literal `REPLACE-WITH-API-HOST`, were undocumented, and omitted the HSTS and `X-Frame-Options` the Caddyfile sends. Removed: Docker behind Caddy is the one supported path.                                                       | `apps/*/vercel.json`                  |
| 52    | **High**    | `assertUsable` ran on create and never on update, in all four namespaces. The foreign key cannot tell a news category from a ticket category, so a story could be filed under "Hardware" — and a term archived so it could not be chosen was still applicable on edit. | `articles`, `faqs`, `events` services |
| 53    | **Medium**  | Ticket creation called `assertUsable` on `this.prisma` from inside its own interactive transaction — the same connection-starvation shape round four had just fixed in the gallery.                                                                                    | `support.service.ts`                  |
| 54    | **Medium**  | The new-draft effect depended on three taxonomy ids that arrive asynchronously, so a late response re-ran the seed and replaced everything already typed. Seeded once now, with the default term filled separately while the field is empty.                           | `admin/routes/content-editor.tsx`     |
| 55    | **Medium**  | The support form's comment described a disabled submit that was never written, and the category field was the one field with no error slot — so a slow taxonomy load produced a button that silently did nothing.                                                      | `portal/routes/support.tsx`           |
| 56    | **Medium**  | A term rename invalidated only `['cms','events']`, but all four namespaces now embed the label. Renaming a news category left the old name on screen until reload.                                                                                                     | `admin/lib/cms-api.ts`                |
| 57    | **Low**     | The migration's fallback assigned a literal `tax_art_default` id that on any real database does not exist, because the fold has already created `CLUB_LIFE` under a generated id. Resolved by `(kind, key)` in all three blocks.                                       | migration `20260816030000`            |
| 58–61 | **Low**     | Ticket search did not reach the category label the way news and FAQ search do; two comments contradicted the code beneath them; sections 3 and 4 listed as open a dozen items section 2 records as fixed; the three new schema fields were not `prisma format`-ed.     | various                               |

**62 — blocker — found while verifying 49 against a real database.** Fixing the
`categoryId` indexes made the drift check reach a second, older disagreement:
six GIN trigram indexes created by migration `20260815000100` and never declared
in the datamodel. `prisma migrate diff` read all six as indexes to drop, so the
`integration` job **has never passed on any branch** — this is not a regression
introduced by the taxonomy work, it has been failing since the second migration.
They are now declared with `type: Gin`, `ops: raw("gin_trgm_ops")` and a `map`
pinning the name the migration already used. `prisma migrate diff --exit-code`
now reports **"No difference detected", exit 0**, for the first time.

Note that Prisma silently ignores the expression index
(`users_name_trgm_idx`, on `"firstName" || ' ' || "lastName"`) and the two
partial indexes (`articles_live_idx`, `events_live_idx`), so those never
appeared as drift and need no declaration.

**On editing a migration.** `20260816030000_remaining_taxonomies` was amended
rather than superseded, which the usual rule forbids. It is safe here and only
here: the migration had never been committed and has never been applied to any
KODE database. Once it has run anywhere, the rule applies again — write a new
one.

**Measured, not eyeballed.** A sweep across all ten portal routes at 390, 768,
1024 and 1440 checks for horizontal overflow and undersized tap targets. The
result is **zero horizontal overflow on every route at every width**, before and
after. The portal's problem was never that it failed to reflow; it was that the
inner pages had none of the home page's design language. That is what the new
inner-page layer addresses: the ink rule and skew-bullet result counts on the
toolbar, department stripes and hard offset shadows on cards, oversized index
numerals in lists.

---

## 3. Authorization

This is the original audit list, kept whole so the trail from finding to fix
stays readable. Entries fixed in a later round are marked **RESOLVED** with the
round-two number that closed them; anything not so marked is still open.

**A9 — high — RESOLVED (#22) — `api/src/media/media.service.ts:129`, `:167`**
The media library has no department scoping at all; the `where` clause contains
only `deletedAt`, `q` and `kind`. A Department Editor in Sports can enumerate
every document in the club. Fixing this properly needs a `departmentId` column
on `Media` and a migration, which is why it is not in the fixed list.

**A10 — medium — RESOLVED (#29) — `api/src/users/users.service.ts:244`**
`avatarMediaId` is written with no check that the media exists, is an image, or
relates to the caller. Any employee can point their avatar at a policy PDF. The
column is `@unique`, so pointing at another user's avatar raises P2002 and
surfaces as a 409 from a request that should have been a 422.

**A11 — medium — RESOLVED (#30) — `api/src/support/support.service.ts:70`**
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

**L1 — high — RESOLVED (#17) — `api/src/auth/entra.service.ts:61`**
`authority` is `https://login.microsoftonline.com/{tid}/v2.0`, which is the
correct _issuer_ but the wrong _base for endpoints_. Authorize and token live
under `/{tid}/oauth2/v2.0/`, JWKS under `/{tid}/discovery/v2.0/keys`. With
`ENTRA_ENABLED=true`, every SSO attempt fails. **SSO has never worked against a
real tenant.** This matters before you point it at your Azure directory.

**L2 — high — RESOLVED (#18) — `api/src/support/support.service.ts:191`**
Ticket references are `count() + 1`. `requesterId` is `onDelete: Cascade`, so
hard-deleting a departed employee drops the count and the next submissions
collide with existing references. The employee simply cannot raise a ticket.
Use a Postgres sequence.

**L3 — high — RESOLVED (#19) — `api/src/outbox/outbox.service.ts:53`**
`drain()` has no `FOR UPDATE SKIP LOCKED` and no lease; the `draining` flag is
per-process. With two API replicas, IT gets two identical emails and Odoo gets
two tickets for one request.

**L4 — high — RESOLVED (#20) — `api/src/health/health.controller.ts:45`**
Readiness reports `down` whenever one message has exhausted its delivery
attempts. One ticket email to a temporarily unroutable inbox dead-letters at
02:00 and the load balancer pulls every replica out of rotation permanently. A
non-critical email should not be able to take the portal offline.

**L5 — medium — RESOLVED (#21) — `api/src/auth/token.service.ts:87`**
Refresh replay detection is a read followed by an unguarded write. Two
simultaneous uses of the same token both pass, and the theft is never detected.
Needs `updateMany({where: {id, rotatedAt: null}})` with a count check.

**L6 — medium — RESOLVED (#41) — `api/src/content/gallery.service.ts:172`**
`nextSlug` runs a `findMany` on a different connection from inside an open
interactive transaction. With `DATABASE_POOL_SIZE=10` and ten concurrent album
edits, every connection is held by a transaction waiting for an eleventh.

**L7 — medium — RESOLVED (#40) — slug generation, four services**
Every slug in the table is loaded into memory per create, unfiltered by
`deletedAt`, and check-then-insert is not atomic. Two editors publishing "Club
news" simultaneously both compute `club-news-2` and the second gets a 409.
Soft-deleted rows also permanently occupy their slug with no visible reason.

**L8 — medium — RESOLVED (#26) — `api/src/content/dashboard.service.ts:127`**
`toISOString().slice(0,10)` labels a _local_ midnight with its _UTC_ date. At
UTC+4 every bar in the seven-day publishing strip is attributed to the previous
day.

**L9 — medium — RESOLVED (#25) — `api/src/content/events.service.ts:295`**
Upcoming events use local midnight while the count beside them uses `new Date()`,
so the homepage renders "2 upcoming events" above a list of three.

**L10 — medium — RESOLVED (#27) — audit action inconsistency**
Articles record `PUBLISH` for _any_ status change; events record `UPDATE` even
for a genuine publish. `GET /audit?action=PUBLISH` therefore returns things that
were never published and misses things that were. The audit trail cannot answer
"who published what". (`articles.service.ts:206`, `events.service.ts:203`.)

**L11 — low — RESOLVED (#33) — `api/src/content/events.service.ts:180`**
A failed start/end-time comparison throws `NotFoundException`, so the UI treats
a validation failure as a missing record. Same in `quick-links.service.ts:122`.

**L12 — low — RESOLVED (#34) — `packages/contracts/src/content.ts:81`**
`updateEventSchema = createEventSchema.innerType().partial()` strips the
cross-field `.refine`, so the contract both frontends import no longer rejects
`endsAt < startsAt` on edit.

**L13 — low — RESOLVED (#28) — `api/src/content/articles.service.ts:196`**
`publishedAt` is caller-supplied and applied regardless of publish rights. An
editor who cannot publish can set it to 2030 and pin the story to the top of the
list forever.

**L14 — low — `api/src/auth/token.service.ts:156`**
Revoked tokens are hard-deleted after 24 hours, which also deletes the evidence
replay detection depends on. A token replayed at 25 hours produces no warning.

**L15 — low — RESOLVED (#42) — `faqs.service.ts:40`, `gallery.service.ts:59`**
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

**Resolved.** All four now share one model. Kept here for the record of what
was wrong:

| Concept          | Was                            | Now             |
| ---------------- | ------------------------------ | --------------- |
| Event kind       | Postgres enum `EventKind`      | `taxonomies` FK |
| Ticket category  | Postgres enum `TicketCategory` | `taxonomies` FK |
| Article category | Free-text, default "Club life" | `taxonomies` FK |
| FAQ category     | Free-text, default "Workplace" | `taxonomies` FK |

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

| Check                                     | Result                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| API typecheck (`tsc --noEmit`)            | Clean                                                                     |
| Portal and CMS builds                     | Clean                                                                     |
| ESLint, `--max-warnings=0`                | Clean                                                                     |
| API unit tests                            | **83 passing**, up from 49                                                |
| Migrations executed against PostgreSQL 16 | **Yes**, all four new ones; all six replayed clean on an empty database   |
| Migrations replayed on PostgreSQL 17.6    | **Yes**, 15 Sep. All six applied in order to an empty database.           |
| `prisma migrate diff --exit-code`         | **"No difference detected", exit 0.** First time it has passed.           |
| `auth-rbac` e2e suite                     | **20 passing** against a live PostgreSQL 17.6, 15 Sep                     |
| Responsive sweep, 10 routes × 4 widths    | **Zero** horizontal overflow, **zero** tap targets under 36px             |
| Bootstrap wiring tests                    | **34 passing**, re-run 15 Sep                                             |
| Prisma runtime SQL                        | **Verified 15 Sep.** Composed `where` clauses executed against a real DB. |
| `auth-rbac` e2e suite (16 Aug pass)       | Not verified then. **Run and passing as of 15 Sep** — see above.          |

### What the migrations proved

Run directly in psql against a seeded database, not asserted:

- Every existing event kept its exact event kind through the enum-to-table
  migration.
- A new kind can be created and used at runtime with no migration.
- Deleting a term still referenced by events is refused by the foreign key.
- A duplicate key within a namespace is refused; the same key in a different
  namespace is allowed.
- The ticket-reference sequence continues past the highest existing reference,
  and **keeps advancing after a cascade delete removes every ticket** — the
  precise scenario that previously locked an employee out of raising one.
- Media rows backfill their department from the uploader.
- Free-text categories fold case-insensitively: "Club life", "club life" and
  "Club Life" converge on one term, and the label tiebreak prefers sentence case
  over an all-caps or all-lower spelling.
- After all six migrations, **no enum type remains** for any category concept,
  and all four columns (`events.kindId`, `articles.categoryId`,
  `faqs.categoryId`, `support_tickets.categoryId`) are foreign keys to
  `taxonomies`.

### The two rows that still say "not verified"

Every authorization fix is covered by unit tests against `ContentPolicy` in
isolation, and the schema-level guarantees are covered by the psql runs above.
What is still untested is Prisma actually executing the composed `where` clauses
at runtime, because the query engine cannot be downloaded in this environment.

**Update, 15 September 2026.** This was done. The full migration chain applied
to an empty PostgreSQL 17.6, the drift check passed for the first time (see
finding 62), the seed installed all four taxonomy namespaces, and the
`auth-rbac` suite passed 20/20 against that live database. Three fixes were also
confirmed end to end rather than by reasoning: usage counts read the right table
per namespace, the portal support form loads its five categories from the API,
and a PATCH putting a ticket-category id on a news story is refused with 400.

**Still to do on PostgreSQL 16 specifically.** Everything above ran on 17.6,
which is what was available. The backfill has still never met a copy of real
`articles.category` data — an empty database exercises the schema changes but
not the fold that collapses "Club Life" and "club life" onto one term. Do that
against a restored production copy before go-live.
