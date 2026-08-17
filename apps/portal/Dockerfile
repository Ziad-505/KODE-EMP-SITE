# syntax=docker/dockerfile:1.7
ARG APP=portal

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
ARG APP
ARG VITE_API_URL=/api/v1
ARG VITE_PORTAL_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/${APP} apps/${APP}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @kode/${APP}... --filter @kode/contracts
ENV VITE_API_URL=${VITE_API_URL} VITE_PORTAL_URL=${VITE_PORTAL_URL}
RUN pnpm --filter @kode/${APP} build

# Static files only. TLS, compression and routing are the proxy's job.
FROM nginx:1.27-alpine AS runtime
ARG APP
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
