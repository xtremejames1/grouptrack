#!/usr/bin/env sh
set -eu

TAG="${1:-latest}"
ENV_FILE="${ENV_FILE:-/opt/grouptrack/secrets/.env.prod}"

docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml pull || true
docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml up -d --build
./ops/scripts/wait-for-health.sh "${PUBLIC_HEALTH_URL:-http://localhost/health}" 180
