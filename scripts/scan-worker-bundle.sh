#!/usr/bin/env bash
# Fails if a Worker bundle directory contains Node-only code: the libsql driver, nodemailer, or a
# native .node file. Their names may appear only in the serverExternalPackages config string.
set -euo pipefail
dir="${1:?usage: scan-worker-bundle.sh <bundle-dir>}"
[ -d "$dir" ] || { echo "FAIL: $dir does not exist"; exit 1; }
if grep -rlE "@libsql/core|hrana-client|libsql/client/lib" "$dir" >/dev/null; then
  echo "FAIL: libsql driver code found in $dir"; exit 1
fi
if grep -rlE "nodemailer/lib|createTransport\(.*smtp" "$dir" >/dev/null; then
  echo "FAIL: nodemailer code found in $dir"; exit 1
fi
if [ -n "$(find "$dir" -name '*.node' -print -quit)" ]; then
  echo "FAIL: native .node file found in $dir"; exit 1
fi
echo "scan: $dir is clean"
