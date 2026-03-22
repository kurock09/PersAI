#!/usr/bin/env bash
set -euo pipefail

# One-time/manual reset skeleton for dev namespace and Argo CD app resources.
# This script defaults to dry-run and requires explicit confirmation to execute.

NAMESPACE="${NAMESPACE:-persai-dev}"
ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
APPLICATION_NAME="${APPLICATION_NAME:-persai-dev}"
PROJECT_NAME="${PROJECT_NAME:-persai-dev}"
CONFIRM_FLAG="${1:-}"

show_plan() {
  cat <<EOF
[plan] dev GKE reset will run these commands:
  kubectl -n ${ARGOCD_NAMESPACE} delete application ${APPLICATION_NAME} --ignore-not-found=true
  kubectl -n ${ARGOCD_NAMESPACE} delete appproject ${PROJECT_NAME} --ignore-not-found=true
  kubectl delete namespace ${NAMESPACE} --ignore-not-found=true
EOF
}

execute_reset() {
  kubectl -n "${ARGOCD_NAMESPACE}" delete application "${APPLICATION_NAME}" --ignore-not-found=true
  kubectl -n "${ARGOCD_NAMESPACE}" delete appproject "${PROJECT_NAME}" --ignore-not-found=true
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true
}

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
