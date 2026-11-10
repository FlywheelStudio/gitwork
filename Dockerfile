# syntax=docker/dockerfile:1
# Gitwork on any Node host: Next.js standalone server + a SQLite file on the /data volume.
# Build:  docker build -t gitwork .
# Run:    docker compose up -d   (see docker-compose.yml and docs/self-host/)

FROM node:22-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 GITWORK_STANDALONE=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gitwork/web build

FROM node:22-slim
ARG GITWORK_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/FlywheelStudio/gitwork" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${GITWORK_VERSION}"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    GITWORK_VERSION=${GITWORK_VERSION} \
    DATABASE_URL=file:/data/gitwork.sqlite \
    GITWORK_MIGRATIONS_DIR=/app/migrations \
    GITWORK_FAIL_ON_CONFIG_ERROR=1
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /src/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /src/packages/db/migrations ./migrations
COPY --from=build --chown=node:node /src/scripts/backup.mjs ./backup.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
