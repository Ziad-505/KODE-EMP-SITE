# KODE Sports Club — employee portal and CMS

A production-ready intranet for KODE Sports Club: an employee portal, a separate
content management system, and one API behind both.

| Surface          | What it is                                                                                           | Local URL                      |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Portal**       | The employee-facing site: news, events, policies, FAQs, gallery, directory, useful links, IT support | http://localhost:5173          |
| **CMS**          | A separate admin application with role-based access control                                          | http://localhost:5174          |
| **API**          | NestJS + Prisma + PostgreSQL                                                                         | http://localhost:4000          |
| **API docs**     | OpenAPI / Swagger UI (development only)                                                              | http://localhost:4000/api/docs |
| **Mail catcher** | Every outbound email during development                                                              | http://localhost:8025          |

---

## Run it

You need Docker, Node 22 and pnpm 9. Nothing else.

```bash
pnpm install
make dev
```

`make dev` starts PostgreSQL, Mailpit and the API in Docker (applying migrations
on the way up), then runs both frontends on the host with hot reload. First run
takes a couple of minutes for the image build.

Then load the demo data:

```bash
make seed
```

On Windows without `make`, run `.\setup.ps1` instead; it does the same work.

**Extract the project outside OneDrive.** `node_modules` is hundreds of
megabytes of small files, and syncing it makes installs slow and occasionally
corrupt.

A step-by-step script for verifying that the permission model, audit trail,
upload checks and session handling actually behave as described is in
[docs/TESTING.md](docs/TESTING.md).

### Sign in

The seed creates one account per role. In development they all share the
password **`KodeClub!2026demo`**.

| Email                           | Role              | What it demonstrates                                               |
| ------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `admin@kodesportsclub.com`      | Super Admin       | Everything, including People, System access and the activity trail |
| `marketing@kodesportsclub.com`  | Content Manager   | Full content control including publishing                          |
| `editor@kodesportsclub.com`     | Content Editor    | Can write and submit for review, but the publish option is locked  |
| `operations@kodesportsclub.com` | Department Editor | Only sees and edits Operations content                             |
| `employee@kodesportsclub.com`   | Employee          | Portal only; the CMS refuses them with an explanation              |

Sign in to the CMS as the editor and then the manager to see the permission
model working: the same screen offers different actions, and the API rejects the
request even if you get past the UI.

### Without Docker

```bash
# A PostgreSQL 16 database you control
createdb kode_portal
cp apps/api/.env.example apps/api/.env   # then edit DATABASE_URL for your port

pnpm --filter @kode/contracts build
pnpm --filter @kode/api db:deploy
pnpm --filter @kode/api db:seed
pnpm --parallel --filter @kode/api --filter @kode/portal --filter @kode/admin dev
```

---

## Deploy it

```bash
cp .env.example .env      # fill in every value
docker compose up -d --build
docker compose exec api ./node_modules/.bin/prisma migrate deploy
docker compose exec api ./node_modules/.bin/tsx prisma/seed.ts   # first run only
```

Point `PORTAL_DOMAIN` and `ADMIN_DOMAIN` at the server's IP **before** starting;
Caddy obtains and renews TLS certificates automatically on first request. The
only published ports are 80 and 443. PostgreSQL and the API sit on an internal
Docker network and are not reachable from the internet.

Operational procedures, including restores, are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

---

## Architecture

```
                    ┌──────────── Caddy ────────────┐   TLS, HSTS, HTTP/3
                    │  portal.<domain>  cms.<domain> │
                    └───────┬───────────────┬────────┘
                            │               │
              ┌─────────────▼──┐   ┌────────▼────────┐
              │ portal (nginx) │   │  admin (nginx)  │   static SPA bundles
              └─────────────┬──┘   └────────┬────────┘
                            │  /api/*, /media/*
                    ┌───────▼───────────────▼────────┐
                    │        API (NestJS)            │
                    │  guards → services → Prisma    │
                    └───────────────┬────────────────┘
                                    │
                            ┌───────▼────────┐
                            │  PostgreSQL 16 │
                            └────────────────┘
```

```
apps/
  api/        NestJS 11, Prisma 6, PostgreSQL. Auth, RBAC, content, media, support, audit
  portal/     React 19 + Vite. The employee-facing site
  admin/      React 19 + Vite. The CMS, a separate application with its own design
packages/
  contracts/  Zod schemas, DTO types and the permission model, shared by all three
infra/        Caddy, nginx and the backup job
docs/         Runbook, security notes and architecture decisions
```

### Why a shared `contracts` package

Validation rules, DTO shapes and — most importantly — the role/permission map
live in one place that the API and both frontends import. A field constraint
cannot drift between a form and the endpoint that receives it, and the CMS
cannot disagree with the server about who may publish, because both read the
same `ROLE_PERMISSIONS` object.

---

## Security

The full set of decisions is in [docs/SECURITY.md](docs/SECURITY.md). The short
version:

**Authentication.** Microsoft Entra ID (OIDC authorization-code flow with PKCE
and a server-side nonce) plus local accounts using Argon2id. Sessions are short-
lived JWTs in `httpOnly` cookies, so there is no token for XSS to steal. Refresh
tokens rotate on every use, and replaying a spent one revokes the entire session
family — the standard detection for a stolen token.

**Authorization.** Every route denies by default; a route is reachable only if it
carries an explicit annotation. Guards check _permissions_, never role names, so
a new endpoint cannot silently inherit the wrong rule. Row-level department
scope is enforced in the service layer, where the row is available. Publishing is
a distinct permission from editing, which is what makes the review step real.
Changing someone's role, department or status revokes their refresh tokens
immediately, so a removed privilege does not linger on an unexpired token.

**Uploads.** Storage keys are generated server-side, so a `../` in a filename is
structurally impossible rather than merely sanitised. Every file's leading bytes
are checked against its declared MIME type and mismatches are rejected. SVG is
refused outright because it can carry script. Files are served with
`X-Content-Type-Options: nosniff`, a sandboxing CSP, and a download disposition
for anything that is not an image.

**Everything else.** CSRF double-submit tokens on state-changing requests,
per-route rate limiting with a tighter bucket on sign-in, account lockout after
repeated failures, Helmet, strict CORS with an explicit origin allow-list,
Zod validation on every input, an append-only audit trail enforced by database
triggers rather than by convention, and a transactional outbox so a support
ticket and its notification email commit or fail together.

---

## Development

```bash
make help          # every available target
make check         # typecheck, lint and unit tests — what CI runs
make test          # unit tests
make psql          # a shell on the development database
make logs          # tail the API
make reset         # drop, recreate, migrate and seed
```

### Database changes

```bash
# 1. edit apps/api/prisma/schema.prisma
pnpm --filter @kode/api db:migrate --name describe_the_change
# 2. commit the generated SQL in apps/api/prisma/migrations/
```

Never edit an applied migration. Write a new one.

---

## What is deliberately not here

- **HR workflows.** They stay in Odoo. No role in this system grants HR access,
  and that is a design decision rather than an omission.
- **Public access.** Both applications are behind authentication end to end.
  `robots` is set to `noindex` and there is no anonymous read path.
- **A rich text editor.** Content is stored and rendered as plain text with
  paragraph breaks, and rendered as React children rather than injected as HTML.
  Adding a WYSIWYG editor means adding HTML sanitisation on the server; that is a
  deliberate next step, not an oversight.
