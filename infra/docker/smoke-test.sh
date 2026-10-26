#!/usr/bin/env bash
# Runs the images the way docker-compose.yml does, against a throwaway PostgreSQL: the
# migrator applies migrations and seeds, then the API starts and must answer /health.
# Building an image proves it compiles; this proves it runs, which is what matters when the
# runtime stage is pruned (see docs/adr/0013-migrations-as-a-job.md).
# Given the web image too, it puts nginx in front, as in production, and checks that a client
# cannot pass itself off as another address to dodge the login rate limit.
#
#   infra/docker/smoke-test.sh [api-image] [migrator-image] [web-image]
#   (defaults: asistcontrol-api:smoke asistcontrol-migrate:smoke, and no web image)
set -euo pipefail

API_IMAGE="${1:-asistcontrol-api:smoke}"
MIGRATOR_IMAGE="${2:-asistcontrol-migrate:smoke}"
WEB_IMAGE="${3:-}"
RUN_ID="smoke-$$"
NETWORK="$RUN_ID"
DB="$RUN_ID-db"
API="$RUN_ID-api"
WEB="$RUN_ID-web"
PORT="${SMOKE_PORT:-3999}"
WEB_PORT="${SMOKE_WEB_PORT:-3998}"

cleanup() {
  docker rm -f "$WEB" "$API" "$DB" >/dev/null 2>&1 || true
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
# Reachable as "api", the upstream name nginx.conf uses.
docker run -d --name "$API" --network "$NETWORK" --network-alias api -p "$PORT:3000" \
  "${ENV_ARGS[@]}" "$API_IMAGE" >/dev/null
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
    healthy=1
    break
  fi
  sleep 2
done

if [[ -z "${healthy:-}" ]]; then
  echo "API not healthy after 180 s" >&2
  docker logs "$API" >&2
  exit 1
fi

[[ -z "$WEB_IMAGE" ]] && exit 0

echo "== web (nginx in front of the API)"
docker run -d --name "$WEB" --network "$NETWORK" -p "$WEB_PORT:80" "$WEB_IMAGE" >/dev/null
for _ in $(seq 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/health" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/health" \
  || { echo "nginx does not reach the API" >&2; docker logs "$WEB" >&2; exit 1; }
echo "nginx -> api: ok"

# Wrong passwords, each claiming another address. The API allows 5 logins a minute per
# client; if nginx passed the forged header on, every attempt would look like a new client
# and the limit would never apply.
codes=""
for i in 1 2 3 4 5 6 7; do
  codes+=" $(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$WEB_PORT/api/auth/login" \
    -H 'content-type: application/json' -H "X-Forwarded-For: 203.0.113.$i" \
    -d '{"email":"admin@asistcontrol.local","password":"wrong-password-0"}')"
done
echo "forged X-Forwarded-For logins:$codes"
if [[ "$codes" != *429* ]]; then
  echo "the login rate limit never applied: a forged X-Forwarded-For got through" >&2
  exit 1
fi
forged=$(docker exec "$DB" psql -U smoke -d smoke -tAc \
  "select count(*) from audit_logs where ip like '203.0.113.%'")
if [[ "$forged" != "0" ]]; then
  echo "the audit log recorded $forged forged address(es)" >&2
  exit 1
fi
echo "forged addresses: rate limited and kept out of the audit log"
