#!/usr/bin/env bash
# Generates realistic API traffic through the WireMock Runner proxy during recording.
# Run with: WIREMOCK_URL=http://localhost:8080 ./scripts/record-journey.sh
set -euo pipefail

BASE_URL="${WIREMOCK_URL:-http://localhost:8080}"

echo "Recording API traffic via $BASE_URL ..."

curl -sf "$BASE_URL/todos" -o /dev/null       && echo "  GET /todos — ok"
curl -sf "$BASE_URL/todos/1" -o /dev/null     && echo "  GET /todos/1 — ok"
curl -sf "$BASE_URL/todos/2" -o /dev/null     && echo "  GET /todos/2 — ok"
curl -sf "$BASE_URL/todos/3" -o /dev/null     && echo "  GET /todos/3 — ok"

echo "Traffic generation complete."
