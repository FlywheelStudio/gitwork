#!/usr/bin/env bash
# Every non-merge commit in <base>..<head> must carry a DCO sign-off by its author (decision 024).
#   usage: check-dco.sh <base-sha> <head-sha>
set -euo pipefail
base="${1:?base}"; head="${2:?head}"; fail=0
for sha in $(git rev-list --no-merges "$base..$head"); do
  author=$(git log -1 --format='%an <%ae>' "$sha")
  if ! git log -1 --format='%B' "$sha" | grep -qiF "Signed-off-by: $author"; then
    echo "FAIL: $(git log -1 --format='%h %s' "$sha") has no 'Signed-off-by: $author'"; fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "dco: every commit is signed off"
[ "$fail" -eq 0 ] || echo "Fix: git rebase --signoff $base, then push. See CONTRIBUTING.md."
exit "$fail"
