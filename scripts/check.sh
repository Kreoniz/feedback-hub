#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -z "$(gofmt -l backend)" || { echo 'Run gofmt on backend'; exit 1; }
(cd backend && go vet ./... && go test -race ./...)
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
