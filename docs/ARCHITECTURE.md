# Architecture decisions

Short records of the choices that would otherwise be re-litigated in six months.

---

## ADR-0001: NestJS over Express and Fastify

**Status:** accepted

**Context.** The brief called for authentication, authorization, clean
architecture and long-term maintainability by a team whose existing experience
is Express and NestJS.

**Decision.** NestJS with the Express adapter.

**Why not Fastify.** Roughly 2–3× the request throughput, which for a few
hundred employees is worth nothing. It optimises the wrong variable.

**Why not bare Express.** The brief is mostly authorization. Express supplies no
structure for it, so we would hand-roll a guard layer — less well than the one
Nest ships, and with a new chance to forget it on every new route.

**Why Nest.** The domain has obvious module boundaries (auth, users, content,
media, support, audit) that map one-to-one onto Nest modules. More importantly,
guards and decorators make authorization declarative and centrally enforced:
`@RequirePermissions(...)` on a handler cannot be silently skipped the way a
hand-written middleware call can.

**Cost accepted.** Decorator indirection and more boilerplate than a minimal
framework.

---

## ADR-0002: Prisma over TypeORM and Drizzle

**Status:** accepted

**Context.** PostgreSQL, TypeScript strict mode, and a schema that will change.

**Decision.** Prisma 6.

**Why not TypeORM.** It is what the Nest docs use and entities feel more native,
but its type inference is materially weaker and its migration story has a long
history of production pain.

**Why not Drizzle.** Excellent types and very light, but a smaller ecosystem and
fewer people on the team will have used it.

**Why Prisma.** The strongest type inference of the three — `include` and
`select` flow into result types, so a DTO mapper cannot silently read a field
that was not fetched. Migrations are plain reviewable SQL files.

**Cost accepted.** A separate schema language rather than TypeScript classes, and
a native query engine binary in the container image (hence `openssl` in the
runtime stage).

---

## ADR-0003: Cookie sessions rather than bearer tokens in localStorage

**Status:** accepted

**Context.** Two SPAs need authenticated access to one API.

**Decision.** Short-lived JWT access tokens and rotating refresh tokens, both in
`httpOnly` cookies, plus a double-submit CSRF token.

**Alternative rejected.** A bearer token in `localStorage`. It is simpler and
avoids CSRF entirely, but any XSS anywhere in either application becomes total
session compromise, with no mitigation available afterwards.

**Reasoning.** XSS is the more likely bug in an application with a CMS and
user-authored content. CSRF has a well-understood, complete mitigation
(SameSite plus double-submit); XSS token theft does not. We chose the risk we
can fully mitigate.

**Consequence.** Serving the SPA and the API from the same origin in production
lets the cookie stay `SameSite=Lax`, which is why Caddy routes `/api/*` under
each front-end domain rather than using a separate `api.` subdomain.

---

## ADR-0004: A shared contracts package, with Zod as the single source of truth

**Status:** accepted

**Context.** Three TypeScript packages must agree on request shapes, response
shapes and — critically — the permission model.

**Decision.** `@kode/contracts` exports Zod schemas, inferred types, enums and
the role/permission map. The API validates with a small Zod pipe rather than
`class-validator`.

**Reasoning.** `class-validator` is the Nest default, but it produces DTOs that
cannot be shared with a browser bundle without dragging decorators and
`reflect-metadata` along. With Zod, the same schema validates the CMS form and
the endpoint that receives it, so a constraint cannot drift between them.

Sharing the permission map matters more than the schemas. It means the CMS
cannot disagree with the server about who may publish, because both read the
same object.

**Cost accepted.** A hand-written `ZodValidationPipe` (about 30 lines) instead of
the framework default, and OpenAPI schemas that are less automatic than with
`@nestjs/swagger` decorators.

---

## ADR-0005: A transactional outbox for support notifications

**Status:** accepted

**Context.** Raising an IT ticket must both persist the ticket and email the IT
inbox that opens the Odoo ticket.

**Decision.** The ticket row and an `outbox_messages` row commit in the same
database transaction. A background worker drains the outbox with exponential
backoff.

**Alternative rejected.** Sending the email inline after the insert. That has two
failure modes with no good answer: the process dies between commit and send, and
the ticket exists with nobody notified; or the send succeeds and the transaction
rolls back, and IT chases a ticket that does not exist.

**Cost accepted.** One extra table, a polling worker, and delivery that is
at-least-once rather than exactly-once. Duplicate emails are a far better
failure than lost ones.

---

## ADR-0006: Soft deletes for content, hard append-only for audit

**Status:** accepted

**Decision.** Content carries `deletedAt` and is never physically removed. The
audit log is append-only, enforced by a database trigger.

**Reasoning.** A deletion is exactly the moment an audit trail matters most. If
the row is gone, the audit entry points at nothing. Soft deletes keep the
reference intact and make recovery from a mistake a one-field update.

The trigger exists because an application-layer promise not to delete is only a
promise. It stops a stray migration, a careless `psql` session, or a compromised
API process from rewriting history.

**Cost accepted.** Every content query carries `deletedAt: null`, and pruning old
audit rows becomes a deliberate DBA action with the trigger temporarily
disabled — which is the correct amount of friction.

---

## ADR-0007: No GSAP; scroll animation in CSS

**Status:** accepted

**Context.** The original draft used GSAP with ScrollTrigger for one pinned
section, at roughly half the portal's JavaScript payload.

**Decision.** The panel is pinned with `position: sticky` and every moving part
is a CSS transform reading one `--progress` custom property that a
rAF-throttled scroll listener writes.

**Reasoning.** The visual result is identical. Sticky became usable once the
ancestor `overflow: hidden` that was breaking it was removed — the same bug that
was silently breaking every other sticky element on the page. Under reduced
motion the listener never attaches and everything renders in its resting state,
which is simpler than GSAP's opt-out.

**Cost accepted.** The effect is harder to retune than a GSAP timeline. If the
design later needs genuinely complex choreography, reintroducing GSAP for that
section alone is a reasonable reversal.

---

## ADR-0008: No package manager in the runtime container

**Status:** accepted

**Context.** The API image is built with `pnpm --prod deploy`, which produces an
already-resolved `node_modules`. The container then invoked `pnpm exec prisma`
to apply migrations before starting.

**What went wrong.** The deployed `package.json` carries no `packageManager`
field, so corepack resolved `pnpm` to whatever was newest and fetched it at
container start. That version runs a dependency-status check before `exec`,
concluded the deployed tree needed reinstalling, tried to purge `node_modules`,
and aborted because a container has no TTY to confirm against. The API then
crash-looped.

**Decision.** The runtime image contains no corepack and no pnpm. Binaries are
invoked directly from `node_modules/.bin`, and `CI=true` is set as a second
guard against anything that still reaches for a prompt.

**Reasoning.** A package manager in a runtime image has nothing useful to do:
dependencies are already installed and must not change. Its only effects are a
network fetch on start, a version that drifts with upstream releases, and
behaviour that assumes an interactive terminal. Removing it makes container
start deterministic and offline.

**Consequence.** Documented commands use `./node_modules/.bin/prisma` and
`./node_modules/.bin/tsx` rather than `pnpm exec`. `prisma` and `tsx` are
runtime `dependencies` of `@kode/api` for the same reason (see ADR-0002's
consequence about migrations being applied inside the container).
