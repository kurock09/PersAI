#!/usr/bin/env bash
set -euo pipefail

# One-time/manual reset skeleton for dev namespace and Argo CD app resources.
# This script defaults to dry-run and requires explicit confirmation to execute.

NAMESPACE="${NAMESPACE:-persai-dev}"
ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
APPLICATION_NAME="${APPLICATION_NAME:-persai-dev}"
PROJECT_NAME="${PROJECT_NAME:-persai-dev}"
CONFIRM_FLAG="${1:-}"
EXPECTED_KUBE_CONTEXT="${EXPECTED_KUBE_CONTEXT:-}"

show_plan() {
  cat <<EOF
[plan] dev GKE reset will run these commands:
  kubectl config current-context
  kubectl -n ${ARGOCD_NAMESPACE} delete application ${APPLICATION_NAME} --ignore-not-found=true
  kubectl -n ${ARGOCD_NAMESPACE} delete appproject ${PROJECT_NAME} --ignore-not-found=true
  kubectl delete namespace ${NAMESPACE} --ignore-not-found=true
EOF
}

ensure_dependencies() {
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "[error] kubectl is required but not found in PATH."
    exit 1
  fi
}

guard_context() {
  local current_context
  current_context="$(kubectl config current-context 2>/dev/null || true)"

  if [[ -z "${current_context}" ]]; then
    echo "[error] kubectl context is not configured."
    exit 1
  fi

  echo "[context] current kubectl context: ${current_context}"

  if [[ -n "${EXPECTED_KUBE_CONTEXT}" && "${current_context}" != "${EXPECTED_KUBE_CONTEXT}" ]]; then
    echo "[error] EXPECTED_KUBE_CONTEXT=${EXPECTED_KUBE_CONTEXT} does not match current context."
    exit 1
  fi
}

execute_reset() {
  kubectl -n "${ARGOCD_NAMESPACE}" delete application "${APPLICATION_NAME}" --ignore-not-found=true
  kubectl -n "${ARGOCD_NAMESPACE}" delete appproject "${PROJECT_NAME}" --ignore-not-found=true
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true
}

if [[ -n "${CONFIRM_FLAG}" && "${CONFIRM_FLAG}" != "--execute" ]]; then
  echo "[error] unsupported argument: ${CONFIRM_FLAG}"
  echo "Use: ./infra/bootstrap/dev-gke-reset.sh [--execute]"
  exit 1
fi

ensure_dependencies
guard_context
show_plan

if [[ "${CONFIRM_FLAG}" != "--execute" ]]; then
  echo
  echo "[dry-run] no changes applied."
  echo "Use: ./infra/bootstrap/dev-gke-reset.sh --execute"
  exit 0
fi

echo
echo "[execute] applying one-time dev reset..."
execute_reset
echo "[done] dev reset commands completed."
