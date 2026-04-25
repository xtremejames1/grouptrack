#!/usr/bin/env sh
set -eu

URL="${1:-http://localhost:8000/health}"
TIMEOUT_SECONDS="${2:-120}"
SLEEP_SECONDS=2
elapsed=0

until curl -fsS "$URL" >/dev/null 2>&1; do
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    printf '%s\n' "health check timeout: $URL" >&2
    exit 1
  fi
  sleep "$SLEEP_SECONDS"
  elapsed=$((elapsed + SLEEP_SECONDS))
done
