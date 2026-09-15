# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------- base
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# ---------------------------------------------------------------- deps
# Only the manifests are copied first, so a source change does not invalidate
# the dependency layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @kode/api... --filter @kode/contracts

# --------------------------------------------------------------- build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @kode/contracts build \
 && pnpm --filter @kode/api exec prisma generate \
 && pnpm --filter @kode/api exec nest build

# Prune to production dependencies for the runtime image.
#
# `cp -rT` (never treat the destination as a parent) rather than plain `cp -r`:
# `pnpm deploy` already copies dist/ and prisma/ across, so the destinations
# exist and plain `cp -r` nested each inside itself as dist/dist and
# prisma/prisma. The image still ran, which is why it went unnoticed, but it
# carried a full duplicate of the build.
RUN pnpm --filter @kode/api --prod deploy /tmp/api-runtime \
 && cp -rT apps/api/dist /tmp/api-runtime/dist \
 && cp -rT apps/api/prisma /tmp/api-runtime/prisma

# ------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime
# CI=true stops any tool that does reach for a prompt from blocking on a TTY
# the container does not have.
ENV NODE_ENV=production \
    CI=true \
    PATH=/app/node_modules/.bin:$PATH
# openssl is required by the Prisma query engine; tini gives us correct signal
# handling so SIGTERM reaches Node and Nest's shutdown hooks actually run.
#
# Deliberately no corepack or pnpm here. The runtime image contains an already
# resolved node_modules, so a package manager has nothing useful to do; invoking
# `pnpm exec` made corepack fetch whatever pnpm was newest, which then ran a
# dependency-status check, decided the deployed tree needed reinstalling, and
# died asking for a TTY. Binaries are called directly from node_modules/.bin.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /tmp/api-runtime ./
# Regenerate the client against this image's platform/OpenSSL combination.
RUN ./node_modules/.bin/prisma generate

# Run unprivileged. The storage volume is owned by the same uid.
RUN mkdir -p /app/storage/uploads && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
