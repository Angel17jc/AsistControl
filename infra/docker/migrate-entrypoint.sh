#!/bin/sh
# One-shot job (docs/adr/0013-migrations-as-a-job.md): applies pending migrations and, in
# demo setups, seeds. Runs to completion before the API starts; the API image cannot migrate.
set -eu

cd /app/apps/api

echo "[migrate] applying database migrations"
npx --no-install prisma migrate deploy

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "[migrate] seeding demo data (idempotent)"
  node dist-seed/prisma/seed.js
fi

echo "[migrate] done"
