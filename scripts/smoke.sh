#!/usr/bin/env bash
# Smoke-tests both runtimes end to end. Exits non-zero on any failure.
#   node:   next build + next start + SQLite file  -> /api/v1/health reports driver "sqlite"
#   worker: OpenNext build + wrangler preview + D1 -> /api/v1/health reports driver "d1"
# Also fails if the Worker bundle contains libsql code or a native .node file.
set -euo pipefail
set -m # each background job gets its own process group, so cleanup can stop workerd too
cd "$(dirname "$0")/../apps/web"

NODE_PORT=3123
WORKER_PORT=8799

# A leftover server on either port would answer for the new build. Refuse to run.
for port in $NODE_PORT $WORKER_PORT; do
  if lsof -ti "tcp:$port" >/dev/null 2>&1; then
    echo "FAIL: port $port is already in use; stop that process first"; exit 1
  fi
done

PGIDS=()
cleanup() { for pgid in "${PGIDS[@]:-}"; do [ -n "$pgid" ] && kill -- "-$pgid" 2>/dev/null || true; done; }
trap cleanup EXIT

check_health() { # url expected_driver
  local body
  body=$(curl -sf --retry-connrefused --retry 60 --retry-delay 1 --retry-max-time 90 "$1")
  echo "  $1 -> $body"
  [[ "$body" == *"\"driver\":\"$2\""* ]] || { echo "FAIL: expected driver $2"; exit 1; }
}

echo "== node"
pnpm db:migrate
pnpm build
pnpm start --port $NODE_PORT & PGIDS+=($!)
check_health "http://localhost:$NODE_PORT/api/v1/health" sqlite

echo "== worker"
pnpm cf:build
../../scripts/scan-worker-bundle.sh .open-next
pnpm cf:migrate:local
pnpm exec opennextjs-cloudflare preview --port $WORKER_PORT & PGIDS+=($!)
check_health "http://localhost:$WORKER_PORT/api/v1/health" d1

echo "smoke: OK"
