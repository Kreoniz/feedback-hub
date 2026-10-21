#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
mkdir -p backend/bin
(cd backend && CGO_ENABLED=0 go build -trimpath -o bin/feedback-hub ./cmd/feedback-hub)
