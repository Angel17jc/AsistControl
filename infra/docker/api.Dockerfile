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

FROM manifests AS runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev -w @asistcontrol/shared -w @asistcontrol/biometric-core -w @asistcontrol/api \
 && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/biometric-core/dist packages/biometric-core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/dist-seed apps/api/dist-seed
COPY --chmod=755 infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh

USER node
EXPOSE 3000
ENTRYPOINT ["api-entrypoint.sh"]
