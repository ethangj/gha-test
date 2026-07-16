#!/usr/bin/env bash
# Starts a wiremock-runner Docker container (serve mode) and waits for it to
# become healthy. Used by CI jobs that need a Runner started manually before
# checkout-relative volumes (i.e. the "sidecar" pattern), rather than via the
# action's own ephemeral container mode.
#
# Required env: WMC_API_TOKEN, GITHUB_WORKSPACE
# Optional env: WMC_RUN_PROFILE
set -euo pipefail

: "${WMC_API_TOKEN:?WMC_API_TOKEN must be set}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE must be set}"

ARGS=(
  run -d --name wiremock-runner
  -p 8080:8080 -p 9999:9999
  -v "$GITHUB_WORKSPACE/.wiremock:/work/.wiremock"
  -e "WMC_API_TOKEN=$WMC_API_TOKEN"
  -e WMC_DEFAULT_MODE=serve
  -e WMC_ADMIN_PORT=9999
)

if [ -n "${WMC_RUN_PROFILE:-}" ]; then
  ARGS+=(-e "WMC_RUN_PROFILE=$WMC_RUN_PROFILE")
fi

ARGS+=(wiremock/wiremock-runner:latest)

docker "${ARGS[@]}"

for i in $(seq 1 30); do
  curl -sf http://localhost:9999/__/health && echo "Runner healthy" && break
  [ "$i" = "30" ] && docker logs wiremock-runner && exit 1
  sleep 2
done
