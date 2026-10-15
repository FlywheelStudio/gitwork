#!/usr/bin/env bash
# Smoke-tests both runtimes end to end. Exits non-zero on any failure.
#   node:   next build + next start + SQLite file  -> /api/v1/health reports driver "sqlite"
#   worker: OpenNext build + wrangler preview + D1 -> /api/v1/health reports driver "d1"
#   worker: a full email-code sign-in through Better Auth + D1 + the local send_email binding
# Also fails if the Worker bundle contains Node-only code (see scan-worker-bundle.sh).
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
rm -rf .wrangler/tmp/email
W="http://localhost:$WORKER_PORT"
pnpm exec opennextjs-cloudflare preview --port $WORKER_PORT \
  --var BETTER_AUTH_SECRET:smoke-secret-smoke-secret-smoke-secret --var "BETTER_AUTH_URL:$W" & PGIDS+=($!)
check_health "$W/api/v1/health" d1

echo "  sign-in on the Worker"
post() { curl -sf -X POST "$W$1" -H "origin: $W" -H "content-type: application/json" "${@:2}"; }
post /api/auth/email-otp/send-verification-otp -d '{"email":"smoke@example.com","type":"sign-in"}' >/dev/null
# wrangler's local send_email binding writes each message to a file instead of sending it, a moment
# after the response returns. Wait for the file.
mail=""
for _ in $(seq 1 50); do
  mail=$(ls -t .wrangler/tmp/email/*/email-text/*.txt 2>/dev/null | head -1 || true)
  [ -n "$mail" ] && break
  sleep 0.2
done
[ -n "$mail" ] || { echo "FAIL: no sign-in email from the Worker"; exit 1; }
code=$(grep -oE 'sign-in code is [0-9]{6}' "$mail" | grep -oE '[0-9]{6}$')
cookie=$(post /api/auth/sign-in/email-otp -D - -o /dev/null -d "{\"email\":\"smoke@example.com\",\"otp\":\"$code\"}" \
  | grep -i '^set-cookie:' | cut -d' ' -f2 | cut -d';' -f1 | paste -sd';' -)
me=$(curl -sf "$W/api/v1/me" -H "cookie: $cookie")
echo "  $W/api/v1/me -> $me"
[[ "$me" == *'"email":"smoke@example.com"'* ]] || { echo "FAIL: Worker sign-in did not produce a session"; exit 1; }

echo "smoke: OK"
