#!/usr/bin/env bash
# Stops the e2e stack and deletes its data.
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose -f stack/docker-compose.yml down -v --remove-orphans
