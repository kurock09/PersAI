#!/usr/bin/env bash
set -euo pipefail

# ADR-146 Slice 0.1 foundation wrapper.
# Defaults to dry-run. Mutations require explicit --execute.
# Never disables NetworkPolicy as rollback.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PHASE="${1:-plan}"
shift || true

node "${ROOT_DIR}/infra/bootstrap/adr146-sandbox-egress-foundation.mjs" "${PHASE}" "$@"
