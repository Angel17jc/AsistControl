#!/usr/bin/env bash
# Runs the images the way docker-compose.yml does, against a throwaway PostgreSQL: the
# migrator applies migrations and seeds, then the API starts and must answer /health.
# Building an image proves it compiles; this proves it runs, which is what matters when the
# runtime stage is pruned (see docs/adr/0013-migrations-as-a-job.md).
#
#   infra/docker/smoke-test.sh [api-image] [migrator-image]
#   (defaults: asistcontrol-api:smoke asistcontrol-migrate:smoke)
set -euo pipefail

API_IMAGE="${1:-asistcontrol-api:smoke}"
MIGRATOR_IMAGE="${2:-asistcontrol-migrate:smoke}"
RUN_ID="smoke-$$"
NETWORK="$RUN_ID"
DB="$RUN_ID-db"
API="$RUN_ID-api"
PORT="${SMOKE_PORT:-3999}"

cleanup() {
  docker rm -f "$API" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null
docker run -d --name "$DB" --network "$NETWORK" \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke \
  postgres:17-alpine >/dev/null
for _ in $(seq 60); do
  docker exec "$DB" pg_isready -U smoke -d smoke >/dev/null 2>&1 && break
  sleep 1
done

# Demo mode, as docker-compose.yml runs it, so the seed runs too (the images default to
# production, where the seed refuses to run by design). Throwaway secrets: this database
# and these containers live for a minute.
ENV_ARGS=(
  -e NODE_ENV=development
  -e "DATABASE_URL=postgresql://smoke:smoke@$DB:5432/smoke?schema=public"
  -e JWT_ACCESS_SECRET=smoke-access-secret-0123456789abcdefghij
  -e JWT_REFRESH_SECRET=smoke-refresh-secret-0123456789abcdefghij
  -e DEVICE_SECRETS_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
  -e SEED_DEMO_DATA=true
)

echo "== migrator"
docker run --rm --network "$NETWORK" "${ENV_ARGS[@]}" "$MIGRATOR_IMAGE"

# The seed must hash like the API does (src/auth/password-hashing.ts): a login would work
# with any parameters, so it cannot tell. argon2 may list them in any order.
seeded=$(docker exec "$DB" psql -U smoke -d smoke -tAc \
  "select password_hash from users where email = 'admin@asistcontrol.local'")
for param in m=19456 t=2 p=1; do
  if [[ ",$(cut -d'$' -f4 <<<"$seeded")," != *",$param,"* ]]; then
    echo "seeded hash lacks $param: $seeded" >&2
    exit 1
  fi
done
echo "seed hash parameters: ok"

echo "== api"
docker run -d --name "$API" --network "$NETWORK" -p "$PORT:3000" "${ENV_ARGS[@]}" \
  "$API_IMAGE" >/dev/null
for _ in $(seq 90); do
  if ! docker ps -q --filter "name=^$API$" | grep -q .; then
    echo "API container exited" >&2
    docker logs "$API" >&2
    exit 1
  fi
  if body=$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null); then
    echo "healthy: $body"
    # A real login: the seeded user, argon2's native binding, JWT signing and the database.
    curl -fsS -o /dev/null -X POST "http://127.0.0.1:$PORT/api/auth/login" \
      -H 'content-type: application/json' \
      -d '{"email":"admin@asistcontrol.local","password":"AsistControl2026"}' \
      || { echo "demo login failed" >&2; docker logs "$API" >&2; exit 1; }
    echo "login: ok"
    exit 0
  fi
  sleep 2
done

echo "API not healthy after 180 s" >&2
docker logs "$API" >&2
exit 1
