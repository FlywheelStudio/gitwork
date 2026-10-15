#!/usr/bin/env bash
# Smoke-tests both runtimes end to end. Exits non-zero on any failure.
#   node:   next build + next start + SQLite file  -> /api/v1/health reports driver "sqlite"
#   worker: OpenNext build + wrangler preview + D1 -> /api/v1/health reports driver "d1"
# Also fails if the Worker bundle contains libsql code or a native .node file.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null || true; done; }
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
pnpm start --port 3123 & PIDS+=($!)
check_health http://localhost:3123/api/v1/health sqlite

echo "== worker"
pnpm cf:build
# libsql may appear only as the serverExternalPackages config string, never as driver code.
if grep -rlE "@libsql/core|hrana-client|libsql/client/lib" .open-next >/dev/null; then
  echo "FAIL: libsql driver code found in the Worker bundle"; exit 1
fi
if [ -n "$(find .open-next -name '*.node' -print -quit)" ]; then
  echo "FAIL: native .node file found in the Worker bundle"; exit 1
fi
pnpm cf:migrate:local
pnpm exec opennextjs-cloudflare preview --port 8799 & PIDS+=($!)
check_health http://localhost:8799/api/v1/health d1

echo "smoke: OK"
