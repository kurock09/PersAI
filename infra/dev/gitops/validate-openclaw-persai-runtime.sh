#!/usr/bin/env bash
set -eu

# Validates that the pinned OpenClaw fork revision contains native PersAI runtime HTTP
# integration (ADR-048) so CI does not rely on openclaw-runtime-spec-apply-compat.patch.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SHA_FILE="${REPO_ROOT}/infra/dev/gitops/openclaw-approved-sha.txt"
OPENCLAW_FORK_REPO="${OPENCLAW_FORK_REPO:-https://github.com/kurock09/openclaw.git}"

test -f "${SHA_FILE}" || (echo "Missing approved SHA file: ${SHA_FILE}" && exit 1)

OPENCLAW_APPROVED_SHA="$(tr -d '\r\n' < "${SHA_FILE}")"
if [[ -z "${OPENCLAW_APPROVED_SHA}" ]]; then
  echo "Approved OpenClaw SHA is empty in ${SHA_FILE}" >&2
  exit 1
fi
if [[ ! "${OPENCLAW_APPROVED_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Approved OpenClaw SHA must be 40-char lowercase hex: ${OPENCLAW_APPROVED_SHA}" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

git clone --no-tags --depth 1 "${OPENCLAW_FORK_REPO}" "${WORKDIR}/openclaw"
git -C "${WORKDIR}/openclaw" fetch --depth 1 origin "${OPENCLAW_APPROVED_SHA}"
git -C "${WORKDIR}/openclaw" checkout --detach "${OPENCLAW_APPROVED_SHA}"

STORE_FILE="${WORKDIR}/openclaw/src/gateway/persai-runtime/persai-runtime-spec-store.ts"
HTTP_FILE="${WORKDIR}/openclaw/src/gateway/persai-runtime/persai-runtime-http.ts"
test -f "${STORE_FILE}" || (echo "Missing PersAI runtime store at ${STORE_FILE} (pin may predate ADR-048 native routes)." >&2 && exit 1)
test -f "${HTTP_FILE}" || (echo "Missing PersAI runtime HTTP at ${HTTP_FILE}" >&2 && exit 1)

grep -q "handleRuntimeSpecApplyHttpRequest" "${HTTP_FILE}" || (echo "PersAI runtime HTTP missing apply handler" >&2 && exit 1)
grep -q "persaiRuntimeSpecStore" "${WORKDIR}/openclaw/src/gateway/server-runtime-state.ts" || (
  echo "server-runtime-state.ts must wire persaiRuntimeSpecStore" >&2 && exit 1
)

echo "OpenClaw PersAI native runtime validation passed at ${OPENCLAW_APPROVED_SHA}."
