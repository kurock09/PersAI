/**
 * ADR-146 Slice 3 — canonical assistant sandbox egress mode helpers.
 *
 * Prisma owns `restricted | full_public`. Kubernetes NetworkPolicy matchLabels
 * and pod annotations use `restricted | full-public`. Mapping happens only at
 * the control-plane → apiserver boundary.
 */

export const SANDBOX_EGRESS_MODE_KEY = "persai.io/sandbox-egress";

export type AssistantSandboxEgressMode = "restricted" | "full_public";
export type KubernetesSandboxEgressLabel = "restricted" | "full-public";

const PRISMA_MODES: readonly AssistantSandboxEgressMode[] = ["restricted", "full_public"];

export function isAssistantSandboxEgressMode(value: unknown): value is AssistantSandboxEgressMode {
  return typeof value === "string" && PRISMA_MODES.includes(value as AssistantSandboxEgressMode);
}

export function toKubernetesSandboxEgressLabel(
  mode: AssistantSandboxEgressMode
): KubernetesSandboxEgressLabel {
  return mode === "full_public" ? "full-public" : "restricted";
}

export function fromKubernetesSandboxEgressLabel(
  value: unknown
): AssistantSandboxEgressMode | null {
  if (value === "restricted") {
    return "restricted";
  }
  if (value === "full-public") {
    return "full_public";
  }
  return null;
}

/**
 * Pod mode is valid only when label and annotation are both present, equal, and
 * map to a known Prisma mode. Missing, mismatched, or unknown values are
 * malformed and must force recycle.
 */
export function readPodSandboxEgressMode(input: {
  labels?: Record<string, string> | null;
  annotations?: Record<string, string> | null;
}): AssistantSandboxEgressMode | null {
  const label = input.labels?.[SANDBOX_EGRESS_MODE_KEY];
  const annotation = input.annotations?.[SANDBOX_EGRESS_MODE_KEY];
  if (label === undefined || annotation === undefined || label !== annotation) {
    return null;
  }
  return fromKubernetesSandboxEgressLabel(label);
}

export function buildSandboxEgressModeMetadata(mode: AssistantSandboxEgressMode): {
  labelValue: KubernetesSandboxEgressLabel;
  labels: Record<string, string>;
  annotations: Record<string, string>;
} {
  const labelValue = toKubernetesSandboxEgressLabel(mode);
  return {
    labelValue,
    labels: { [SANDBOX_EGRESS_MODE_KEY]: labelValue },
    annotations: { [SANDBOX_EGRESS_MODE_KEY]: labelValue }
  };
}

/**
 * Restricted injects the exact six-entry proxy contour when both proxy URL and
 * NO_PROXY are configured. full_public must omit every proxy variable.
 */
export function buildSandboxEgressProxyEnv(
  mode: AssistantSandboxEgressMode,
  input: { proxyUrl: string; noProxy: string }
): Array<{ name: string; value: string }> {
  if (mode !== "restricted") {
    return [];
  }
  const proxyUrl = input.proxyUrl.trim();
  if (proxyUrl.length === 0) {
    return [];
  }
  const noProxy = input.noProxy.trim();
  const vars: Array<{ name: string; value: string }> = [
    { name: "HTTP_PROXY", value: proxyUrl },
    { name: "HTTPS_PROXY", value: proxyUrl },
    { name: "http_proxy", value: proxyUrl },
    { name: "https_proxy", value: proxyUrl }
  ];
  if (noProxy.length > 0) {
    vars.push({ name: "NO_PROXY", value: noProxy });
    vars.push({ name: "no_proxy", value: noProxy });
  }
  return vars;
}
