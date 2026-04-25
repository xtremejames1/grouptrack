#!/usr/bin/env sh
set -eu

TAG="${1:?usage: rollback.sh <tag>}"
ENV_FILE="${ENV_FILE:-/opt/grouptrack/secrets/.env.prod}"

export IMAGE_TAG="$TAG"
docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml up -d --build
