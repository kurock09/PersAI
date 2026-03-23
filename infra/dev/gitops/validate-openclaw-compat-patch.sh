#!/usr/bin/env bash
set -eu

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PATCH_FILE="${REPO_ROOT}/infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch"
SHA_FILE="${REPO_ROOT}/infra/dev/gitops/openclaw-approved-sha.txt"
OPENCLAW_FORK_REPO="${OPENCLAW_FORK_REPO:-https://github.com/kurock09/openclaw.git}"

test -f "${PATCH_FILE}" || (echo "Missing compatibility patch file: ${PATCH_FILE}" && exit 1)
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

git -C "${WORKDIR}/openclaw" apply --check "${PATCH_FILE}"
echo "OpenClaw compatibility patch validation passed at ${OPENCLAW_APPROVED_SHA}."

