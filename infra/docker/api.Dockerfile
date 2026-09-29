# syntax=docker/dockerfile:1.7
# Multi-stage build: dev dependencies and sources never reach the runtime image.

FROM node:22-alpine AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

# ── Manifests only: this layer is cached until a package.json or the lockfile changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/biometric-core/package.json packages/biometric-core/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma

FROM manifests AS build
RUN npm ci -w @asistcontrol/shared -w @asistcontrol/biometric-core -w @asistcontrol/api --include-workspace-root
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @asistcontrol/shared \
 && npm run build -w @asistcontrol/biometric-core \
 && npm run build -w @asistcontrol/api \
 && npx tsc apps/api/prisma/seed.ts --outDir apps/api/dist-seed --module commonjs --target es2022 \
      --esModuleInterop --skipLibCheck

# ── One-shot job: applies migrations and, in demo setups, seeds (ADR 0013). It is the only
# image with the Prisma CLI. Build with `--target migrator`.
FROM manifests AS migrator
ENV NODE_ENV=production
COPY --chmod=755 infra/docker/prune-node-modules.sh /usr/local/bin/prune-node-modules.sh
RUN npm ci --omit=dev -w @asistcontrol/shared -w @asistcontrol/biometric-core -w @asistcontrol/api \
 && prune-node-modules.sh
COPY --from=build /app/apps/api/dist-seed apps/api/dist-seed
COPY --chmod=755 infra/docker/migrate-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh
USER node
ENTRYPOINT ["migrate-entrypoint.sh"]

# ── The API (default target). No Prisma CLI, so it cannot migrate: the migrator does, first.
# runtime-lockfile.mjs removes the CLI (an optional peer of @prisma/client that npm would
# otherwise keep) from this image's lockfile, so `npm ci` leaves it and everything only it
# needs out. typescript cannot go the same way: dev tools in the lockfile require it.
# Install scripts are skipped: the API's would run `prisma generate` without the CLI, so the
# client generated in the build stage is copied instead; argon2 ships prebuilt binaries.
# infra/docker/smoke-test.sh proves both images work, including a real login.
FROM manifests AS runtime
ENV NODE_ENV=production
COPY --chmod=755 infra/docker/prune-node-modules.sh /usr/local/bin/prune-node-modules.sh
COPY infra/docker/runtime-lockfile.mjs /tmp/runtime-lockfile.mjs
RUN node /tmp/runtime-lockfile.mjs prisma \
 && npm ci --omit=dev --ignore-scripts -w @asistcontrol/shared -w @asistcontrol/biometric-core -w @asistcontrol/api \
 && prune-node-modules.sh \
 && rm /tmp/runtime-lockfile.mjs
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/biometric-core/dist packages/biometric-core/dist
COPY --from=build /app/apps/api/dist apps/api/dist

USER node
WORKDIR /app/apps/api
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
