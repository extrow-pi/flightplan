# Flightplan: one container running the API, which also serves the built web app.
# Build:  docker build -t flightplan .
# Run:    docker run -p 3001:3001 --env-file apps/api/.env -v flightplan-data:/data flightplan

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app
# Workspace manifests first, so dependency installs are cached until they change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Build the web app (needs dev dependencies: Vite, Tailwind…)
FROM base AS web-build
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @flightplan/web build

# Runtime: API production dependencies only, plus the built web app
FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter "@flightplan/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=web-build /app/apps/web/dist apps/web/dist

# Persistent data lives on a mounted volume at /data
ENV PORT=3001 \
    UPLOADS_DIR=/data/uploads \
    PGLITE_DIR=/data/pglite
VOLUME /data
EXPOSE 3001

WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/index.ts"]
