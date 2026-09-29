#!/usr/bin/env bash
# Boots the API image against a throwaway PostgreSQL and waits for /health: migrations
# applied, demo data seeded, server listening. Building an image proves it compiles; this
# proves it runs, which is what matters when the runtime stage is pruned.
#
#   infra/docker/smoke-test.sh [image]      (default: asistcontrol-api:smoke)
set -euo pipefail

IMAGE="${1:-asistcontrol-api:smoke}"
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

# As docker-compose.yml runs it (demo mode, so the seed runs too): migrations, seed, server.
# The image itself defaults to production, where the seed refuses to run by design.
# Throwaway secrets: this database and this container live for a minute.
docker run -d --name "$API" --network "$NETWORK" -p "$PORT:3000" \
  -e NODE_ENV=development \
  -e DATABASE_URL="postgresql://smoke:smoke@$DB:5432/smoke?schema=public" \
  -e JWT_ACCESS_SECRET="smoke-access-secret-0123456789abcdefghij" \
  -e JWT_REFRESH_SECRET="smoke-refresh-secret-0123456789abcdefghij" \
  -e DEVICE_SECRETS_KEY="MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" \
  -e SEED_DEMO_DATA=true \
  "$IMAGE" >/dev/null

for _ in $(seq 90); do
  if ! docker ps -q --filter "name=^$API$" | grep -q .; then
    echo "API container exited" >&2
    docker logs "$API" >&2
    exit 1
  fi
  if body=$(curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null); then
    echo "healthy: $body"
    exit 0
  fi
  sleep 2
done

echo "API not healthy after 180 s" >&2
docker logs "$API" >&2
exit 1
