#!/usr/bin/env bash
# Starts the e2e stack (stack/docker-compose.yml), waits until the app answers,
# and creates the first System Admin that the tests sign in with.
#
#   BACKEND_TAG=sha-1a2b3c4 WEB_TAG=latest ADMIN_WEB_TAG=latest scripts/stack-up.sh
#
# Settings (all optional): BACKEND_TAG, WEB_TAG, ADMIN_WEB_TAG (default latest),
# BACKEND_IMAGE, WEB_IMAGE, ADMIN_WEB_IMAGE, E2E_PORT (8080), E2E_ADMIN_PORT (8081),
# E2E_MAILPIT_PORT (8025), E2E_ADMIN_EMAIL,
# E2E_ADMIN_PASSWORD, E2E_SKIP_PULL=1 (use local images only).
set -euo pipefail

cd "$(dirname "$0")/.."
compose() { docker compose -f stack/docker-compose.yml "$@"; }

port="${E2E_PORT:-8080}"
admin_port="${E2E_ADMIN_PORT:-8081}"
admin_email="${E2E_ADMIN_EMAIL:-admin@vietmath.test}"
export ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-E2eAdmin123}"

echo "backend: ${BACKEND_IMAGE:-ghcr.io/viettechno/vietmath-backend}:${BACKEND_TAG:-latest}"
echo "web:     ${WEB_IMAGE:-ghcr.io/viettechno/vietmath-web}:${WEB_TAG:-latest}"
echo "admin:   ${ADMIN_WEB_IMAGE:-ghcr.io/viettechno/vietmath-admin-web}:${ADMIN_WEB_TAG:-latest}"

if [ "${E2E_SKIP_PULL:-}" != "1" ]; then
  compose pull --quiet migrate api web admin-web
fi
compose up -d --wait --wait-timeout 180

echo "waiting for http://localhost:${port}/api/v1/hello"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${port}/api/v1/hello" >/dev/null 2>&1 &&
    curl -fsS "http://localhost:${port}/" >/dev/null 2>&1 &&
    curl -fsS "http://localhost:${admin_port}/" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS "http://localhost:${port}/api/v1/hello" && echo

# The first System Admin. Re-running the script keeps the existing one.
if out=$(compose run --rm --no-deps -e ADMIN_PASSWORD --entrypoint /admin api \
  create-admin -email "$admin_email" -name "E2E Admin" -phone 0900000001 2>&1); then
  echo "$out"
elif grep -q "already" <<<"$out"; then
  echo "admin $admin_email already exists"
else
  echo "$out" >&2
  exit 1
fi

echo "ready: app http://localhost:${port}  admin http://localhost:${admin_port}  mail http://localhost:${E2E_MAILPIT_PORT:-8025}"
