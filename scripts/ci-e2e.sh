#!/usr/bin/env bash
# CI end-to-end smoke test against the production build. Each stage's output goes to a log; on
# failure the tail of that log is printed as annotations, which the check run shows without the
# job log having to be downloaded.
set -uo pipefail
annotate() { # level title file lines
  tail -n "$4" "$3" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | while IFS= read -r l; do [ -n "$l" ] && echo "::$1 title=$2::$l"; done
}
stage() { # name command...
  local name=$1; shift
  echo "── $name"
  if ! "$@" > "/tmp/ci-$name.log" 2>&1; then
    cat "/tmp/ci-$name.log"
    annotate error "$name" "/tmp/ci-$name.log" 9
    annotate warning "api log" /tmp/api.log 6
    annotate warning "web log" /tmp/web.log 4
    exit 1
  fi
  cat "/tmp/ci-$name.log"
}
stage playwright-install bash -c 'npm i --no-save --no-audit --no-fund --loglevel=error playwright@1.55.0 && npx playwright install --with-deps chromium'
(cd apps/api && node dist/main.js > /tmp/api.log 2>&1 &)
(cd apps/web && npx next start -p 3000 > /tmp/web.log 2>&1 &)
stage wait-for-servers npx --yes wait-on@8.0.3 -t 60000 http://localhost:4000/api/v1/health http://localhost:3000/login
stage e2e node apps/web/e2e-smoke.cjs
