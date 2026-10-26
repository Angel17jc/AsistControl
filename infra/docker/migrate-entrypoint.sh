#!/bin/sh
# One-shot job (docs/adr/0013-migrations-as-a-job.md): applies pending migrations and, in
# demo setups, seeds. Runs to completion before the API starts; the API image cannot migrate.
set -eu

cd /app/apps/api

echo "[migrate] applying database migrations"
npx --no-install prisma migrate deploy

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  # docker-compose.yml turns the demo seed on by default. In production that must not stop
  # the deployment (the API waits for this job to succeed), and demo people must not land
  # in a real company: skip it, unless someone asks for it explicitly.
  if [ "${NODE_ENV:-}" = "production" ] && [ "${SEED_ALLOW_PRODUCTION:-false}" != "true" ]; then
    echo "[migrate] production: demo data NOT seeded (SEED_DEMO_DATA ignored)"
  else
    echo "[migrate] seeding demo data (idempotent)"
    node dist-seed/prisma/seed.js
  fi
fi

echo "[migrate] done"
