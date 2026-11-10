#!/usr/bin/env bash
# The Phase 7 exit check, minus GitHub: a fresh self-host answers health on the SQLite driver and
# completes an email-code sign-in for an instance admin, which can then open /setup.
#   usage: selfhost-check.sh <base-url> <outbox-file> <admin-email>
# The instance must run with EMAIL_TRANSPORT=outbox and EMAIL_OUTBOX_PATH=<outbox-file>.
set -euo pipefail
B="${1:?base url}"; OUTBOX="${2:?outbox file}"; EMAIL="${3:?admin email}"

health=$(curl -sf --retry-connrefused --retry 90 --retry-delay 1 --retry-max-time 120 "$B/api/v1/health")
echo "  health -> $health"
[[ "$health" == *'"driver":"sqlite"'* ]] || { echo "FAIL: health did not report the sqlite driver"; exit 1; }

post() { curl -sf -X POST "$B$1" -H "origin: $B" -H "content-type: application/json" "${@:2}"; }
post /api/auth/email-otp/send-verification-otp -d "{\"email\":\"$EMAIL\",\"type\":\"sign-in\"}" >/dev/null
code=""
for _ in $(seq 1 50); do
  code=$(grep -F "\"$EMAIL\"" "$OUTBOX" 2>/dev/null | tail -1 | grep -oE 'sign-in code is [0-9]{6}' | grep -oE '[0-9]{6}$' || true)
  [ -n "$code" ] && break
  sleep 0.2
done
[ -n "$code" ] || { echo "FAIL: no sign-in code in $OUTBOX"; exit 1; }
cookie=$(post /api/auth/sign-in/email-otp -D - -o /dev/null -d "{\"email\":\"$EMAIL\",\"otp\":\"$code\"}" \
  | grep -i '^set-cookie:' | cut -d' ' -f2 | cut -d';' -f1 | paste -sd';' -)
me=$(curl -sf "$B/api/v1/me" -H "cookie: $cookie")
echo "  me -> $me"
[[ "$me" == *"\"email\":\"$EMAIL\""* ]] || { echo "FAIL: sign-in did not produce a session"; exit 1; }
setup=$(curl -s -o /dev/null -w '%{http_code}' "$B/setup" -H "cookie: $cookie")
echo "  /setup -> $setup"
[ "$setup" = 200 ] || { echo "FAIL: the instance admin cannot open /setup"; exit 1; }
health_page=$(curl -s -o /dev/null -w '%{http_code}' "$B/setup/health" -H "cookie: $cookie")
echo "  /setup/health -> $health_page"
[ "$health_page" = 200 ] || { echo "FAIL: the instance admin cannot open /setup/health"; exit 1; }
echo "selfhost-check: OK"
