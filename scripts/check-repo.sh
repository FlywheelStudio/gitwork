#!/usr/bin/env bash
# Repo hygiene checks that run before install in CI. Exits non-zero on any failure.
#   1. No tracked file named like a Finder/iCloud conflict copy ("name 2.ext").
#   2. The .sql files in the migrations folder match drizzle's journal exactly. wrangler applies
#      every .sql file it finds, so a stray file would run on D1 even though drizzle ignores it.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

copies=$(git ls-files | grep -E ' [0-9]+(\.[^/]*)?$' || true)
if [ -n "$copies" ]; then
  echo "FAIL: conflict copies are tracked:"; echo "$copies"; fail=1
fi

dir=packages/db/migrations
on_disk=$(cd "$dir" && ls -1 -- *.sql | sed 's/\.sql$//' | sort)
in_journal=$(node -e 'for (const e of require("./'"$dir"'/meta/_journal.json").entries) console.log(e.tag)' | sort)
if [ "$on_disk" != "$in_journal" ]; then
  echo "FAIL: $dir does not match meta/_journal.json"
  diff <(echo "$in_journal") <(echo "$on_disk") || true
  fail=1
fi

[ "$fail" -eq 0 ] && echo "repo checks passed"
exit "$fail"
