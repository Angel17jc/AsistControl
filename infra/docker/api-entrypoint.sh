#!/bin/sh
set -eu

cd /app/apps/api

echo "[entrypoint] applying database migrations"
npx --no-install prisma migrate deploy

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data (idempotent)"
  node dist-seed/seed.js
fi

echo "[entrypoint] starting API"
exec node dist/main.js
