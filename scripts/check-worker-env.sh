#!/usr/bin/env bash
# Fails if an OpenNext build baked .env* values into the Worker. `opennextjs-cloudflare build` copies
# every variable from apps/web/.env, .env.local, .env.production, ... into
# .open-next/cloudflare/next-env.mjs, and the Worker loads them into process.env. A developer's
# .env.local would ship its secret, its URL and EMAIL_TRANSPORT=console to production.
# Prints variable names only, never values.
set -euo pipefail
dir="${1:?usage: check-worker-env.sh <bundle-dir>}"
file="$dir/cloudflare/next-env.mjs"
[ -f "$file" ] || { echo "check-worker-env: $file not found. Run the OpenNext build first." >&2; exit 1; }
keys=$(grep -oE '"[A-Za-z_][A-Za-z0-9_]*":' "$file" | tr -d '":' | sort -u | tr '\n' ' ' || true)
if [ -n "$keys" ]; then
  echo "check-worker-env: the Worker bundle contains values from a .env file: $keys" >&2
  echo "Move apps/web/.env* (except .env.example) out of the way and build again. Workers read" >&2
  echo "secrets from 'wrangler secret put' and vars from the wrangler config." >&2
  exit 1
fi
echo "check-worker-env: $file has no baked variables"
