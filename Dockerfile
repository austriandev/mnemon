# Two images from one workspace, built by docker-compose.yml (`scripts/app.sh up`):
#   web    the Next.js app as a standalone server: pages, server actions, the core
#   tools  the CLI: database migrations and seeding the demo meetings
# Secrets are never baked in: .env is excluded by .dockerignore and passed at run time.

ARG NODE_VERSION=24.22.1

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# The whole workspace with its dependencies. `pnpm fetch` reads only the lockfile, so
# editing source doesn't download the dependencies again.
FROM base AS source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile

FROM source AS build
RUN pnpm --filter @mnemon/web build

# Only the traced server files and static assets; no compiler, no source, no pnpm.
FROM node:${NODE_VERSION}-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# The CLI runs its TypeScript directly on Node, as it does outside the container.
FROM source AS tools
ENV NODE_ENV=production
USER node
CMD ["node", "packages/db/src/migrate-cli.ts"]
