import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFirewallDenyDestinations,
  buildRestrictedProxyDeniedCidrs,
  criticalNamedCidrs,
  findOverlaps,
  parseCidr
} from "./cidr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const DEFAULT_INVENTORY_PATH = path.resolve(
  __dirname,
  "..",
  "adr146-sandbox-egress-foundation.json"
);

export const APPLY_PHASE_ORDER = [
  "prepare",
  "apply-nat",
  "apply-firewall",
  "apply-calico",
  "apply-sandbox-pool"
];

export const ADR146_CONTROLLED_PROBE_LABEL = "sandbox.gke.io/adr146-controlled-probe";
/**
 * GKE Sandbox owns this node label and taint when `--sandbox=type=gvisor` is set.
 * Manually specifying either create flag is rejected (HTTP 400).
 * Inventory still expects both resulting managed values after create.
 */
export const GKE_MANAGED_SANDBOX_RUNTIME_KEY = "sandbox.gke.io/runtime";
/** Canonical inventory / CLI sandbox type; live GKE API may return `GVISOR`. */
export const GKE_SANDBOX_TYPE_GVISOR = "gvisor";
/**
 * Kubernetes Toleration.operator enum value for exact key/value match.
 * API-server is case-sensitive: lowercase `"equal"` is rejected
 * (`Unsupported value: "equal": supported values: "Equal", "Exists"`).
 * No compatibility alias or case-folding transition mode.
 */
export const KUBERNETES_TOLERATION_OPERATOR_EQUAL = "Equal";
/** Case spellings Kubernetes rejects for Toleration.operator Equal. */
export const KUBERNETES_REJECTED_TOLERATION_OPERATOR_CASINGS = Object.freeze([
  "equal",
  "EQUAL",
  "eQuAl"
]);
/** Kubernetes default injected Pod toleration for node NotReady taint. */
export const KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_NOT_READY = Object.freeze({
  key: "node.kubernetes.io/not-ready",
  operator: "Exists",
  effect: "NoExecute",
  tolerationSeconds: 300
});
/** Kubernetes default injected Pod toleration for node Unreachable taint. */
export const KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_UNREACHABLE = Object.freeze({
  key: "node.kubernetes.io/unreachable",
  operator: "Exists",
  effect: "NoExecute",
  tolerationSeconds: 300
});
/** Exact pair of Kubernetes default injected tolerations observed on admitted exec Pods. */
export const KUBERNETES_DEFAULT_INJECTED_POD_TOLERATIONS = Object.freeze([
  KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_NOT_READY,
  KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_UNREACHABLE
]);
export const ADR146_PROBE_ACTIVE_DEADLINE_SECONDS = 600;
/** Exact small resource envelope required on controlled probe Pods. */
export const ADR146_PROBE_RESOURCES = Object.freeze({
  requests: Object.freeze({ cpu: "50m", memory: "64Mi" }),
  limits: Object.freeze({ cpu: "200m", memory: "128Mi" })
});
/**
 * Inventory-owned NAT identity probe image: official curl, immutably digest-
 * pinned (multiarch manifest list inspected 2026-06-24 / release 8.21.0).
 * Default image USER is curl_user; hardened Pod runAsUser 1000 overrides it
 * and remains compatible (curl + CA bundle usable as non-root UID 1000).
 * Tag-only or busybox images are rejected — BusyBox wget TLS is not accepted.
 */
export const ADR146_NAT_PROBE_IMAGE =
  "curlimages/curl:8.21.0@sha256:7c12af72ceb38b7432ab85e1a265cff6ae58e06f95539d539b654f2cfa64bb13";

function parseSimpleValuesScalar(valuesText, pathParts) {
  if (typeof valuesText !== "string" || valuesText.trim().length === 0) {
    throw new Error("values-dev.yaml content missing");
  }
  const target = pathParts.join(".");
  const stack = [];
  const found = [];
  for (const [index, line] of valuesText.split(/\r?\n/u).entries()) {
    if (line.includes("\t")) {
      throw new Error(`values-dev.yaml line ${index + 1} contains a tab`);
    }
    if (/^\s*(?:#.*)?$/u.test(line)) continue;
    const match = /^( *)([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/u.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    if (indent % 2 !== 0) {
      throw new Error(`values-dev.yaml line ${index + 1} has non-canonical indentation`);
    }
    const depth = indent / 2;
    stack.length = depth;
    stack[depth] = match[2];
    const currentPath = stack.join(".");
    if (currentPath !== target) continue;
    const raw = (match[3] ?? "").trim();
    if (raw.length === 0 || raw.startsWith("#")) {
      throw new Error(`values-dev.yaml ${target} must be a scalar`);
    }
    const scalar = raw.replace(/\s+#.*$/u, "").trim();
    const unquoted =
      (scalar.startsWith('"') && scalar.endsWith('"')) ||
      (scalar.startsWith("'") && scalar.endsWith("'"))
        ? scalar.slice(1, -1)
        : scalar;
    found.push(unquoted);
  }
  if (found.length !== 1) {
    throw new Error(
      `values-dev.yaml must contain exactly one ${target} scalar, got ${found.length}`
    );
  }
  return found[0];
}

/**
 * Resolve the current production sandbox-exec image from committed
 * infra/helm/values-dev.yaml truth. No global-tag fallback or inventory tag.
 */
export function resolveSandboxExecImageFromValuesDev(valuesDevText) {
  const registryHost = parseSimpleValuesScalar(valuesDevText, ["global", "images", "registryHost"]);
  const projectId = parseSimpleValuesScalar(valuesDevText, ["global", "images", "projectId"]);
  const repository = parseSimpleValuesScalar(valuesDevText, ["global", "images", "repository"]);
  const imageName = parseSimpleValuesScalar(valuesDevText, ["sandboxExec", "image", "name"]);
  const imageTag = parseSimpleValuesScalar(valuesDevText, ["sandboxExec", "image", "tag"]);
  if (!/^[a-z0-9.-]+$/u.test(registryHost)) {
    throw new Error(`values-dev.yaml global.images.registryHost invalid: ${registryHost}`);
  }
  for (const [field, value] of Object.entries({ projectId, repository, imageName })) {
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(value)) {
      throw new Error(`values-dev.yaml ${field} invalid: ${value}`);
    }
  }
  if (!/^[a-f0-9]{40}$/u.test(imageTag)) {
    throw new Error(`values-dev.yaml sandboxExec.image.tag must be an exact 40-hex commit SHA`);
  }
  return `${registryHost}/${projectId}/${repository}/${imageName}:${imageTag}`;
}

/**
 * Exact restricted-mode proxy env names mirrored by real sandbox-exec pods
 * (`ExecPodBridgeService.buildProxyEnv`) when both proxy URL and NO_PROXY are set.
 * No compatibility aliases beyond this exact six-entry set.
 */
export const ADR146_RESTRICTED_PROXY_ENV_NAMES = Object.freeze([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy"
]);

const ADR146_PROXY_URL_ENV_NAMES = Object.freeze([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy"
]);

const ADR146_NO_PROXY_ENV_NAMES = Object.freeze(["NO_PROXY", "no_proxy"]);

/**
 * Reject proxy URL/userinfo credentials and secret-like env shapes. Never log values.
 */
export function proxyEnvValueContainsCredentials(value) {
  if (typeof value !== "string") return true;
  if (value.includes("@")) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*:[^/@]+@/iu.test(value)) return true;
  if (/:(?:\/\/)?[^/\s]*:[^/\s]+@/u.test(value)) return true;
  return false;
}

/**
 * Build the exact six restricted proxy env entries matching real exec pods.
 * Requires non-empty proxy URL + NO_PROXY; rejects credentials and empty values.
 */
export function buildExactRestrictedProxyEnv(proxyUrl, noProxy) {
  if (typeof proxyUrl !== "string" || proxyUrl.trim().length === 0) {
    throw new Error("restricted proxy URL required from sandbox.env.SANDBOX_EXEC_EGRESS_PROXY_URL");
  }
  if (typeof noProxy !== "string" || noProxy.trim().length === 0) {
    throw new Error("restricted NO_PROXY required from sandbox.env.SANDBOX_EXEC_NO_PROXY");
  }
  if (proxyUrl !== proxyUrl.trim() || /\s/u.test(proxyUrl)) {
    throw new Error("restricted proxy URL must be an exact non-secret scalar without whitespace");
  }
  if (noProxy !== noProxy.trim()) {
    throw new Error(
      "restricted NO_PROXY must be an exact non-secret scalar without surrounding whitespace"
    );
  }
  if (!/^https?:\/\/[^/@\s]+(?::\d+)?(?:\/\S*)?$/u.test(proxyUrl)) {
    throw new Error("restricted proxy URL must be an absolute http(s) URL without credentials");
  }
  if (proxyEnvValueContainsCredentials(proxyUrl) || proxyEnvValueContainsCredentials(noProxy)) {
    throw new Error("restricted proxy env must not contain credentials");
  }
  return Object.freeze([
    Object.freeze({ name: "HTTP_PROXY", value: proxyUrl }),
    Object.freeze({ name: "HTTPS_PROXY", value: proxyUrl }),
    Object.freeze({ name: "http_proxy", value: proxyUrl }),
    Object.freeze({ name: "https_proxy", value: proxyUrl }),
    Object.freeze({ name: "NO_PROXY", value: noProxy }),
    Object.freeze({ name: "no_proxy", value: noProxy })
  ]);
}

/**
 * Resolve exact non-secret restricted proxy env from committed values-dev.yaml
 * (`sandbox.env.SANDBOX_EXEC_EGRESS_PROXY_URL` + `SANDBOX_EXEC_NO_PROXY`).
 * Fail closed — no empty/default fallback, no secrets, no arbitrary env.
 */
export function resolveSandboxExecProxyEnvFromValuesDev(valuesDevText) {
  const proxyUrl = parseSimpleValuesScalar(valuesDevText, [
    "sandbox",
    "env",
    "SANDBOX_EXEC_EGRESS_PROXY_URL"
  ]);
  const noProxy = parseSimpleValuesScalar(valuesDevText, [
    "sandbox",
    "env",
    "SANDBOX_EXEC_NO_PROXY"
  ]);
  return buildExactRestrictedProxyEnv(proxyUrl, noProxy);
}

/**
 * Validate an env list is exactly the six restricted proxy entries (name+value).
 * Returns errors without echoing secret-like values.
 */
export function validateExactRestrictedProxyEnv(env) {
  const errors = [];
  if (!Array.isArray(env)) {
    return ["restricted proxy env must be an array of exactly six entries"];
  }
  if (env.length !== ADR146_RESTRICTED_PROXY_ENV_NAMES.length) {
    errors.push(
      `restricted proxy env must have exactly ${ADR146_RESTRICTED_PROXY_ENV_NAMES.length} entries, got ${env.length}`
    );
  }
  const seen = new Map();
  for (let index = 0; index < env.length; index += 1) {
    const entry = env[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`restricted proxy env[${index}] must be an object`);
      continue;
    }
    const keys = Object.keys(entry);
    const unexpected = keys.filter((key) => key !== "name" && key !== "value");
    if (unexpected.length > 0) {
      errors.push(
        `restricted proxy env[${index}] must contain only name/value; unexpected fields: ${unexpected.join(", ")}`
      );
    }
    if (Object.hasOwn(entry, "valueFrom") || entry.valueFrom != null) {
      errors.push(`restricted proxy env[${index}] must not use valueFrom/secret refs`);
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      errors.push(`restricted proxy env[${index}].name missing`);
      continue;
    }
    if (!ADR146_RESTRICTED_PROXY_ENV_NAMES.includes(entry.name)) {
      errors.push(`restricted proxy env has unexpected name ${entry.name}`);
    }
    if (seen.has(entry.name)) {
      errors.push(`restricted proxy env has duplicate name ${entry.name}`);
    } else {
      seen.set(entry.name, entry.value);
    }
    if (typeof entry.value !== "string" || entry.value.length === 0) {
      errors.push(`restricted proxy env ${entry.name} value must be a non-empty string`);
      continue;
    }
    if (proxyEnvValueContainsCredentials(entry.value)) {
      errors.push(`restricted proxy env ${entry.name} must not contain credentials`);
    }
  }
  for (const name of ADR146_RESTRICTED_PROXY_ENV_NAMES) {
    if (!seen.has(name)) {
      errors.push(`restricted proxy env missing ${name}`);
    }
  }
  const proxyValues = ADR146_PROXY_URL_ENV_NAMES.map((name) => seen.get(name)).filter(
    (value) => typeof value === "string"
  );
  if (proxyValues.length > 0 && new Set(proxyValues).size !== 1) {
    errors.push("restricted proxy URL env values conflict across HTTP(S)_PROXY names");
  }
  const noProxyValues = ADR146_NO_PROXY_ENV_NAMES.map((name) => seen.get(name)).filter(
    (value) => typeof value === "string"
  );
  if (noProxyValues.length > 0 && new Set(noProxyValues).size !== 1) {
    errors.push("restricted NO_PROXY env values conflict across NO_PROXY/no_proxy");
  }
  if (errors.length > 0) return errors;
  // Canonical order must match real exec buildProxyEnv.
  for (let index = 0; index < ADR146_RESTRICTED_PROXY_ENV_NAMES.length; index += 1) {
    if (env[index]?.name !== ADR146_RESTRICTED_PROXY_ENV_NAMES[index]) {
      errors.push(
        `restricted proxy env order must match real exec (${ADR146_RESTRICTED_PROXY_ENV_NAMES.join(", ")})`
      );
      break;
    }
  }
  return errors;
}

function restrictedProxyEnvFingerprint(env) {
  return ADR146_RESTRICTED_PROXY_ENV_NAMES.map((name) => {
    const entry = (env ?? []).find((candidate) => candidate?.name === name);
    return `${name}=${typeof entry?.value === "string" ? entry.value : ""}`;
  }).join("\n");
}

function restrictedProxyEnvEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every(
    (entry, index) => entry?.name === right[index]?.name && entry?.value === right[index]?.value
  );
}

/**
 * Extract the exact six restricted proxy env entries from a container env list.
 * Fail closed on missing/extra/duplicate/credentials/secret refs.
 * Real exec and controlled restricted probes must carry exactly these six entries.
 */
export function extractExactRestrictedProxyEnv(env) {
  const errors = validateExactRestrictedProxyEnv(env);
  if (errors.length > 0) {
    return { ok: false, env: null, errors };
  }
  try {
    const exact = buildExactRestrictedProxyEnv(
      env.find((entry) => entry.name === "HTTP_PROXY").value,
      env.find((entry) => entry.name === "NO_PROXY").value
    );
    return { ok: true, env: exact, errors: [] };
  } catch (error) {
    return {
      ok: false,
      env: null,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}
/** Known controlled probe Pod names generated by this foundation CLI. */
export const ADR146_CONTROLLED_PROBE_POD_NAMES = Object.freeze([
  "adr146-restricted-probe",
  "adr146-nat-probe"
]);

/**
 * Inert controller bookkeeping annotation keys allowed on live Argo-managed
 * `sandbox-exec-sa`. Any other annotation (WIF/GCP identity, arbitrary, or
 * security-relevant) fails closed.
 */
export const EXEC_KSA_INERT_ANNOTATION_KEYS = Object.freeze([
  "argocd.argoproj.io/tracking-id",
  "kubectl.kubernetes.io/last-applied-configuration"
]);

/**
 * SubnetworkLogConfig.metadata API describe enums → gcloud CLI
 * `--logging-metadata` ChoiceEnumMapper values (not the API names).
 * Verified against `gcloud compute networks subnets update --help` /
 * googlecloudsdk ChoiceEnumMapper custom_mappings.
 */
export const FLOW_LOG_METADATA_API_TO_CLI = Object.freeze({
  INCLUDE_ALL_METADATA: "include-all",
  EXCLUDE_ALL_METADATA: "exclude-all",
  CUSTOM_METADATA: "custom"
});

/**
 * SubnetworkLogConfig.aggregationInterval API describe enums → gcloud CLI
 * `--logging-aggregation-interval` ChoiceEnumMapper values.
 */
export const FLOW_LOG_AGGREGATION_API_TO_CLI = Object.freeze({
  INTERVAL_5_SEC: "interval-5-sec",
  INTERVAL_30_SEC: "interval-30-sec",
  INTERVAL_1_MIN: "interval-1-min",
  INTERVAL_5_MIN: "interval-5-min",
  INTERVAL_10_MIN: "interval-10-min",
  INTERVAL_15_MIN: "interval-15-min"
});

export function flowLogMetadataCliArg(apiMetadata) {
  const mapped = FLOW_LOG_METADATA_API_TO_CLI[apiMetadata];
  if (!mapped) {
    throw new Error(
      `unsupported subnet flow-log metadata API enum for gcloud CLI mapping: ${String(apiMetadata)}`
    );
  }
  return mapped;
}

export function flowLogAggregationCliArg(apiInterval) {
  const mapped = FLOW_LOG_AGGREGATION_API_TO_CLI[apiInterval];
  if (!mapped) {
    throw new Error(
      `unsupported subnet flow-log aggregationInterval API enum for gcloud CLI mapping: ${String(apiInterval)}`
    );
  }
  return mapped;
}

/**
 * Normalize GKE Network Policy addon enablement from cluster describe JSON.
 *
 * gcloud / GKE API omit default `disabled: false`, so live enabled shape is often
 * `addonsConfig.networkPolicyConfig: {}`. Treat a present `networkPolicyConfig`
 * object with `disabled !== true` as enabled. Explicit `disabled: true` is
 * disabled. Absent `addonsConfig` / absent `networkPolicyConfig` fails closed
 * (not enabled) rather than guessing omitted-default for a missing property.
 */
export function isNetworkPolicyAddonEnabled(cluster) {
  const addonsConfig = cluster?.addonsConfig;
  if (addonsConfig == null || typeof addonsConfig !== "object" || Array.isArray(addonsConfig)) {
    return false;
  }
  if (!Object.hasOwn(addonsConfig, "networkPolicyConfig")) {
    return false;
  }
  const config = addonsConfig.networkPolicyConfig;
  if (config == null || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }
  return config.disabled !== true;
}

export function loadInventory(inventoryPath = DEFAULT_INVENTORY_PATH) {
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const errors = validateInventory(inventory);
  if (errors.length > 0) {
    throw new Error(`invalid foundation inventory:\n- ${errors.join("\n- ")}`);
  }
  return inventory;
}

export function nodeServiceAccountIdentity(inventory) {
  const id = inventory.nodeServiceAccount.id;
  return {
    id,
    email: `${id}@${inventory.cluster.projectId}.iam.gserviceaccount.com`
  };
}

export function natAddressName(inventory, index) {
  return `${inventory.nat.staticAddressNamePrefix}-${index + 1}`;
}

export function validateInventory(inventory) {
  const errors = [];
  if (!inventory || typeof inventory !== "object") return ["inventory must be an object"];
  if (inventory.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (inventory.cluster?.datapathProvider !== "LEGACY_DATAPATH") {
    errors.push("cluster.datapathProvider must be LEGACY_DATAPATH");
  }
  if (inventory.cluster?.networkPolicyProvider !== "CALICO") {
    errors.push("cluster.networkPolicyProvider must be CALICO");
  }
  if (!inventory.cluster?.expectedAccount || !inventory.cluster?.expectedKubeContext) {
    errors.push("expected gcloud account and kubectl context are required");
  }
  if (inventory.network?.vpcName == null || inventory.network?.subnetName == null) {
    errors.push("explicit network.vpcName and network.subnetName are required");
  }
  if (inventory.calico?.requiresNodeRecreation !== true) {
    errors.push("Calico enablement must acknowledge node recreation");
  }
  if (inventory.rollback?.neverDisableNetworkPolicy !== true) {
    errors.push("rollback must never disable NetworkPolicy");
  }
  if (inventory.sandboxNodePool?.enablePrivateNodes !== true) {
    errors.push("private sandbox node pool is required");
  }
  if (!isAcceptedGvisorSandboxType(inventory.sandboxNodePool?.sandboxType)) {
    errors.push("private pool must declare sandboxType gvisor (GKE Sandbox)");
  }
  if (inventory.sandboxNodePool?.labels?.workload !== "sandbox") {
    errors.push("private pool must keep workload=sandbox");
  }
  if (!hasExpectedTaint(inventory.sandboxNodePool?.taints ?? [])) {
    errors.push("private pool must keep sandbox.gke.io/runtime=gvisor:NoSchedule");
  }
  if (inventory.firewall?.action !== "DENY" || inventory.firewall?.direction !== "EGRESS") {
    errors.push("firewall must be EGRESS DENY");
  }
  if (JSON.stringify(inventory.firewall?.protocols) !== JSON.stringify(["all"])) {
    errors.push("firewall must deny all protocols");
  }
  if (!inventory.nodeServiceAccount?.forbiddenRoles?.includes("roles/editor")) {
    errors.push("node SA forbiddenRoles must include roles/editor");
  }

  const named = criticalNamedCidrs(inventory);
  for (const entry of named) {
    try {
      parseCidr(entry.cidr);
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const cidr of [
    ...(inventory.cidrs?.vpcSubnetDenies ?? []),
    ...(inventory.cidrs?.nonClusterSpecialUseDenies ?? []),
    ...(inventory.cidrs?.observedPeerRoutes ?? [])
  ]) {
    try {
      parseCidr(cidr);
    } catch (error) {
      errors.push(
        `firewall/live CIDR ${cidr}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  for (const overlap of findOverlaps(named)) {
    errors.push(
      `CIDR overlap: ${overlap.left} (${overlap.leftCidr}) ∩ ${overlap.right} (${overlap.rightCidr})`
    );
  }

  const firewallDenies = buildFirewallDenyDestinations(inventory);
  const calicoOwned = [
    ...inventory.cidrs.calicoOwnedDenies.nodeCidrs,
    ...inventory.cidrs.calicoOwnedDenies.podCidrs,
    ...inventory.cidrs.calicoOwnedDenies.serviceCidrs,
    ...inventory.cidrs.calicoOwnedDenies.metadataCidrs
  ];
  const unsafe = firewallDenies.filter((deny) =>
    calicoOwned.some((owned) => cidrContainsOrOverlaps(deny, owned))
  );
  if (unsafe.length > 0 && (inventory.firewall.requiredPathAllows?.length ?? 0) === 0) {
    errors.push(
      `VPC deny overlaps Calico-owned Pod/Service/metadata CIDRs without required-path ALLOWs: ${unsafe.join(", ")}`
    );
  }
  if (firewallDenies.includes("10.0.0.0/8")) {
    errors.push("VPC firewall must not deny broad 10.0.0.0/8; it contains required Pod paths");
  }
  const dns = inventory.network?.dns;
  if (
    dns?.provider !== "KUBE_DNS" ||
    dns?.nodeLocalEnabled !== true ||
    !String(dns?.nodeLocalAddress ?? "").endsWith("/32") ||
    !String(dns?.kubeDnsServiceAddress ?? "").endsWith("/32") ||
    !sameSet(
      (dns?.ports ?? []).map((entry) => `${entry.protocol}/${entry.port}`),
      ["UDP/53", "TCP/53"]
    )
  ) {
    errors.push("audited KUBE_DNS + NodeLocal DNS /32 inventory and UDP/TCP 53 are required");
  }
  for (const cidr of [
    dns?.nodeLocalAddress,
    dns?.kubeDnsServiceAddress,
    dns?.kubeDnsUpstreamServiceAddress
  ]) {
    try {
      parseCidr(cidr);
    } catch (error) {
      errors.push(`DNS CIDR ${cidr}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const probe = inventory.cidrs?.restrictedProbe;
  for (const [name, listener] of Object.entries({
    ...(probe?.serviceListeners ?? {}),
    ...(probe?.managedListeners ?? {}),
    metadata: probe?.metadata
  })) {
    if (
      !listener ||
      !Number.isInteger(listener.port) ||
      listener.port < 1 ||
      listener.port > 65535
    ) {
      errors.push(`restricted probe listener ${name} must have a valid TCP port`);
    }
  }
  try {
    parseCidr(`${probe?.metadata?.host}/32`);
  } catch (error) {
    errors.push(`metadata probe host: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    !Number.isInteger(probe?.nodeKubeletPort) ||
    probe.nodeKubeletPort < 1 ||
    probe.nodeKubeletPort > 65535
  ) {
    errors.push("restricted probe nodeKubeletPort must be a valid TCP port");
  }
  if (
    probe?.publicEgressIdentityEndpoint?.url !== "https://api.ipify.org" ||
    probe?.publicEgressIdentityEndpoint?.responseFormat !== "plain_ipv4_no_query"
  ) {
    errors.push("public egress identity probe must use the fixed no-query plain IPv4 endpoint");
  }
  if (
    typeof probe?.squidDeniedPublicHttpsHostname !== "string" ||
    !probe.squidDeniedPublicHttpsHostname.includes(".") ||
    /^[.]?(pypi\.org|pythonhosted\.org)/i.test(probe.squidDeniedPublicHttpsHostname)
  ) {
    errors.push(
      "restrictedProbe.squidDeniedPublicHttpsHostname must be a fixed non-allowlisted public HTTPS hostname"
    );
  }
  errors.push(...validateRequiredGvisorTolerationShape(probe?.requiredGvisorToleration));
  errors.push(...validateNatProbeImageInventory(probe?.natProbePod?.image));
  if (inventory.nat?.scope?.type !== "CUSTOM_PRIMARY_AND_SANDBOX_SECONDARY") {
    errors.push("Cloud NAT must select the cluster subnet primary plus sandbox Pod secondary");
  }
  const flowLogs = inventory.network?.flowLogs;
  if (!FLOW_LOG_METADATA_API_TO_CLI[flowLogs?.metadata]) {
    errors.push(
      "network.flowLogs.metadata must be a known API describe enum (e.g. INCLUDE_ALL_METADATA)"
    );
  }
  if (!FLOW_LOG_AGGREGATION_API_TO_CLI[flowLogs?.aggregationInterval]) {
    errors.push(
      "network.flowLogs.aggregationInterval must be a known API describe enum (e.g. INTERVAL_5_SEC)"
    );
  }
  if (
    flowLogs?.flowSampling == null ||
    Number.isNaN(Number(flowLogs.flowSampling)) ||
    Number(flowLogs.flowSampling) < 0 ||
    Number(flowLogs.flowSampling) > 1
  ) {
    errors.push("network.flowLogs.flowSampling must be a number in [0, 1]");
  }
  return errors;
}

/**
 * Exact-match prepare resume planner: skip resources already at inventory truth,
 * continue at the first unfinished prepare step (flow logs / PGA / secondary).
 */
export function selectPrepareCommandIds(inventory, before) {
  const ids = [];
  const { email } = nodeServiceAccountIdentity(inventory);
  if (before?.nodeSa == null) ids.push("create-node-sa");
  const roles = extractRolesForMember(before?.nodeSaPolicy, `serviceAccount:${email}`);
  inventory.nodeServiceAccount.requiredRoles.forEach((role, index) => {
    if (!roles.includes(role)) ids.push(`bind-node-sa-role-${index + 1}`);
  });
  const addresses = before?.natAddresses ?? [];
  for (let index = 0; index < inventory.nat.staticAddressCount; index += 1) {
    if (addresses[index] == null) ids.push(`reserve-nat-ip-${index + 1}`);
  }
  if (!subnetFlowLogsMatch(inventory, before?.subnet)) ids.push("enable-subnet-flow-logs");
  if (before?.subnet?.privateIpGoogleAccess !== true) ids.push("ensure-private-google-access");
  const sandboxRange = before?.subnet?.secondaryIpRanges?.find(
    (range) => range.rangeName === inventory.sandboxNodePool.podSecondaryRangeName
  );
  if (sandboxRange == null) ids.push("create-sandbox-pod-secondary");
  return ids;
}

/**
 * Exact-match apply-sandbox-pool resume planner: skip create when the private
 * pool already matches inventory contour (including case-normalized gVisor).
 * Caller must fail closed if a non-matching pool already exists (create 409).
 * Legacy public-pool cordon remains an execute-time idempotent step.
 */
export function selectApplySandboxPoolCommandIds(inventory, before) {
  const ids = [];
  if (!privatePoolMatches(inventory, before?.privatePool)) {
    ids.push("create-private-sandbox-pool");
  }
  return ids;
}

/**
 * GKE Sandbox type acceptance: only gVisor (`gvisor` / `GVISOR` casing).
 * Empty, missing, and any other type fail closed.
 */
export function isAcceptedGvisorSandboxType(value) {
  return String(value ?? "").toLowerCase() === GKE_SANDBOX_TYPE_GVISOR;
}

/** Live `sandboxConfig.type` (or legacy sandboxType alias) from a node-pool describe. */
export function readLiveSandboxConfigType(pool) {
  if (!pool) return undefined;
  const type = pool.config?.sandboxConfig?.type ?? pool.config?.sandboxConfig?.sandboxType;
  return type == null || type === "" ? undefined : type;
}

function cidrContainsOrOverlaps(left, right) {
  const a = parseCidr(left);
  const b = parseCidr(right);
  const aEnd = a.network + 2 ** (32 - a.prefix) - 1;
  const bEnd = b.network + 2 ** (32 - b.prefix) - 1;
  return a.network <= bEnd && b.network <= aEnd;
}

function hasExpectedTaint(taints) {
  return taints.some(
    (taint) =>
      taint.key === GKE_MANAGED_SANDBOX_RUNTIME_KEY &&
      taint.value === "gvisor" &&
      ["NO_SCHEDULE", "NoSchedule"].includes(taint.effect)
  );
}

/**
 * Operator-owned values for `gcloud ... node-pools create`.
 * GKE applies the managed sandbox runtime label and taint from `--sandbox=type=gvisor`.
 */
export function operatorOwnedNodeLabels(labels) {
  return Object.fromEntries(
    Object.entries(labels ?? {}).filter(([key]) => key !== GKE_MANAGED_SANDBOX_RUNTIME_KEY)
  );
}

export function operatorOwnedNodeTaints(taints) {
  return (taints ?? []).filter((taint) => taint.key !== GKE_MANAGED_SANDBOX_RUNTIME_KEY);
}

function formatNodeLabelsFlag(labels) {
  const entries = Object.entries(operatorOwnedNodeLabels(labels));
  if (entries.length === 0) return null;
  return `--node-labels=${entries.map(([key, value]) => `${key}=${value}`).join(",")}`;
}

function formatNodeTaintsFlag(taints) {
  const owned = operatorOwnedNodeTaints(taints);
  if (owned.length === 0) return null;
  return `--node-taints=${owned
    .map((taint) => `${taint.key}=${taint.value}:NoSchedule`)
    .join(",")}`;
}

export function buildPhasePlans(inventory, resolved = {}) {
  const project = inventory.cluster.projectId;
  const cluster = inventory.cluster.name;
  const zone = inventory.cluster.location;
  const region = inventory.cluster.region;
  const network = resolved.network ?? inventory.network.vpcName;
  const subnet = resolved.subnet ?? inventory.network.subnetName;
  const pool = inventory.sandboxNodePool;
  const { id: nodeSaId, email: nodeSaEmail } = nodeServiceAccountIdentity(inventory);
  const denyDestinations = buildFirewallDenyDestinations(inventory);

  return {
    prepare: [
      command("create-node-sa", "Create exact least-privilege node SA", [
        "gcloud",
        "iam",
        "service-accounts",
        "create",
        nodeSaId,
        `--project=${project}`,
        `--display-name=${inventory.nodeServiceAccount.displayName}`
      ]),
      ...inventory.nodeServiceAccount.requiredRoles.map((role, index) =>
        command(`bind-node-sa-role-${index + 1}`, `Bind ${role}`, [
          "gcloud",
          "projects",
          "add-iam-policy-binding",
          project,
          `--member=serviceAccount:${nodeSaEmail}`,
          `--role=${role}`,
          "--condition=None"
        ])
      ),
      ...Array.from({ length: inventory.nat.staticAddressCount }, (_, index) =>
        command(`reserve-nat-ip-${index + 1}`, "Reserve static regional NAT address", [
          "gcloud",
          "compute",
          "addresses",
          "create",
          natAddressName(inventory, index),
          `--project=${project}`,
          `--region=${region}`,
          "--network-tier=PREMIUM"
        ])
      ),
      command("enable-subnet-flow-logs", "Enable exact subnet flow-log policy", [
        "gcloud",
        "compute",
        "networks",
        "subnets",
        "update",
        subnet,
        `--project=${project}`,
        `--region=${region}`,
        "--enable-flow-logs",
        `--logging-aggregation-interval=${flowLogAggregationCliArg(inventory.network.flowLogs.aggregationInterval)}`,
        `--logging-flow-sampling=${inventory.network.flowLogs.flowSampling}`,
        `--logging-metadata=${flowLogMetadataCliArg(inventory.network.flowLogs.metadata)}`
      ]),
      command("ensure-private-google-access", "Enable Private Google Access", [
        "gcloud",
        "compute",
        "networks",
        "subnets",
        "update",
        subnet,
        `--project=${project}`,
        `--region=${region}`,
        "--enable-private-ip-google-access"
      ]),
      command("create-sandbox-pod-secondary", "Create dedicated sandbox Pod secondary range", [
        "gcloud",
        "compute",
        "networks",
        "subnets",
        "update",
        subnet,
        `--project=${project}`,
        `--region=${region}`,
        `--add-secondary-ranges=${pool.podSecondaryRangeName}=${inventory.cidrs.sandboxPodSecondary}`
      ])
    ],
    "apply-nat": [
      command("create-router", "Create router on exact cluster VPC", [
        "gcloud",
        "compute",
        "routers",
        "create",
        inventory.nat.routerName,
        `--project=${project}`,
        `--region=${region}`,
        `--network=${network}`
      ]),
      command("create-nat", "Create MANUAL_ONLY static Cloud NAT with ALL logging", [
        "gcloud",
        "compute",
        "routers",
        "nats",
        "create",
        inventory.nat.natName,
        `--project=${project}`,
        `--router=${inventory.nat.routerName}`,
        `--region=${region}`,
        `--nat-custom-subnet-ip-ranges=${subnet},${subnet}:${pool.podSecondaryRangeName}`,
        `--nat-external-ip-pool=${Array.from(
          { length: inventory.nat.staticAddressCount },
          (_, index) => natAddressName(inventory, index)
        ).join(",")}`,
        `--min-ports-per-vm=${inventory.nat.minPortsPerVm}`,
        "--enable-logging",
        `--log-filter=${inventory.nat.logFilter}`
      ])
    ],
    "apply-firewall": [
      command(
        "create-deny-private-egress",
        "Deny all protocols to reviewed VPC/peer/special CIDRs",
        [
          "gcloud",
          "compute",
          "firewall-rules",
          "create",
          inventory.firewall.denyEgressRuleName,
          `--project=${project}`,
          `--network=${network}`,
          `--direction=${inventory.firewall.direction}`,
          `--priority=${inventory.firewall.priority}`,
          `--action=${inventory.firewall.action}`,
          "--rules=all",
          `--destination-ranges=${denyDestinations.join(",")}`,
          `--target-tags=${inventory.firewall.networkTag}`,
          "--description=ADR-146 reviewed VPC/peer/special deny; Pod/Service/metadata remain Calico-owned"
        ]
      )
    ],
    "apply-calico": [
      command("enable-network-policy-addon", "Enable managed Calico addon", [
        "gcloud",
        "container",
        "clusters",
        "update",
        cluster,
        `--project=${project}`,
        `--zone=${zone}`,
        `--update-addons=${inventory.calico.enableAddonCommand}`
      ]),
      command("enable-network-policy", "Enable enforcement; recreates every node pool", [
        "gcloud",
        "container",
        "clusters",
        "update",
        cluster,
        `--project=${project}`,
        `--zone=${zone}`,
        "--enable-network-policy"
      ])
    ],
    "apply-sandbox-pool": [
      command(
        "create-private-sandbox-pool",
        "Create exact private sandbox node pool",
        [
          "gcloud",
          "container",
          "node-pools",
          "create",
          pool.replacementName,
          `--project=${project}`,
          `--cluster=${cluster}`,
          `--zone=${zone}`,
          `--machine-type=${pool.machineType}`,
          `--disk-size=${pool.diskSizeGb}`,
          `--image-type=${pool.imageType}`,
          `--num-nodes=${pool.minNodes}`,
          "--enable-autoscaling",
          `--min-nodes=${pool.minNodes}`,
          `--max-nodes=${pool.maxNodes}`,
          "--enable-private-nodes",
          `--service-account=${nodeSaEmail}`,
          `--pod-ipv4-range=${pool.podSecondaryRangeName}`,
          formatNodeLabelsFlag(pool.labels),
          formatNodeTaintsFlag(pool.taints),
          `--tags=${pool.networkTags.join(",")}`,
          `--sandbox=type=${pool.sandboxType}`,
          "--shielded-secure-boot",
          "--shielded-integrity-monitoring",
          "--metadata=disable-legacy-endpoints=true"
        ].filter(Boolean)
      ),
      command(
        "cordon-public-pool",
        "Fail-closed: stop NEW scheduling on legacy public sandbox nodes after private pool is Ready (does not delete the pool or kill running pods)",
        ["kubectl", "cordon", "-l", `cloud.google.com/gke-nodepool=${pool.retirePublicPoolName}`]
      )
    ],
    "retire-public-pool": [
      command("cordon-public-pool", "Re-assert cordon on every legacy sandbox node before delete", [
        "kubectl",
        "cordon",
        "-l",
        `cloud.google.com/gke-nodepool=${pool.retirePublicPoolName}`
      ]),
      command("delete-public-pool", "Delete legacy public sandbox pool after maintenance gate", [
        "gcloud",
        "container",
        "node-pools",
        "delete",
        pool.retirePublicPoolName,
        `--project=${project}`,
        `--cluster=${cluster}`,
        `--zone=${zone}`,
        "--quiet"
      ])
    ]
  };
}

function command(id, description, argv) {
  return { id, description, argv, mutating: true };
}

export function resolveRestrictedProbeTargets(inventory, live) {
  const probe = inventory.cidrs.restrictedProbe;
  const serviceTarget = (label, service, expected) => ({
    label,
    host: service?.spec?.clusterIP ?? null,
    port: service?.spec?.ports?.find((entry) => Number(entry.port) === expected.port)?.port ?? null,
    protocol: "TCP"
  });
  const redis = live.redisInstance;
  const filestore = live.filestoreInstance;
  const cloudSql = live.cloudSqlInstance;
  const kubeDnsPodIp = (live.dnsPodIps ?? []).find(Boolean) ?? null;
  const trustedPodIp =
    (live.trustedProbePods ?? []).find((pod) => pod.phase === "Running" && pod.podIP)?.podIP ??
    null;
  return [
    serviceTarget(
      "Kubernetes API Service",
      live.kubernetesApiService,
      probe.serviceListeners.kubernetesApi
    ),
    serviceTarget(
      "metrics-server Service",
      live.metricsServerService,
      probe.serviceListeners.metricsServer
    ),
    {
      label: "Redis",
      host: redis?.host ?? null,
      port: Number(redis?.port ?? 0) || null,
      protocol: "TCP"
    },
    {
      label: "Filestore NFS",
      host: filestore?.networks?.[0]?.ipAddresses?.[0] ?? null,
      port: probe.managedListeners.filestore.port,
      protocol: "TCP"
    },
    {
      label: "Cloud SQL PostgreSQL",
      host: cloudSql?.ipAddresses?.find((entry) => entry.type === "PRIVATE")?.ipAddress ?? null,
      port: probe.managedListeners.cloudSql.port,
      protocol: "TCP"
    },
    {
      label: "kube-dns Pod UDP/53",
      host: kubeDnsPodIp,
      port: 53,
      protocol: "UDP",
      calicoOwned: true
    },
    {
      label: "kube-dns Pod TCP/53",
      host: kubeDnsPodIp,
      port: 53,
      protocol: "TCP",
      calicoOwned: true
    },
    {
      label: "trusted sandbox control-plane Pod",
      host: trustedPodIp,
      port: Number(probe.trustedPod.servicePort) || null,
      protocol: "TCP",
      calicoOwned: true
    },
    ...(live.allNodes ?? [])
      .filter((node) => node.internalIp)
      .map((node) => ({
        label: `node kubelet ${node.name}`,
        host: node.internalIp,
        port: probe.nodeKubeletPort,
        protocol: "TCP"
      }))
  ];
}

export function resolveCalicoOwnedProbeTargets(inventory, live) {
  return resolveRestrictedProbeTargets(inventory, live).filter((target) => target.calicoOwned);
}

export function inventoryConflictingEgressAllows(inventory, firewallRules) {
  const denyPriority = Number(inventory.firewall.priority);
  const denyDestinations = buildFirewallDenyDestinations(inventory);
  const tag = inventory.firewall.networkTag;
  return (firewallRules ?? []).filter((rule) => {
    if (rule?.name === inventory.firewall.denyEgressRuleName) return false;
    if (String(rule?.direction).toUpperCase() !== "EGRESS") return false;
    if (rule?.disabled === true) return false;
    const allows = rule?.allowed ?? [];
    if (allows.length === 0) return false;
    const priority = Number(rule?.priority ?? 1000);
    if (!(priority < denyPriority)) return false;
    const targetTags = rule?.targetTags ?? [];
    const targetsSandbox =
      targetTags.length === 0 || targetTags.includes(tag) || targetTags.includes("gke-node");
    if (!targetsSandbox) return false;
    const destinations = rule?.destinationRanges?.length ? rule.destinationRanges : ["0.0.0.0/0"];
    return destinations.some(
      (destination) =>
        destination === "0.0.0.0/0" ||
        denyDestinations.some((deny) => cidrContainsOrOverlaps(destination, deny))
    );
  });
}

export function inventoryNatEligibleConsumers(inventory, regionalInstances, allNodes) {
  const nodeByName = new Map((allNodes ?? []).map((node) => [node.name, node]));
  return (regionalInstances ?? [])
    .flatMap((instance) =>
      (instance.networkInterfaces ?? []).map((networkInterface) => ({
        instance,
        networkInterface
      }))
    )
    .filter(({ networkInterface }) => {
      const hasExternalIp = (networkInterface.accessConfigs ?? []).some((config) =>
        Boolean(config.natIP)
      );
      const usesSandboxSecondary = (networkInterface.aliasIpRanges ?? []).some(
        (range) => range.subnetworkRangeName === inventory.sandboxNodePool.podSecondaryRangeName
      );
      return (
        basenameRef(networkInterface.network) === inventory.network.vpcName &&
        basenameRef(networkInterface.subnetwork) === inventory.network.subnetName &&
        (!hasExternalIp || usesSandboxSecondary)
      );
    })
    .map(({ instance, networkInterface }) => {
      const hasExternalIp = (networkInterface.accessConfigs ?? []).some((config) =>
        Boolean(config.natIP)
      );
      const usesSandboxSecondary = (networkInterface.aliasIpRanges ?? []).some(
        (range) => range.subnetworkRangeName === inventory.sandboxNodePool.podSecondaryRangeName
      );
      return {
        name: instance.name,
        zone: basenameRef(instance.zone),
        networkIp: networkInterface.networkIP,
        pool: nodeByName.get(instance.name)?.pool ?? null,
        tags: instance.tags?.items ?? [],
        eligibleVia: [
          ...(hasExternalIp ? [] : ["PRIMARY_IP_RANGE"]),
          ...(usesSandboxSecondary ? [inventory.sandboxNodePool.podSecondaryRangeName] : [])
        ]
      };
    });
}

export function natEgressIdentityMatches(observedIp, natAddresses) {
  try {
    parseCidr(`${observedIp}/32`);
  } catch {
    return false;
  }
  return (natAddresses ?? []).some((address) => address?.address === observedIp);
}

export function evaluatePreflight(inventory, live, phase) {
  const checks = [];
  check(
    checks,
    "gcloud-project",
    live.identity?.project === inventory.cluster.projectId,
    live.identity?.project
  );
  check(
    checks,
    "gcloud-account",
    live.identity?.account === inventory.cluster.expectedAccount,
    live.identity?.account
  );
  check(
    checks,
    "kubectl-context",
    live.identity?.kubeContext === inventory.cluster.expectedKubeContext,
    live.identity?.kubeContext
  );
  check(checks, "cluster-name", live.cluster?.name === inventory.cluster.name, live.cluster?.name);
  check(
    checks,
    "cluster-location",
    live.cluster?.location === inventory.cluster.location,
    live.cluster?.location
  );
  check(
    checks,
    "legacy-datapath",
    live.cluster?.networkConfig?.datapathProvider === inventory.cluster.datapathProvider,
    live.cluster?.networkConfig?.datapathProvider
  );
  check(
    checks,
    "cluster-vpc",
    basenameRef(live.cluster?.network) === inventory.network.vpcName,
    live.cluster?.network
  );
  check(
    checks,
    "cluster-subnet",
    basenameRef(live.cluster?.subnetwork) === inventory.network.subnetName,
    live.cluster?.subnetwork
  );
  check(
    checks,
    "node-cidr",
    live.subnet?.ipCidrRange === inventory.cidrs.nodePrimary,
    live.subnet?.ipCidrRange
  );
  check(
    checks,
    "pod-cidr",
    live.cluster?.ipAllocationPolicy?.clusterIpv4CidrBlock === inventory.cidrs.podDefault,
    live.cluster?.ipAllocationPolicy?.clusterIpv4CidrBlock
  );
  check(
    checks,
    "service-cidr",
    live.cluster?.ipAllocationPolicy?.servicesIpv4CidrBlock === inventory.cidrs.service,
    live.cluster?.ipAllocationPolicy?.servicesIpv4CidrBlock
  );
  check(
    checks,
    "default-gke-snat-enabled",
    live.cluster?.defaultSnatStatus?.disabled !== true,
    JSON.stringify(live.cluster?.defaultSnatStatus ?? null)
  );
  check(
    checks,
    "no-global-non-masquerade",
    !JSON.stringify(live.ipMasqAgentConfig?.data ?? {}).includes("0.0.0.0/0"),
    JSON.stringify(live.ipMasqAgentConfig?.data ?? null)
  );

  const actualSecondaries = Object.fromEntries(
    (live.subnet?.secondaryIpRanges ?? []).map((range) => [range.rangeName, range.ipCidrRange])
  );
  check(
    checks,
    "existing-secondary-ranges",
    sameObject(actualSecondaries, inventory.network.existingSecondaryRanges) ||
      sameObject(actualSecondaries, {
        ...inventory.network.existingSecondaryRanges,
        [inventory.sandboxNodePool.podSecondaryRangeName]: inventory.cidrs.sandboxPodSecondary
      }),
    JSON.stringify(actualSecondaries)
  );
  const sandboxRange = live.subnet?.secondaryIpRanges?.find(
    (range) => range.rangeName === inventory.sandboxNodePool.podSecondaryRangeName
  );
  const overlappingOtherRange = (live.subnet?.secondaryIpRanges ?? []).some(
    (range) =>
      range.rangeName !== inventory.sandboxNodePool.podSecondaryRangeName &&
      cidrContainsOrOverlaps(range.ipCidrRange, inventory.cidrs.sandboxPodSecondary)
  );
  const rangeAvailable =
    !overlappingOtherRange &&
    (sandboxRange?.ipCidrRange === inventory.cidrs.sandboxPodSecondary || !sandboxRange);
  check(
    checks,
    "sandbox-secondary-available",
    rangeAvailable,
    JSON.stringify(sandboxRange ?? null)
  );

  const reviewedVpcSubnetRoutes = [inventory.cidrs.nodePrimary, ...inventory.cidrs.vpcSubnetDenies];
  const postPrepareVpcSubnetRoutes = [
    ...reviewedVpcSubnetRoutes,
    inventory.cidrs.sandboxPodSecondary
  ];
  const hasExactSandboxSecondary =
    sandboxRange?.ipCidrRange === inventory.cidrs.sandboxPodSecondary;
  // Exact two-state inventory only: pre-prepare reviewed routes, or post-prepare
  // reviewed routes plus the dedicated sandbox secondary route. Presence of the
  // exact named secondary selects the post state; mismatches fail closed.
  const expectedVpcSubnetRoutes = hasExactSandboxSecondary
    ? postPrepareVpcSubnetRoutes
    : reviewedVpcSubnetRoutes;
  check(
    checks,
    "vpc-subnet-route-inventory",
    sameSet(live.vpcSubnetRoutes ?? [], expectedVpcSubnetRoutes),
    JSON.stringify({
      actual: live.vpcSubnetRoutes ?? [],
      expected: expectedVpcSubnetRoutes,
      sandboxSecondaryExact: hasExactSandboxSecondary
    })
  );
  check(
    checks,
    "peer-route-inventory",
    sameSet(live.peerRoutes ?? [], inventory.cidrs.observedPeerRoutes),
    JSON.stringify(live.peerRoutes ?? [])
  );
  check(
    checks,
    "psa-reservation-inventory",
    sameSet(live.psaRanges ?? [], [inventory.cidrs.peers.psaA, inventory.cidrs.peers.psaB]),
    JSON.stringify(live.psaRanges ?? [])
  );
  check(
    checks,
    "dns-provider",
    live.cluster?.networkConfig?.dnsConfig?.clusterDns === inventory.network.dns.provider,
    live.cluster?.networkConfig?.dnsConfig?.clusterDns
  );
  check(
    checks,
    "kube-dns-service-address",
    `${live.kubeDnsService?.spec?.clusterIP}/32` === inventory.network.dns.kubeDnsServiceAddress &&
      portsMatch(live.kubeDnsService?.spec?.ports, inventory.network.dns.ports),
    JSON.stringify(live.kubeDnsService?.spec ?? null)
  );
  check(
    checks,
    "kube-dns-upstream-service-address",
    `${live.kubeDnsUpstreamService?.spec?.clusterIP}/32` ===
      inventory.network.dns.kubeDnsUpstreamServiceAddress &&
      portsMatch(live.kubeDnsUpstreamService?.spec?.ports, inventory.network.dns.ports),
    JSON.stringify(live.kubeDnsUpstreamService?.spec ?? null)
  );
  const nodeLocalAddresses = live.nodeLocalDnsAddresses ?? [];
  const nodeLocalStatus = live.nodeLocalDnsDaemonSet?.status;
  check(
    checks,
    "node-local-dns-addresses",
    live.nodeLocalDnsDaemonSet != null &&
      Number(nodeLocalStatus?.desiredNumberScheduled) > 0 &&
      Number(nodeLocalStatus?.numberReady) === Number(nodeLocalStatus?.desiredNumberScheduled) &&
      sameSet(nodeLocalAddresses, [
        inventory.network.dns.nodeLocalAddress.replace(/\/32$/, ""),
        inventory.network.dns.kubeDnsServiceAddress.replace(/\/32$/, "")
      ]),
    JSON.stringify(nodeLocalAddresses)
  );
  const probe = inventory.cidrs.restrictedProbe;
  const probeTargets = resolveRestrictedProbeTargets(inventory, live);
  const mandatoryTargets = probeTargets.filter((target) => !target.calicoOwned).slice(0, 5);
  const calicoTargets = probeTargets.filter((target) => target.calicoOwned);
  check(
    checks,
    "probe-service-listeners-live",
    mandatoryTargets
      .slice(0, 2)
      .every(
        (target) =>
          target.host &&
          target.port &&
          cidrContainsOrOverlaps(inventory.cidrs.service, `${target.host}/32`)
      ),
    JSON.stringify(mandatoryTargets.slice(0, 2))
  );
  check(
    checks,
    "probe-managed-listeners-live",
    mandatoryTargets.slice(2).every((target) => target.host && target.port) &&
      basenameRef(live.redisInstance?.name) === probe.managedListeners.redis.name &&
      mandatoryTargets[2]?.port === probe.managedListeners.redis.port &&
      cidrContainsOrOverlaps(inventory.cidrs.peers.redis, `${mandatoryTargets[2]?.host}/32`) &&
      basenameRef(live.filestoreInstance?.name) === probe.managedListeners.filestore.name &&
      cidrContainsOrOverlaps(inventory.cidrs.peers.filestore, `${mandatoryTargets[3]?.host}/32`) &&
      live.cloudSqlInstance?.name === probe.managedListeners.cloudSql.name &&
      cidrContainsOrOverlaps(inventory.cidrs.peers.psaB, `${mandatoryTargets[4]?.host}/32`),
    JSON.stringify(mandatoryTargets.slice(2))
  );
  check(
    checks,
    "probe-calico-owned-targets-live",
    calicoTargets.length >= 3 &&
      calicoTargets.every((target) => target.host && target.port) &&
      (live.dnsPodIps ?? []).length > 0 &&
      (live.trustedProbePods ?? []).some((pod) => pod.phase === "Running" && pod.podIP),
    JSON.stringify(calicoTargets)
  );

  const hasWindow = Boolean(live.cluster?.maintenancePolicy?.window);
  const hasExclusions =
    Object.keys(live.cluster?.maintenancePolicy?.maintenanceExclusions ?? {}).length > 0;
  check(
    checks,
    "maintenance-policy",
    hasWindow === inventory.cluster.maintenancePolicy.hasWindow &&
      hasExclusions === inventory.cluster.maintenancePolicy.hasExclusions,
    `window=${hasWindow} exclusions=${hasExclusions}; ${inventory.cluster.maintenancePolicy.implication}`
  );

  const npEnabled = live.cluster?.networkPolicy?.enabled === true;
  const npProviderExact =
    live.cluster?.networkPolicy?.provider === inventory.cluster.networkPolicyProvider;
  const addonEnabled = isNetworkPolicyAddonEnabled(live.cluster);
  const safeNpState = !npEnabled || (npProviderExact && addonEnabled);
  const npStateAllowed =
    phase === "apply-calico" ||
    phase === "prepare" ||
    phase === "apply-nat" ||
    phase === "apply-firewall"
      ? safeNpState
      : npEnabled && npProviderExact && addonEnabled;
  check(
    checks,
    "network-policy-state-valid-for-phase",
    npStateAllowed,
    `NP=${npEnabled} provider=${live.cluster?.networkPolicy?.provider ?? "missing"} addon=${addonEnabled}`
  );
  if (["apply-sandbox-pool", "retire-public-pool", "verify"].includes(phase)) {
    checks.push(...evaluateCurrentCalicoReadiness(inventory, live).checks);
  }

  const publicPool = live.publicPool;
  const publicExpected = publicPool == null ? true : publicPoolMatches(inventory, publicPool);
  check(checks, "public-pool-shape", publicExpected, summarizePool(publicPool));

  const existingChecks = evaluateManagedResources(inventory, live);
  checks.push(...existingChecks.checks);
  const laterThanPrepare = phase !== "prepare" && phase !== "apply-nat";
  const roles = extractRolesForMember(
    live.nodeSaPolicy,
    `serviceAccount:${nodeServiceAccountIdentity(inventory).email}`
  );
  if (phase !== "prepare") {
    check(
      checks,
      "prepare-phase-complete",
      live.nodeSa != null &&
        sameSet(roles, inventory.nodeServiceAccount.requiredRoles) &&
        (live.natAddresses?.length ?? 0) === inventory.nat.staticAddressCount &&
        live.natAddresses.every(Boolean) &&
        live.subnet?.privateIpGoogleAccess === true &&
        subnetFlowLogsMatch(inventory, live.subnet) &&
        sandboxRange?.ipCidrRange === inventory.cidrs.sandboxPodSecondary,
      "node SA/roles, static IPs, PGA, flow logs, and sandbox secondary must be exact before later phases"
    );
  }
  if (laterThanPrepare) {
    check(
      checks,
      "nat-phase-complete",
      live.router != null && natMatches(inventory, live.nat),
      "exact router + MANUAL_ONLY logged NAT required"
    );
  }
  if (["apply-calico", "apply-sandbox-pool", "retire-public-pool", "verify"].includes(phase)) {
    check(
      checks,
      "firewall-phase-complete",
      firewallMatches(inventory, live.firewall),
      "exact all-protocol reviewed firewall required"
    );
  }
  if (["retire-public-pool", "verify"].includes(phase)) {
    check(
      checks,
      "private-pool-phase-complete",
      privatePoolMatches(inventory, live.privatePool) &&
        sandboxRange?.ipCidrRange === inventory.cidrs.sandboxPodSecondary,
      "exact private pool and custom secondary required"
    );
  }
  if (["retire-public-pool", "verify"].includes(phase)) {
    const publicNodes = live.publicPoolNodes ?? [];
    const publicPoolPresent = live.publicPool != null || publicNodes.length > 0;
    check(
      checks,
      "legacy-public-pool-cordoned-or-absent",
      !publicPoolPresent ||
        (publicNodes.length > 0 && publicNodes.every((node) => node.unschedulable === true)),
      publicPoolPresent
        ? JSON.stringify(
            publicNodes.map((node) => ({ name: node.name, unschedulable: node.unschedulable }))
          )
        : "absent"
    );
  }
  return result(checks);
}

export function evaluateManagedResources(inventory, live) {
  const checks = [];
  const expectedSa = nodeServiceAccountIdentity(inventory);
  const saAbsent = live.nodeSa == null;
  const saIdentityExact =
    saAbsent ||
    (live.nodeSa.email === expectedSa.email &&
      live.nodeSa.displayName === inventory.nodeServiceAccount.displayName &&
      live.nodeSa.disabled !== true);
  check(
    checks,
    "node-sa-config-or-absent",
    saIdentityExact,
    `${JSON.stringify(live.nodeSa ?? null)}; reconcile displayName/disabled state or remove the unused SA`
  );

  const roles = extractRolesForMember(live.nodeSaPolicy, `serviceAccount:${expectedSa.email}`);
  const forbidden = roles.filter((role) =>
    inventory.nodeServiceAccount.forbiddenRoles.includes(role)
  );
  const extra = roles.filter((role) => !inventory.nodeServiceAccount.requiredRoles.includes(role));
  check(
    checks,
    "node-sa-no-forbidden-roles",
    forbidden.length === 0,
    forbidden.join(",") || "none"
  );
  check(checks, "node-sa-no-extra-project-roles", extra.length === 0, extra.join(",") || "none");

  for (let index = 0; index < inventory.nat.staticAddressCount; index += 1) {
    const address = live.natAddresses?.[index] ?? null;
    const exact =
      address == null ||
      (address.name === natAddressName(inventory, index) &&
        address.region?.endsWith(`/${inventory.cluster.region}`) &&
        address.addressType === "EXTERNAL" &&
        address.networkTier === "PREMIUM" &&
        ["RESERVED", "IN_USE"].includes(address.status));
    check(
      checks,
      `nat-address-${index + 1}-exact-or-absent`,
      exact,
      `${JSON.stringify(address)}; reconcile region/type/tier/status before retry`
    );
  }

  const routerExact =
    live.router == null ||
    (live.router.name === inventory.nat.routerName &&
      basenameRef(live.router.network) === inventory.network.vpcName &&
      live.router.region?.endsWith(`/${inventory.cluster.region}`));
  check(
    checks,
    "router-exact-or-absent",
    routerExact,
    `${JSON.stringify(live.router ?? null)}; reconcile router network/region before retry`
  );

  const natExact = live.nat == null || natMatches(inventory, live.nat);
  check(
    checks,
    "nat-exact-or-absent",
    natExact,
    `${JSON.stringify(live.nat ?? null)}; reconcile to MANUAL_ONLY/static/ALL-logged primary-plus-sandbox-secondary NAT`
  );

  const firewallExact = live.firewall == null || firewallMatches(inventory, live.firewall);
  check(
    checks,
    "firewall-exact-or-absent",
    firewallExact,
    `${JSON.stringify(live.firewall ?? null)}; reconcile exact all-protocol deny or replace safely`
  );

  const poolExact = live.privatePool == null || privatePoolMatches(inventory, live.privatePool);
  check(
    checks,
    "private-pool-exact-or-absent",
    poolExact,
    `${summarizePool(live.privatePool)}; node-pool drift requires deliberate replacement`
  );
  return result(checks);
}

export function evaluateLiveFoundation(inventory, live) {
  const checks = [...evaluatePreflight(inventory, live, "verify").checks];
  const expectedSa = nodeServiceAccountIdentity(inventory);
  const roles = extractRolesForMember(live.nodeSaPolicy, `serviceAccount:${expectedSa.email}`);
  check(
    checks,
    "node-sa-required-roles-exact",
    sameSet(roles, inventory.nodeServiceAccount.requiredRoles),
    JSON.stringify(roles)
  );
  check(
    checks,
    "private-pool-present-exact",
    privatePoolMatches(inventory, live.privatePool),
    summarizePool(live.privatePool)
  );
  check(checks, "public-pool-absent", live.publicPool == null, summarizePool(live.publicPool));
  check(
    checks,
    "sandbox-nodes-present",
    (live.privatePoolNodes?.length ?? 0) > 0,
    `count=${live.privatePoolNodes?.length ?? 0}`
  );
  check(
    checks,
    "sandbox-nodes-no-external-ip",
    (live.privatePoolNodes?.length ?? 0) > 0 &&
      live.privatePoolNodes.every((node) => !node.externalIp),
    JSON.stringify(live.privatePoolNodes ?? [])
  );
  check(
    checks,
    "subnet-private-google-access",
    live.subnet?.privateIpGoogleAccess === true,
    String(live.subnet?.privateIpGoogleAccess)
  );
  const flow = live.subnet?.logConfig;
  check(
    checks,
    "subnet-flow-logs-exact",
    live.subnet?.enableFlowLogs === true &&
      flow?.aggregationInterval === inventory.network.flowLogs.aggregationInterval &&
      Number(flow?.flowSampling) === Number(inventory.network.flowLogs.flowSampling) &&
      flow?.metadata === inventory.network.flowLogs.metadata,
    JSON.stringify(flow ?? null)
  );
  check(checks, "nat-exact", natMatches(inventory, live.nat), JSON.stringify(live.nat ?? null));
  const eligibleConsumers = live.natEligibleConsumers ?? [];
  const privateNodeNames = (live.privatePoolNodes ?? []).map((node) => node.name);
  check(
    checks,
    "nat-consumers-currently-sandbox-exclusive",
    eligibleConsumers.length > 0 &&
      sameSet(
        eligibleConsumers.map((consumer) => consumer.name),
        privateNodeNames
      ) &&
      eligibleConsumers.every(
        (consumer) =>
          consumer.pool === inventory.sandboxNodePool.replacementName &&
          consumer.tags?.includes(inventory.firewall.networkTag)
      ),
    JSON.stringify(eligibleConsumers)
  );
  check(
    checks,
    "nat-static-addresses-exact",
    (live.natAddresses?.length ?? 0) === inventory.nat.staticAddressCount &&
      live.natAddresses.every(
        (address, index) => address.name === natAddressName(inventory, index)
      ),
    JSON.stringify(live.natAddresses ?? [])
  );
  check(
    checks,
    "firewall-exact",
    firewallMatches(inventory, live.firewall),
    JSON.stringify(live.firewall ?? null)
  );
  check(
    checks,
    "no-conflicting-higher-priority-egress-allows",
    (live.conflictingEgressAllows ?? []).length === 0,
    JSON.stringify(
      (live.conflictingEgressAllows ?? []).map((rule) => ({
        name: rule.name,
        priority: rule.priority,
        destinationRanges: rule.destinationRanges,
        targetTags: rule.targetTags
      }))
    )
  );
  check(
    checks,
    "exec-ksa-object-ready",
    live.execServiceAccount?.metadata?.name === "sandbox-exec-sa" &&
      live.execServiceAccount?.automountServiceAccountToken === false &&
      execKsaAnnotationsAreIdentityLess(live.execServiceAccount?.metadata?.annotations),
    JSON.stringify(live.execServiceAccount ?? null)
  );
  check(
    checks,
    "exec-ksa-no-rbac",
    (live.execRoleBindings?.length ?? 0) === 0 && (live.execClusterRoleBindings?.length ?? 0) === 0,
    JSON.stringify({
      roleBindings: live.execRoleBindings ?? [],
      clusterRoleBindings: live.execClusterRoleBindings ?? []
    })
  );
  const runningExecPods = (live.execPods ?? []).filter((pod) => pod.phase === "Running");
  const controlledProbePods = runningExecPods.filter((pod) => isAdr146ControlledProbePod(pod));
  const realExecPods = selectRealExecPodsForKsaWiring(runningExecPods, live);
  check(
    checks,
    "exec-ksa-live-wiring",
    realExecPods.length > 0 &&
      realExecPods.every((pod) => isValidRealExecPodForKsaWiring(pod, live)),
    realExecPods.length === 0
      ? controlledProbePods.length > 0
        ? `zero Running non-probe sandbox-exec pods (${controlledProbePods.length} controlled probe(s) excluded); KSA object readiness is not live wiring proof`
        : "zero Running sandbox-exec pods; KSA object readiness is not live wiring proof"
      : JSON.stringify({
          realExecPods,
          excludedControlledProbes: controlledProbePods.map((pod) => pod.name)
        })
  );
  check(
    checks,
    "controlled-probe-pods-reported",
    true,
    JSON.stringify(
      (live.execPods ?? [])
        .filter((pod) => isAdr146ControlledProbePod(pod))
        .map((pod) => ({ name: pod.name, phase: pod.phase, labels: pod.labels ?? {} }))
    )
  );
  check(
    checks,
    "exec-networkpolicy-structural",
    execNetworkPolicyMatches(inventory, live.execNetworkPolicy),
    JSON.stringify(live.execNetworkPolicy ?? null)
  );
  check(
    checks,
    "legacy-exec-networkpolicy-absent",
    live.legacyExecNetworkPolicy == null,
    JSON.stringify(live.legacyExecNetworkPolicy ?? null)
  );
  check(
    checks,
    "proxy-networkpolicy-structural",
    proxyNetworkPolicyMatches(inventory, live.proxyNetworkPolicy),
    JSON.stringify(live.proxyNetworkPolicy ?? null)
  );
  check(
    checks,
    "nat-probe-networkpolicy-structural",
    natProbeNetworkPolicyMatches(inventory, live.natProbeNetworkPolicy),
    JSON.stringify(live.natProbeNetworkPolicy ?? null)
  );
  const metadataDaemon = live.metadataDaemonSet;
  check(
    checks,
    "gke-metadata-server-ready",
    metadataDaemon?.metadata?.name === inventory.cidrs.restrictedProbe.metadata.daemonSetName &&
      Number(metadataDaemon?.status?.desiredNumberScheduled) > 0 &&
      Number(metadataDaemon?.status?.numberReady) ===
        Number(metadataDaemon?.status?.desiredNumberScheduled),
    JSON.stringify(metadataDaemon?.status ?? null)
  );
  check(
    checks,
    "trusted-probe-control-available",
    (live.trustedProbePods ?? []).some((pod) => pod.phase === "Running"),
    JSON.stringify(live.trustedProbePods ?? [])
  );
  check(
    checks,
    "calico-readiness-is-not-enforcement-proof",
    true,
    "projectcalico.org/ds-ready and daemon readiness are rollout signals only; active probe-restricted remains required for enforcement proof"
  );
  check(
    checks,
    "dynamic-probes-not-claimed",
    live.dynamicProbesRun !== true,
    "Structural verify does not run or claim restricted positive/negative probes; use probe-restricted. Inbound/redirect/DNS-rebind remain unclaimed."
  );
  check(
    checks,
    "unclaimed-active-probes-documented",
    Array.isArray(inventory.cidrs.restrictedProbe.unclaimedActiveProbes) &&
      inventory.cidrs.restrictedProbe.unclaimedActiveProbes.length >= 3,
    JSON.stringify(inventory.cidrs.restrictedProbe.unclaimedActiveProbes ?? [])
  );
  return result(checks);
}

/**
 * Live kubectl JSON may omit `spec.ingress` when the submitted policy used
 * `ingress: []`. Absent/null is semantically empty deny-all ingress; any
 * present non-empty list is a widen and must fail closed.
 */
export function networkPolicyIngressIsEmpty(ingress) {
  return ingress == null || (Array.isArray(ingress) && ingress.length === 0);
}

/**
 * Identity-less exec KSA: zero annotations, or only known inert controller
 * bookkeeping keys. Rejects WIF/GCP identity and arbitrary annotations.
 */
export function execKsaAnnotationsAreIdentityLess(annotations) {
  const keys = Object.keys(annotations ?? {});
  return keys.every((key) => EXEC_KSA_INERT_ANNOTATION_KEYS.includes(key));
}

function execNetworkPolicyMatches(inventory, policy) {
  if (!policy) return false;
  const spec = policy.spec ?? {};
  const expectedDns = [
    inventory.network.dns.nodeLocalAddress,
    inventory.network.dns.kubeDnsServiceAddress
  ];
  const dnsRule = (spec.egress ?? []).find(
    (rule) =>
      exactIpBlockOnlyPeers(rule.to, expectedDns) &&
      portsMatch(rule.ports, inventory.network.dns.ports)
  );
  const proxyRule = (spec.egress ?? []).find(
    (rule) =>
      (rule.to ?? []).length === 1 &&
      exactPeerPodSelector(rule.to[0], {
        "app.kubernetes.io/name": "sandbox-egress-proxy"
      }) &&
      portsMatch(rule.ports, [{ protocol: "TCP", port: 3128 }])
  );
  return Boolean(
    policy.metadata?.name === "sandbox-exec-isolation" &&
    exactPodSelector(spec.podSelector, {
      "app.kubernetes.io/component": "sandbox-exec"
    }) &&
    sameSet(spec.policyTypes ?? [], ["Ingress", "Egress"]) &&
    networkPolicyIngressIsEmpty(spec.ingress) &&
    (spec.egress ?? []).length === 2 &&
    dnsRule &&
    proxyRule
  );
}

function proxyNetworkPolicyMatches(inventory, policy) {
  if (!policy) return false;
  const spec = policy.spec ?? {};
  const ingress = spec.ingress ?? [];
  const egress = spec.egress ?? [];
  const expectedDns = [
    inventory.network.dns.nodeLocalAddress,
    inventory.network.dns.kubeDnsServiceAddress
  ];
  const dnsRule = egress.find(
    (rule) =>
      exactIpBlockOnlyPeers(rule.to, expectedDns) &&
      portsMatch(rule.ports, inventory.network.dns.ports)
  );
  const publicRule = egress.find(
    (rule) =>
      rule.to?.length === 1 &&
      exactIpBlockPeer(rule.to[0], "0.0.0.0/0", buildRestrictedProxyDeniedCidrs(inventory)) &&
      portsMatch(rule.ports, [
        { protocol: "TCP", port: 80 },
        { protocol: "TCP", port: 443 }
      ])
  );
  return (
    policy.metadata?.name === "sandbox-egress-proxy-isolation" &&
    exactPodSelector(spec.podSelector, {
      "app.kubernetes.io/name": "sandbox-egress-proxy"
    }) &&
    sameSet(spec.policyTypes ?? [], ["Ingress", "Egress"]) &&
    ingress.length === 1 &&
    ingress[0]?.from?.length === 1 &&
    exactPeerPodSelector(ingress[0].from[0], {
      "app.kubernetes.io/component": "sandbox-exec"
    }) &&
    portsMatch(ingress[0].ports, [{ protocol: "TCP", port: 3128 }]) &&
    egress.length === 2 &&
    Boolean(dnsRule) &&
    Boolean(publicRule)
  );
}

function natProbeNetworkPolicyMatches(inventory, policy) {
  if (!policy) return false;
  const spec = policy.spec ?? {};
  const egress = spec.egress ?? [];
  const expectedDns = [
    inventory.network.dns.nodeLocalAddress,
    inventory.network.dns.kubeDnsServiceAddress
  ];
  const dnsRule = egress.find(
    (rule) =>
      exactIpBlockOnlyPeers(rule.to, expectedDns) &&
      portsMatch(rule.ports, inventory.network.dns.ports)
  );
  const publicRule = egress.find(
    (rule) =>
      rule.to?.length === 1 &&
      exactIpBlockPeer(rule.to[0], "0.0.0.0/0", buildRestrictedProxyDeniedCidrs(inventory)) &&
      portsMatch(rule.ports, [{ protocol: "TCP", port: 443 }])
  );
  return Boolean(
    policy.metadata?.name === "sandbox-nat-identity-probe-isolation" &&
    exactPodSelector(spec.podSelector, {
      "sandbox.gke.io/adr146-nat-probe": "true"
    }) &&
    sameSet(spec.policyTypes ?? [], ["Ingress", "Egress"]) &&
    networkPolicyIngressIsEmpty(spec.ingress) &&
    egress.length === 2 &&
    dnsRule &&
    publicRule
  );
}

export function exactIpBlockOnlyPeers(to, expectedCidrs) {
  if (!Array.isArray(to) || to.length !== expectedCidrs.length) return false;
  if (!sameSet(to.map((peer) => peer?.ipBlock?.cidr).filter(Boolean), expectedCidrs)) return false;
  return to.every((peer) => exactIpBlockPeer(peer, peer?.ipBlock?.cidr, null));
}

export function exactIpBlockPeer(peer, expectedCidr, expectedExcept) {
  if (!peer || typeof peer !== "object") return false;
  const keys = Object.keys(peer);
  if (keys.length !== 1 || keys[0] !== "ipBlock") return false;
  const block = peer.ipBlock;
  if (!block || typeof block !== "object") return false;
  const blockKeys = Object.keys(block);
  if (expectedExcept == null) {
    return blockKeys.length === 1 && blockKeys[0] === "cidr" && block.cidr === expectedCidr;
  }
  return (
    blockKeys.every((key) => key === "cidr" || key === "except") &&
    block.cidr === expectedCidr &&
    sameSet(block.except ?? [], expectedExcept)
  );
}

export function exactPeerPodSelector(peer, expectedMatchLabels) {
  if (!peer || typeof peer !== "object") return false;
  const keys = Object.keys(peer);
  if (keys.length !== 1 || keys[0] !== "podSelector") return false;
  return exactPodSelector(peer.podSelector, expectedMatchLabels);
}

export function exactPodSelector(selector, expectedMatchLabels) {
  if (selector == null || typeof selector !== "object") return false;
  const keys = Object.keys(selector);
  if (keys.length !== 1 || keys[0] !== "matchLabels") return false;
  return sameObject(selector.matchLabels ?? {}, expectedMatchLabels);
}

function portsMatch(actual = [], expected = []) {
  return sameSet(
    actual.map((entry) => `${entry.protocol}/${Number(entry.port)}`),
    expected.map((entry) => `${entry.protocol}/${Number(entry.port)}`)
  );
}

function evaluateCurrentCalicoReadiness(inventory, live) {
  const checks = [];
  const nodes = live.allNodes ?? [];
  const readyNodes = nodes.filter((node) => node.ready === true);
  const calicoNodes = nodes.filter((node) => node.calicoReady === true);
  check(checks, "all-nodes-present", nodes.length > 0, `count=${nodes.length}`);
  check(
    checks,
    "all-nodes-ready",
    nodes.length > 0 && readyNodes.length === nodes.length,
    `${readyNodes.length}/${nodes.length}`
  );
  check(
    checks,
    "all-nodes-calico-ready",
    nodes.length > 0 && calicoNodes.length === nodes.length,
    `${calicoNodes.length}/${nodes.length} label=${inventory.calico.readyNodeLabel}`
  );
  const calicoNodeDaemons = (live.calicoDaemonSets ?? []).filter(
    (daemon) => daemon.name === "calico-node"
  );
  check(
    checks,
    "calico-daemon-ready",
    calicoNodeDaemons.length === 1 &&
      calicoNodeDaemons[0].desired > 0 &&
      calicoNodeDaemons[0].current === calicoNodeDaemons[0].desired &&
      calicoNodeDaemons[0].ready === calicoNodeDaemons[0].desired,
    JSON.stringify(live.calicoDaemonSets ?? [])
  );
  return result(checks);
}

export function evaluateCalicoReadiness(inventory, live) {
  const checks = [...evaluateCurrentCalicoReadiness(inventory, live).checks];
  const nodes = live.allNodes ?? [];
  if ((live.preApplyNodeUids?.length ?? 0) > 0) {
    const currentUids = new Set(nodes.map((node) => node.uid));
    const stale = live.preApplyNodeUids.filter((uid) => currentUids.has(uid));
    check(checks, "nodes-recreated-after-calico-enable", stale.length === 0, JSON.stringify(stale));
  }
  return result(checks);
}

export function evaluatePublicPoolCordon(inventory, live) {
  const checks = [];
  const publicNodes = live.publicPoolNodes ?? [];
  const publicPoolPresent = live.publicPool != null || publicNodes.length > 0;
  check(
    checks,
    "legacy-public-pool-absent-or-nodes-present",
    !publicPoolPresent || publicNodes.length > 0,
    publicPoolPresent ? "public pool exists but no selectable nodes" : "absent"
  );
  check(
    checks,
    "legacy-public-pool-all-nodes-unschedulable",
    !publicPoolPresent ||
      (publicNodes.length > 0 && publicNodes.every((node) => node.unschedulable === true)),
    JSON.stringify(
      publicNodes.map((node) => ({ name: node.name, unschedulable: node.unschedulable }))
    )
  );
  check(
    checks,
    "cordon-does-not-require-killing-running-jobs",
    true,
    "cordon only blocks NEW scheduling; running exec pods are left undisturbed until maintenance retirement"
  );
  return result(checks);
}

export function evaluateRetirementGate(inventory, live, confirmation) {
  const checks = [];
  check(
    checks,
    "operator-maintenance-confirmation",
    confirmation === "NO_ACTIVE_SANDBOX_JOBS_CONFIRMED",
    confirmation ?? "missing"
  );
  const oldNodes = new Set((live.publicPoolNodes ?? []).map((node) => node.name));
  const oldExecPods = (live.execPods ?? []).filter((pod) => oldNodes.has(pod.nodeName));
  check(
    checks,
    "no-exec-pods-on-public-pool",
    oldExecPods.length === 0,
    JSON.stringify(oldExecPods)
  );
  check(
    checks,
    "private-pool-ready-before-retirement",
    privatePoolMatches(inventory, live.privatePool) &&
      (live.privatePoolNodes?.length ?? 0) > 0 &&
      live.privatePoolNodes.every((node) => node.ready && !node.externalIp),
    summarizePool(live.privatePool)
  );
  checks.push(...evaluatePublicPoolCordon(inventory, live).checks);
  return result(checks);
}

export function runStaticDeployTruth(inventory, extras = {}) {
  const checks = [];
  const errors = validateInventory(inventory);
  check(checks, "inventory-valid", errors.length === 0, errors.join("; ") || "valid");
  const denies = buildFirewallDenyDestinations(inventory);
  const forbidden = [
    ...inventory.cidrs.calicoOwnedDenies.nodeCidrs,
    ...inventory.cidrs.calicoOwnedDenies.podCidrs,
    ...inventory.cidrs.calicoOwnedDenies.serviceCidrs,
    ...inventory.cidrs.calicoOwnedDenies.metadataCidrs
  ];
  check(
    checks,
    "vpc-deny-excludes-calico-owned-paths",
    !denies.some((deny) => forbidden.some((cidr) => cidrContainsOrOverlaps(deny, cidr))),
    JSON.stringify(denies)
  );
  check(
    checks,
    "vpc-deny-all-protocols",
    sameSet(inventory.firewall.protocols, ["all"]),
    JSON.stringify(inventory.firewall.protocols)
  );
  const natCommand = buildPhasePlans(inventory)["apply-nat"].find(
    (entry) => entry.id === "create-nat"
  );
  check(
    checks,
    "nat-primary-plus-sandbox-secondary",
    natCommand?.argv.includes(
      `--nat-custom-subnet-ip-ranges=${inventory.network.subnetName},${inventory.network.subnetName}:${inventory.sandboxNodePool.podSecondaryRangeName}`
    ) &&
      !natCommand.argv.includes("--nat-all-subnet-ip-ranges") &&
      !natCommand.argv.some((argument) => /nonMasquerade|disable-default-snat/.test(argument)),
    JSON.stringify(natCommand?.argv ?? [])
  );
  check(
    checks,
    "release-gate-separated",
    inventory.releaseGate.verifyMustPassBeforeAppRollout === true &&
      inventory.releaseGate.structuralVerifyDoesNotRunDynamicProbes === true,
    "structural verify + active probe are distinct live gates"
  );
  check(
    checks,
    "release-gate-repository-enforced",
    inventory.releaseGate.repositoryEnforced === true &&
      inventory.releaseGate.noFeatureFlag === true &&
      inventory.releaseGate.mechanism === "dev-image-publish-split-pin" &&
      inventory.releaseGate.githubEnvironment === "persai-dev-adr146-foundation" &&
      inventory.releaseGate.deferredSlice == null &&
      Array.isArray(inventory.releaseGate.residuals) &&
      inventory.releaseGate.residuals.length >= 2 &&
      inventory.releaseGate.residuals.every(
        (entry) => typeof entry === "string" && entry.length > 0
      ),
    "repository split-pin gate is enforced; human Environment approval + live parent evidence remain residuals"
  );
  if (typeof extras.valuesDevText === "string") {
    check(
      checks,
      "helm-networkpolicy-rendering-enabled",
      /^\s*networkPolicy:\s*\n(?:.*\n)*?\s*enabled:\s*true\b/m.test(extras.valuesDevText),
      "values-dev networkPolicy.enabled must remain true"
    );
  }
  return result(checks);
}

function publicPoolMatches(inventory, pool) {
  if (!pool) return false;
  const expected = inventory.publicSandboxNodePool;
  return (
    pool.name === expected.name &&
    pool.config?.machineType === expected.machineType &&
    Number(pool.config?.diskSizeGb) === expected.diskSizeGb &&
    pool.config?.imageType === expected.imageType &&
    pool.config?.serviceAccount === expected.serviceAccount &&
    pool.networkConfig?.enablePrivateNodes === expected.enablePrivateNodes &&
    pool.autoscaling?.enabled === true &&
    Number(pool.autoscaling?.minNodeCount) === expected.minNodes &&
    Number(pool.autoscaling?.maxNodeCount) === expected.maxNodes &&
    includesObject(pool.config?.labels, expected.labels) &&
    hasExpectedTaint(pool.config?.taints ?? []) &&
    pool.networkConfig?.podRange === expected.podRange &&
    pool.networkConfig?.podIpv4CidrBlock === expected.podCidr
  );
}

export function privatePoolMatches(inventory, pool) {
  if (!pool) return false;
  const expected = inventory.sandboxNodePool;
  const { email } = nodeServiceAccountIdentity(inventory);
  const liveSandboxType = readLiveSandboxConfigType(pool);
  return (
    pool.name === expected.replacementName &&
    pool.config?.machineType === expected.machineType &&
    Number(pool.config?.diskSizeGb) === expected.diskSizeGb &&
    pool.config?.imageType === expected.imageType &&
    pool.config?.serviceAccount === email &&
    pool.networkConfig?.enablePrivateNodes === true &&
    pool.autoscaling?.enabled === true &&
    Number(pool.autoscaling?.minNodeCount) === expected.minNodes &&
    Number(pool.autoscaling?.maxNodeCount) === expected.maxNodes &&
    pool.networkConfig?.podRange === expected.podSecondaryRangeName &&
    pool.networkConfig?.podIpv4CidrBlock === inventory.cidrs.sandboxPodSecondary &&
    includesObject(pool.config?.labels, expected.labels) &&
    pool.config?.labels?.[GKE_MANAGED_SANDBOX_RUNTIME_KEY] === GKE_SANDBOX_TYPE_GVISOR &&
    pool.config?.labels?.workload === "sandbox" &&
    hasExpectedTaint(pool.config?.taints ?? []) &&
    isAcceptedGvisorSandboxType(expected.sandboxType) &&
    isAcceptedGvisorSandboxType(liveSandboxType) &&
    sameSet(pool.config?.tags ?? [], expected.networkTags) &&
    pool.config?.shieldedInstanceConfig?.enableSecureBoot === true &&
    pool.config?.shieldedInstanceConfig?.enableIntegrityMonitoring === true &&
    pool.config?.metadata?.["disable-legacy-endpoints"] === "true"
  );
}

/**
 * Fail-closed inventory contract for the NAT identity probe image.
 * Requires the exact digest-pinned official curl pin — tag-only, busybox,
 * wget, or any other drift is rejected.
 */
export function validateNatProbeImageInventory(image) {
  const errors = [];
  if (typeof image !== "string" || image.length === 0) {
    return ["restrictedProbe.natProbePod.image must be the exact digest-pinned curl image"];
  }
  if (image !== ADR146_NAT_PROBE_IMAGE) {
    errors.push(
      `restrictedProbe.natProbePod.image must be exactly ${ADR146_NAT_PROBE_IMAGE}, got ${image}`
    );
  }
  if (!/@sha256:[a-f0-9]{64}$/u.test(image)) {
    errors.push("restrictedProbe.natProbePod.image must be digest-pinned (@sha256:<64 hex>)");
  }
  if (/^busybox:/iu.test(image) || /wget/iu.test(image)) {
    errors.push(
      "restrictedProbe.natProbePod.image must not use busybox/wget (TLS certificate validation required)"
    );
  }
  return errors;
}

/**
 * Resolve the inventory-owned NAT probe image, failing closed on absence or drift.
 */
export function resolveNatProbeImage(inventory, options = {}) {
  const inventoryImage = inventory?.cidrs?.restrictedProbe?.natProbePod?.image;
  const inventoryErrors = validateNatProbeImageInventory(inventoryImage);
  if (inventoryErrors.length > 0) {
    throw new Error(`NAT probe image inventory invalid:\n- ${inventoryErrors.join("\n- ")}`);
  }
  if (options.image != null && options.image !== inventoryImage) {
    throw new Error(
      `NAT probe image override rejected: expected ${inventoryImage}, got ${options.image}`
    );
  }
  return inventoryImage;
}

/**
 * Inventory / Kubernetes Pod Toleration contract for gVisor runtime taint.
 * `operator` must be the exact API enum `Equal` — no case alias.
 */
export function validateRequiredGvisorTolerationShape(toleration) {
  const errors = [];
  if (!toleration || typeof toleration !== "object" || Array.isArray(toleration)) {
    return ["restrictedProbe.requiredGvisorToleration must be an object"];
  }
  const expectedFields = new Set(["key", "operator", "value", "effect"]);
  const unexpectedFields = Object.keys(toleration).filter((field) => !expectedFields.has(field));
  if (unexpectedFields.length > 0) {
    errors.push(
      `requiredGvisorToleration must contain only key/operator/value/effect; unexpected fields: ${unexpectedFields.join(", ")}`
    );
  }
  if (toleration.key !== GKE_MANAGED_SANDBOX_RUNTIME_KEY) {
    errors.push(
      `requiredGvisorToleration.key must be ${GKE_MANAGED_SANDBOX_RUNTIME_KEY}, got ${JSON.stringify(toleration.key)}`
    );
  }
  if (toleration.operator !== KUBERNETES_TOLERATION_OPERATOR_EQUAL) {
    errors.push(
      `requiredGvisorToleration.operator must be exactly "${KUBERNETES_TOLERATION_OPERATOR_EQUAL}" (Kubernetes API enum; lowercase/other casing rejected by apiserver), got ${JSON.stringify(toleration.operator)}`
    );
  }
  if (toleration.value !== GKE_SANDBOX_TYPE_GVISOR) {
    errors.push(
      `requiredGvisorToleration.value must be ${GKE_SANDBOX_TYPE_GVISOR}, got ${JSON.stringify(toleration.value)}`
    );
  }
  if (toleration.effect !== "NoSchedule") {
    errors.push(
      `requiredGvisorToleration.effect must be NoSchedule, got ${JSON.stringify(toleration.effect)}`
    );
  }
  return errors;
}

function tolerationHasExactFields(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const expectedFields = Object.keys(expected);
  const actualFields = Object.keys(actual);
  if (actualFields.length !== expectedFields.length) {
    return false;
  }
  return expectedFields.every((field) => actual[field] === expected[field]);
}

function validateExactTolerationEntry(toleration, expected, label) {
  const errors = [];
  if (!toleration || typeof toleration !== "object" || Array.isArray(toleration)) {
    return [`${label} must be an object`];
  }
  const expectedFields = Object.keys(expected);
  const actualFields = Object.keys(toleration);
  const unexpectedFields = actualFields.filter((field) => !expectedFields.includes(field));
  if (unexpectedFields.length > 0) {
    errors.push(
      `${label} must contain only ${expectedFields.join("/")}; unexpected fields: ${unexpectedFields.join(", ")}`
    );
  }
  for (const field of expectedFields) {
    if (toleration[field] !== expected[field]) {
      errors.push(
        `${label}.${field} must be ${JSON.stringify(expected[field])}, got ${JSON.stringify(toleration[field])}`
      );
    }
  }
  return errors;
}

function readPodTolerations(pod) {
  return pod?.spec?.tolerations ?? pod?.tolerations ?? [];
}

/**
 * Generated controlled probe manifests must carry exactly one explicit inventory
 * gVisor toleration. Rejects apiserver-rejected casings such as lowercase `"equal"`.
 */
export function validateControlledProbeGvisorToleration(pod, inventory) {
  const expected = inventory?.cidrs?.restrictedProbe?.requiredGvisorToleration;
  const shapeErrors = validateRequiredGvisorTolerationShape(expected);
  if (shapeErrors.length > 0) {
    return { ok: false, errors: shapeErrors };
  }
  const tolerations = readPodTolerations(pod);
  const errors = [];
  if (!Array.isArray(tolerations) || tolerations.length !== 1) {
    errors.push(
      `expected exactly one gVisor runtime toleration, got ${Array.isArray(tolerations) ? tolerations.length : "missing"}`
    );
    return { ok: false, errors };
  }
  errors.push(...validateExactTolerationEntry(tolerations[0], expected, "tolerations[0]"));
  return { ok: errors.length === 0, errors };
}

/**
 * Live API-admitted controlled probe Pods must carry exactly one canonical gVisor
 * toleration plus the exact two Kubernetes default injected tolerations and no others.
 */
export function validateLiveAdmittedProbeTolerations(pod, inventory) {
  const expectedGvisor = inventory?.cidrs?.restrictedProbe?.requiredGvisorToleration;
  const shapeErrors = validateRequiredGvisorTolerationShape(expectedGvisor);
  if (shapeErrors.length > 0) {
    return { ok: false, errors: shapeErrors };
  }
  const tolerations = readPodTolerations(pod);
  const errors = [];
  if (!Array.isArray(tolerations)) {
    errors.push("tolerations missing");
    return { ok: false, errors };
  }
  if (tolerations.length !== 3) {
    errors.push(
      `expected exactly three admitted Pod tolerations (one canonical gVisor + two Kubernetes default injected), got ${tolerations.length}`
    );
    return { ok: false, errors };
  }

  const permittedShapes = [
    expectedGvisor,
    KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_NOT_READY,
    KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_UNREACHABLE
  ];
  const matchedPermitted = new Set();

  for (let index = 0; index < tolerations.length; index += 1) {
    const toleration = tolerations[index];
    const matchingShapeIndexes = permittedShapes
      .map((shape, shapeIndex) => (tolerationHasExactFields(toleration, shape) ? shapeIndex : -1))
      .filter((shapeIndex) => shapeIndex >= 0);
    if (matchingShapeIndexes.length === 0) {
      const sameKeyShape = permittedShapes.find((shape) => shape.key === toleration?.key);
      if (sameKeyShape) {
        errors.push(
          ...validateExactTolerationEntry(toleration, sameKeyShape, `tolerations[${index}]`)
        );
      } else {
        errors.push(
          `tolerations[${index}] is not canonical gVisor or a permitted Kubernetes default injected toleration`
        );
      }
      continue;
    }
    if (matchingShapeIndexes.length > 1) {
      errors.push(`tolerations[${index}] matches multiple permitted toleration shapes`);
      continue;
    }
    const shapeIndex = matchingShapeIndexes[0];
    if (matchedPermitted.has(shapeIndex)) {
      errors.push(`duplicate admitted Pod toleration for ${permittedShapes[shapeIndex].key}`);
      continue;
    }
    matchedPermitted.add(shapeIndex);
    errors.push(
      ...validateExactTolerationEntry(
        toleration,
        permittedShapes[shapeIndex],
        `tolerations[${index}]`
      )
    );
  }

  if (!matchedPermitted.has(0)) {
    errors.push("missing canonical gVisor runtime toleration");
  }
  if (!matchedPermitted.has(1)) {
    errors.push(
      `missing Kubernetes default injected toleration ${KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_NOT_READY.key}`
    );
  }
  if (!matchedPermitted.has(2)) {
    errors.push(
      `missing Kubernetes default injected toleration ${KUBERNETES_DEFAULT_INJECTED_POD_TOLERATION_UNREACHABLE.key}`
    );
  }

  return { ok: errors.length === 0, errors };
}

export function validateRestrictedProbePod(pod, live, inventory) {
  const expected = inventory.cidrs.restrictedProbe.restrictedExecPod;
  const privateNodeNames = new Set((live.privatePoolNodes ?? []).map((node) => node.name));
  const errors = [];
  if (!pod) errors.push("pod missing");
  const phase = pod?.phase ?? pod?.status?.phase;
  if (phase !== "Running") errors.push(`phase=${phase ?? "missing"}`);
  const labels = pod?.labels ?? pod?.metadata?.labels ?? {};
  if (labels[ADR146_CONTROLLED_PROBE_LABEL] !== "true") {
    errors.push("missing exact controlled-probe label");
  }
  if (labels[expected.requiredComponentLabel] !== expected.requiredComponentLabelValue) {
    errors.push("missing exact sandbox-exec component label");
  }
  const nodeName = pod?.nodeName ?? pod?.spec?.nodeName;
  if (!privateNodeNames.has(nodeName)) errors.push("not on private-pool node");
  const serviceAccountName = pod?.serviceAccountName ?? pod?.spec?.serviceAccountName;
  if (serviceAccountName !== expected.serviceAccountName) {
    errors.push(`serviceAccountName=${serviceAccountName ?? "missing"}`);
  }
  const automount = pod?.automountServiceAccountToken ?? pod?.spec?.automountServiceAccountToken;
  if (automount !== false) errors.push("automount must be false");
  const runtimeClassName = pod?.runtimeClassName ?? pod?.spec?.runtimeClassName;
  if (runtimeClassName !== expected.runtimeClassName) {
    errors.push(`runtimeClassName=${runtimeClassName ?? "missing"}`);
  }
  const productionContour = resolveProductionRestrictedProbeContour(live);
  if (!productionContour.ok) {
    errors.push(...productionContour.errors);
  } else {
    const containers = pod?.spec?.containers ?? pod?.containers ?? [];
    const probeImage = containers[0]?.image;
    if (probeImage !== productionContour.image) {
      errors.push(
        `restricted probe image must equal current real exec image ${productionContour.image}, got ${probeImage ?? "missing"}`
      );
    }
    const probeEnv = containers[0]?.env ?? [];
    const probeEnvGate = validateExactRestrictedProxyEnv(probeEnv);
    if (probeEnvGate.length > 0) {
      errors.push(...probeEnvGate);
    } else if (!restrictedProxyEnvEqual(probeEnv, productionContour.env)) {
      errors.push(
        "restricted probe proxy env must exactly equal current real exec proxy/no_proxy six-entry set"
      );
    }
  }
  errors.push(...validateLiveAdmittedProbeTolerations(pod, inventory).errors);
  errors.push(...validateControlledProbeHardening(pod).errors);
  return { ok: errors.length === 0, errors };
}

export function validateNatProbePod(pod, live, inventory) {
  const expected = inventory.cidrs.restrictedProbe.natProbePod;
  const privateNodeNames = new Set((live.privatePoolNodes ?? []).map((node) => node.name));
  const errors = [];
  if (!pod) errors.push("pod missing");
  if (pod?.status?.phase !== "Running" && pod?.phase !== "Running") {
    errors.push(`phase=${pod?.status?.phase ?? pod?.phase ?? "missing"}`);
  }
  const labels = pod?.metadata?.labels ?? pod?.labels ?? {};
  if (labels[ADR146_CONTROLLED_PROBE_LABEL] !== "true") {
    errors.push("missing exact controlled-probe label");
  }
  if (labels[expected.requiredLabel] !== expected.requiredLabelValue) {
    errors.push("missing required nat probe label");
  }
  if (labels[expected.requiredComponentLabel] !== expected.requiredComponentLabelValue) {
    errors.push("missing exact sandbox-exec component label");
  }
  const nodeName = pod?.spec?.nodeName ?? pod?.nodeName;
  if (!privateNodeNames.has(nodeName)) errors.push("not on private-pool node");
  const serviceAccountName = pod?.spec?.serviceAccountName ?? pod?.serviceAccountName;
  if (serviceAccountName !== expected.serviceAccountName) {
    errors.push(`serviceAccountName=${serviceAccountName ?? "missing"}`);
  }
  const automount = pod?.spec?.automountServiceAccountToken ?? pod?.automountServiceAccountToken;
  if (automount !== false) errors.push("automount must be false");
  const runtimeClassName = pod?.spec?.runtimeClassName ?? pod?.runtimeClassName;
  if (runtimeClassName !== expected.runtimeClassName) {
    errors.push(`runtimeClassName=${runtimeClassName ?? "missing"}`);
  }
  const containers = pod?.spec?.containers ?? pod?.containers ?? [];
  const env = containers[0]?.env ?? [];
  const hasProxyEnv = Array.isArray(env)
    ? env.some((entry) => ADR146_RESTRICTED_PROXY_ENV_NAMES.includes(entry?.name))
    : false;
  if (hasProxyEnv) errors.push("proxy env must be absent");
  if (Array.isArray(env) && env.length > 0) {
    errors.push("NAT probe env must be empty (zero proxy/no_proxy entries)");
  }
  const containerImage = containers[0]?.image;
  if (containerImage !== expected.image) {
    errors.push(
      `NAT probe image must be exactly ${expected.image}, got ${containerImage ?? "missing"}`
    );
  }
  errors.push(...validateNatProbeImageInventory(expected.image));
  errors.push(...validateLiveAdmittedProbeTolerations(pod, inventory).errors);
  errors.push(...validateControlledProbeHardening(pod).errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Hardening required of controlled ADR-146 probe Pods (both restricted + NAT).
 * Bound deadline, finite sleep command, pod/container security, resource requests/limits.
 */
export function validateControlledProbeHardening(pod) {
  const errors = [];
  const spec = pod?.spec ?? {};
  const activeDeadlineSeconds = pod?.activeDeadlineSeconds ?? spec.activeDeadlineSeconds ?? null;
  if (
    typeof activeDeadlineSeconds !== "number" ||
    !Number.isFinite(activeDeadlineSeconds) ||
    activeDeadlineSeconds <= 0 ||
    activeDeadlineSeconds > ADR146_PROBE_ACTIVE_DEADLINE_SECONDS
  ) {
    errors.push(
      `activeDeadlineSeconds must be 1..${ADR146_PROBE_ACTIVE_DEADLINE_SECONDS}, got ${activeDeadlineSeconds}`
    );
  }

  const containers = spec.containers ?? pod?.containers ?? [];
  if (containers.length !== 1) {
    errors.push(`expected exactly one container, got ${containers.length}`);
  }
  const container = containers[0] ?? {};
  const command = container.command ?? [];
  if (
    !Array.isArray(command) ||
    command.length !== 2 ||
    command[0] !== "sleep" ||
    !/^[1-9][0-9]*$/u.test(String(command[1])) ||
    Number(command[1]) > ADR146_PROBE_ACTIVE_DEADLINE_SECONDS
  ) {
    errors.push(
      `command must be finite ["sleep","<=${ADR146_PROBE_ACTIVE_DEADLINE_SECONDS}"], got ${JSON.stringify(command)}`
    );
  }

  const podSecurity = spec.securityContext ?? pod?.securityContext ?? {};
  if (podSecurity.runAsNonRoot !== true) errors.push("pod runAsNonRoot must be true");
  if (podSecurity.runAsUser !== 1000) errors.push("pod runAsUser must be 1000");
  if (podSecurity.runAsGroup !== 1000) errors.push("pod runAsGroup must be 1000");
  if (podSecurity.fsGroup !== 1000) errors.push("pod fsGroup must be 1000");
  if (podSecurity.seccompProfile?.type !== "RuntimeDefault") {
    errors.push("pod seccompProfile must be RuntimeDefault");
  }

  const containerSecurity = container.securityContext ?? {};
  if (containerSecurity.allowPrivilegeEscalation !== false) {
    errors.push("container allowPrivilegeEscalation must be false");
  }
  if (containerSecurity.readOnlyRootFilesystem !== true) {
    errors.push("container readOnlyRootFilesystem must be true");
  }
  const capabilities = containerSecurity.capabilities ?? {};
  const added = capabilities.add;
  if (Array.isArray(added) ? added.length > 0 : added != null) {
    errors.push("container capabilities.add must be absent or empty");
  }
  const dropped = capabilities.drop ?? [];
  if (!Array.isArray(dropped) || dropped.length !== 1 || dropped[0] !== "ALL") {
    errors.push('container capabilities.drop must be exactly ["ALL"]');
  }
  if (containerSecurity.seccompProfile?.type !== "RuntimeDefault") {
    errors.push("container seccompProfile must be RuntimeDefault");
  }

  const resources = container.resources ?? {};
  const requests = resources.requests ?? {};
  const limits = resources.limits ?? {};
  if (requests.cpu !== ADR146_PROBE_RESOURCES.requests.cpu) {
    errors.push(
      `container requests.cpu must be exactly ${ADR146_PROBE_RESOURCES.requests.cpu}, got ${requests.cpu ?? "missing"}`
    );
  }
  if (requests.memory !== ADR146_PROBE_RESOURCES.requests.memory) {
    errors.push(
      `container requests.memory must be exactly ${ADR146_PROBE_RESOURCES.requests.memory}, got ${requests.memory ?? "missing"}`
    );
  }
  if (limits.cpu !== ADR146_PROBE_RESOURCES.limits.cpu) {
    errors.push(
      `container limits.cpu must be exactly ${ADR146_PROBE_RESOURCES.limits.cpu}, got ${limits.cpu ?? "missing"}`
    );
  }
  if (limits.memory !== ADR146_PROBE_RESOURCES.limits.memory) {
    errors.push(
      `container limits.memory must be exactly ${ADR146_PROBE_RESOURCES.limits.memory}, got ${limits.memory ?? "missing"}`
    );
  }

  return { ok: errors.length === 0, errors };
}

export function isAdr146ControlledProbePod(pod) {
  const labels = pod?.labels ?? pod?.metadata?.labels ?? {};
  return labels[ADR146_CONTROLLED_PROBE_LABEL] === "true";
}

export function isValidRealExecPodForKsaWiring(pod, live = {}) {
  if (!pod || pod.phase !== "Running") return false;
  if (isAdr146ControlledProbePod(pod)) return false;
  if (pod.serviceAccountName !== "sandbox-exec-sa") return false;
  if (pod.automountServiceAccountToken !== false) return false;
  if (pod.runtimeClassName !== "gvisor") return false;
  if (pod.labels?.["app.kubernetes.io/component"] !== "sandbox-exec") return false;
  const privateNodeNames = new Set((live.privatePoolNodes ?? []).map((node) => node.name));
  if (privateNodeNames.size > 0 && pod.nodeName && !privateNodeNames.has(pod.nodeName)) {
    return false;
  }
  return true;
}

/**
 * Real production exec pods for KSA live-wiring — never controlled probes.
 */
export function selectRealExecPodsForKsaWiring(pods, live = {}) {
  return (pods ?? []).filter((pod) => pod.phase === "Running" && !isAdr146ControlledProbePod(pod));
}

/**
 * Exact current production restricted-probe contour evidence: image + proxy env.
 * Only valid non-controlled Running exec Pods used by KSA live-wiring count.
 * Returns a single consistent {image, env} or fail-closed errors.
 */
export function resolveProductionRestrictedProbeContour(live = {}) {
  const realExecPods = selectRealExecPodsForKsaWiring(live.execPods ?? [], live);
  if (realExecPods.length === 0) {
    return {
      ok: false,
      image: null,
      env: null,
      errors: ["zero valid Running non-controlled sandbox-exec pods; image equality unprovable"]
    };
  }
  const images = [];
  const envFingerprints = [];
  const envs = [];
  const errors = [];
  for (const pod of realExecPods) {
    const labels = pod?.labels ?? pod?.metadata?.labels ?? {};
    if (Object.hasOwn(labels, ADR146_CONTROLLED_PROBE_LABEL)) {
      errors.push(
        `real exec pod ${pod.name ?? "unknown"} carries controlled-probe label and cannot prove production image`
      );
      continue;
    }
    if (!isValidRealExecPodForKsaWiring(pod, live)) {
      errors.push(
        `real exec pod ${pod.name ?? "unknown"} does not satisfy KSA live-wiring contour`
      );
      continue;
    }
    const containers = pod?.spec?.containers ?? pod?.containers ?? [];
    const execContainers = containers.filter((container) => container?.name === "exec");
    if (execContainers.length !== 1 || typeof execContainers[0]?.image !== "string") {
      errors.push(
        `real exec pod ${pod.name ?? "unknown"} must expose exactly one named exec container image`
      );
      continue;
    }
    const extracted = extractExactRestrictedProxyEnv(execContainers[0].env ?? []);
    if (!extracted.ok) {
      errors.push(
        `real exec pod ${pod.name ?? "unknown"} proxy env invalid: ${extracted.errors.join("; ")}`
      );
      continue;
    }
    images.push(execContainers[0].image);
    envs.push(extracted.env);
    envFingerprints.push(restrictedProxyEnvFingerprint(extracted.env));
  }
  if (errors.length > 0) return { ok: false, image: null, env: null, errors };
  const uniqueImages = [...new Set(images)];
  if (uniqueImages.length !== 1) {
    return {
      ok: false,
      image: null,
      env: null,
      errors: [
        `conflicting current real exec images: ${uniqueImages.length > 0 ? uniqueImages.join(", ") : "none"}`
      ]
    };
  }
  const uniqueEnvFingerprints = [...new Set(envFingerprints)];
  if (uniqueEnvFingerprints.length !== 1) {
    return {
      ok: false,
      image: null,
      env: null,
      errors: [`conflicting current real exec proxy env sets across ${envFingerprints.length} pods`]
    };
  }
  return { ok: true, image: uniqueImages[0], env: envs[0], errors: [] };
}

/**
 * Exact current production image evidence for restricted controlled probes.
 * Derived from {@link resolveProductionRestrictedProbeContour}.
 */
export function resolveRealExecImageForRestrictedProbe(live = {}) {
  const contour = resolveProductionRestrictedProbeContour(live);
  if (!contour.ok) {
    return { ok: false, errors: contour.errors };
  }
  return { ok: true, image: contour.image, errors: [] };
}

/**
 * Bounded cleanup targets: exact known probe names AND/OR exact controlled-probe label.
 * Never selects unlabeled production exec pods.
 */
export function listControlledProbeCleanupTargets(pods, options = {}) {
  const exactNames = new Set(options.exactNames ?? ADR146_CONTROLLED_PROBE_POD_NAMES);
  return (pods ?? []).filter((pod) => {
    if (isAdr146ControlledProbePod(pod)) return true;
    return exactNames.has(pod?.name);
  });
}

export function buildControlledProbeCleanupPlan(pods, options = {}) {
  const namespace = options.namespace ?? "persai-dev";
  const targets = listControlledProbeCleanupTargets(pods, options);
  return {
    namespace,
    labelSelector: `${ADR146_CONTROLLED_PROBE_LABEL}=true`,
    exactNames: [...(options.exactNames ?? ADR146_CONTROLLED_PROBE_POD_NAMES)],
    targets: targets.map((pod) => ({
      name: pod.name,
      phase: pod.phase,
      labels: pod.labels ?? pod.metadata?.labels ?? {}
    })),
    argvByName: targets.map((pod) => [
      "kubectl",
      "delete",
      "pod",
      pod.name,
      "-n",
      namespace,
      "--ignore-not-found=true"
    ]),
    labelDeleteArgv: [
      "kubectl",
      "delete",
      "pod",
      "-n",
      namespace,
      "-l",
      `${ADR146_CONTROLLED_PROBE_LABEL}=true`,
      "--ignore-not-found=true"
    ]
  };
}

/**
 * Validate bounded curl `-w "%{http_code}"` output for Squid ACL denial.
 * Passes only on exact HTTP 403; "000", empty, malformed, and other statuses fail closed.
 * Does not inspect response bodies, headers, query strings, or auth material.
 */
export function squidDenialHttpStatusIndicatesProxyDeny(httpStatusOutput) {
  const trimmed = String(httpStatusOutput ?? "").trim();
  if (!/^[0-9]{3}$/.test(trimmed)) return false;
  return trimmed === "403";
}

function natMatches(inventory, nat) {
  if (!nat) return false;
  const subnetworks = nat.subnetworks ?? [];
  const expectedRange = inventory.sandboxNodePool.podSecondaryRangeName;
  return (
    nat.name === inventory.nat.natName &&
    nat.natIpAllocateOption === "MANUAL_ONLY" &&
    nat.sourceSubnetworkIpRangesToNat === "LIST_OF_SUBNETWORKS" &&
    subnetworks.length === 1 &&
    basenameRef(subnetworks[0]?.name) === inventory.network.subnetName &&
    sameSet(subnetworks[0]?.sourceIpRangesToNat ?? [], [
      "PRIMARY_IP_RANGE",
      "LIST_OF_SECONDARY_IP_RANGES"
    ]) &&
    sameSet(subnetworks[0]?.secondaryIpRangeNames ?? [], [expectedRange]) &&
    nat.logConfig?.enable === true &&
    nat.logConfig?.filter === inventory.nat.logFilter &&
    Number(nat.minPortsPerVm) === inventory.nat.minPortsPerVm &&
    (nat.natIps?.length ?? 0) === inventory.nat.staticAddressCount &&
    nat.natIps.every((ref, index) => basenameRef(ref) === natAddressName(inventory, index))
  );
}

function subnetFlowLogsMatch(inventory, subnet) {
  return (
    subnet?.enableFlowLogs === true &&
    subnet.logConfig?.aggregationInterval === inventory.network.flowLogs.aggregationInterval &&
    Number(subnet.logConfig?.flowSampling) === Number(inventory.network.flowLogs.flowSampling) &&
    subnet.logConfig?.metadata === inventory.network.flowLogs.metadata
  );
}

function firewallMatches(inventory, firewall) {
  if (!firewall) return false;
  const denied = buildFirewallDenyDestinations(inventory);
  return (
    firewall.name === inventory.firewall.denyEgressRuleName &&
    basenameRef(firewall.network) === inventory.network.vpcName &&
    firewall.direction === inventory.firewall.direction &&
    firewall.disabled !== true &&
    Number(firewall.priority) === inventory.firewall.priority &&
    firewall.denied?.length === 1 &&
    sameSet(firewall.denied[0]?.IPProtocol === "all" ? ["all"] : [], ["all"]) &&
    sameSet(firewall.destinationRanges ?? [], denied) &&
    sameSet(firewall.targetTags ?? [], [inventory.firewall.networkTag])
  );
}

function extractRolesForMember(policy, member) {
  return (policy?.bindings ?? [])
    .filter((binding) => (binding.members ?? []).includes(member))
    .map((binding) => String(binding.role));
}

function includesObject(actual = {}, expected = {}) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function sameObject(left, right) {
  return JSON.stringify(sortObject(left)) === JSON.stringify(sortObject(right));
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

function sameSet(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function basenameRef(value) {
  const parts = String(value ?? "").split("/");
  return parts.at(-1) ?? "";
}

function summarizePool(pool) {
  if (!pool) return "absent";
  return JSON.stringify({
    name: pool.name,
    sa: pool.config?.serviceAccount,
    private: pool.networkConfig?.enablePrivateNodes,
    podRange: pool.networkConfig?.podRange,
    sandboxConfig: pool.config?.sandboxConfig ?? null,
    labels: pool.config?.labels,
    tags: pool.config?.tags,
    taints: pool.config?.taints
  });
}

function check(checks, id, ok, detail = "") {
  checks.push({ id, ok: Boolean(ok), detail: String(detail ?? "") });
}

function result(checks) {
  return { ok: checks.every((entry) => entry.ok), checks };
}

export function renderPlanText(inventory, evidence = null) {
  const phases = buildPhasePlans(inventory);
  const binding = evidence ?? buildEvidenceBinding();
  const lines = [
    "ADR-146 Slice 0.1 foundation plan",
    `cluster=${inventory.cluster.name} project=${inventory.cluster.projectId} location=${inventory.cluster.location}`,
    `network=${inventory.network.vpcName} subnet=${inventory.network.subnetName}`,
    `evidence.gitCommitSha=${binding.gitCommitSha}`,
    `evidence.inventorySha256=${binding.inventorySha256}`,
    `evidence.inventoryPath=${binding.inventoryPath}`,
    "",
    "Every mutating --execute phase runs a fresh fail-closed live preflight first.",
    "Existing resources skip only on exact configuration; drift fails with remediation guidance.",
    "VPC deny excludes own node-primary, Pod, Service, and metadata CIDRs; mandatory Calico owns those paths.",
    "Default GKE public SNAT uses node primary IPs; Cloud NAT selects subnet primary plus sandbox Pod secondary.",
    "Static NAT attribution is currently exclusive only while all eligible no-external-IP consumers verify as private sandbox nodes.",
    "Private pool create uses --sandbox=type=gvisor and operator-owned workload=sandbox only; do not manually set GKE-managed sandbox.gke.io/runtime in --node-labels or --node-taints (GKE rejects both). Resulting managed label + taint + sandboxConfig remain live matcher requirements.",
    "After private pool Ready, apply-sandbox-pool cordons the legacy public pool to close the dual-pool scheduling window without deleting it or killing running jobs.",
    "Structural verify never claims dynamic restricted probes or Calico label readiness as enforcement proof; probe-restricted is separate.",
    "Inbound denial, HTTP redirect, and DNS-rebind remain unclaimed by probe-restricted.",
    "Public pool retirement requires explicit maintenance confirmation and zero exec pods on old nodes.",
    "Repository release gate: sandbox-only image pin first; remaining pins wait on ordered GitHub Environment approvals (foundation, then migrations when both apply).",
    "CI never auto-applies foundation mutations; live operator apply remains explicit.",
    ""
  ];
  for (const [phase, commands] of Object.entries(phases)) {
    lines.push(`## ${phase}`);
    for (const item of commands) {
      lines.push(`- ${item.description}`);
      lines.push(`  $ ${shellJoin(item.argv)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Bind plan/verify evidence to the exact git commit and inventory bytes.
 * Fail closed on dirty trees, unavailable git, or disk≠commit inventory mismatch.
 * Does not embed secrets; only SHA-256 of the committed inventory JSON.
 *
 * @param {string} [inventoryPath]
 * @param {{
 *   repoRoot?: string,
 *   execGit?: (args: string[], options?: object) => string | Buffer,
 *   readFile?: (path: string) => Buffer
 * }} [deps] dependency injection for unit tests (temp git repos); not a production bypass.
 */
export function buildEvidenceBinding(inventoryPath = DEFAULT_INVENTORY_PATH, deps = {}) {
  const repoRoot = deps.repoRoot ?? LIB_REPO_ROOT;
  const execGit =
    deps.execGit ??
    ((args, options = {}) =>
      execFileSync("git", args, {
        cwd: repoRoot,
        encoding: options.encoding === "buffer" ? undefined : (options.encoding ?? "utf8"),
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: options.maxBuffer
      }));
  const readFile = deps.readFile ?? ((filePath) => readFileSync(filePath));

  const absoluteInventoryPath = path.resolve(inventoryPath);
  const inventoryRelPath = path.relative(repoRoot, absoluteInventoryPath).replace(/\\/gu, "/");

  let statusText;
  try {
    statusText = String(
      execGit(["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" })
    );
  } catch (error) {
    throw new Error(
      `ADR-146 evidence binding fail-closed: git status unavailable (${error?.message ?? error})`
    );
  }

  const dirtyEntries = statusText
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (dirtyEntries.length > 0) {
    throw new Error(
      `ADR-146 evidence binding fail-closed: dirty git working tree (${dirtyEntries
        .slice(0, 8)
        .join("; ")})`
    );
  }

  let gitCommitSha;
  try {
    gitCommitSha = String(execGit(["rev-parse", "HEAD"], { encoding: "utf8" })).trim();
  } catch (error) {
    throw new Error(
      `ADR-146 evidence binding fail-closed: unable to resolve HEAD SHA (${error?.message ?? error})`
    );
  }
  if (!/^[0-9a-f]{40}$/iu.test(gitCommitSha)) {
    throw new Error(
      `ADR-146 evidence binding fail-closed: HEAD SHA must be full 40-hex, got ${gitCommitSha}`
    );
  }

  let committedBytes;
  try {
    committedBytes = execGit(["show", `${gitCommitSha}:${inventoryRelPath}`], {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024
    });
    if (!Buffer.isBuffer(committedBytes)) {
      committedBytes = Buffer.from(String(committedBytes), "utf8");
    }
  } catch (error) {
    throw new Error(
      `ADR-146 evidence binding fail-closed: unable to read committed inventory blob ${gitCommitSha}:${inventoryRelPath} (${error?.message ?? error})`
    );
  }

  const diskBytes = Buffer.from(readFile(absoluteInventoryPath));
  if (!diskBytes.equals(committedBytes)) {
    throw new Error(
      `ADR-146 evidence binding fail-closed: on-disk inventory does not match committed blob at ${gitCommitSha}:${inventoryRelPath}`
    );
  }

  const inventorySha256 = createHash("sha256").update(committedBytes).digest("hex");
  return {
    gitCommitSha,
    inventorySha256,
    inventoryPath: inventoryRelPath
  };
}

function buildProbeSecurityAndResources(commandSeconds = ADR146_PROBE_ACTIVE_DEADLINE_SECONDS) {
  return {
    activeDeadlineSeconds: commandSeconds,
    securityContext: {
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
      seccompProfile: {
        type: "RuntimeDefault"
      }
    },
    containerSecurityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: {
        drop: ["ALL"]
      },
      seccompProfile: {
        type: "RuntimeDefault"
      }
    },
    resources: {
      requests: { ...ADR146_PROBE_RESOURCES.requests },
      limits: { ...ADR146_PROBE_RESOURCES.limits }
    },
    command: ["sleep", String(commandSeconds)]
  };
}

/**
 * Controlled restricted probe Pod manifest. The caller must supply the exact
 * production sandbox-exec image and exact six-entry proxy env resolved from
 * committed values-dev truth. No empty/default env fallback.
 */
export function buildRestrictedProbePodManifest(inventory, options = {}) {
  const expected = inventory.cidrs.restrictedProbe.restrictedExecPod;
  const gvisorToleration = inventory.cidrs.restrictedProbe.requiredGvisorToleration;
  const namespace =
    options.namespace ?? inventory.cidrs.restrictedProbe.natProbePod.namespace ?? "persai-dev";
  const name = options.name ?? "adr146-restricted-probe";
  const image = options.image;
  if (typeof image !== "string" || image.length === 0) {
    throw new Error(
      "restricted probe image required: resolve exact sandbox-exec image from committed values-dev.yaml"
    );
  }
  const env = options.env;
  const envErrors = validateExactRestrictedProxyEnv(env);
  if (envErrors.length > 0) {
    throw new Error(
      `restricted probe proxy env required: resolve exact sandbox.env proxy/no_proxy from committed values-dev.yaml:\n- ${envErrors.join("\n- ")}`
    );
  }
  const hardened = buildProbeSecurityAndResources(
    options.activeDeadlineSeconds ?? ADR146_PROBE_ACTIVE_DEADLINE_SECONDS
  );
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace,
      labels: {
        "app.kubernetes.io/name": "exec-pod",
        [expected.requiredComponentLabel]: expected.requiredComponentLabelValue,
        [ADR146_CONTROLLED_PROBE_LABEL]: "true"
      }
    },
    spec: {
      runtimeClassName: expected.runtimeClassName,
      serviceAccountName: expected.serviceAccountName,
      automountServiceAccountToken: false,
      restartPolicy: "Never",
      activeDeadlineSeconds: hardened.activeDeadlineSeconds,
      nodeSelector: {
        workload: "sandbox"
      },
      tolerations: [{ ...gvisorToleration }],
      securityContext: hardened.securityContext,
      containers: [
        {
          name: "probe",
          image,
          command: hardened.command,
          env: env.map((entry) => ({ name: entry.name, value: entry.value })),
          securityContext: hardened.containerSecurityContext,
          resources: hardened.resources
        }
      ]
    }
  };
}

/**
 * Controlled NAT identity probe Pod manifest that satisfies validateNatProbePod.
 * Image is inventory-owned digest-pinned curl (TLS verification). No HTTP(S)_PROXY
 * env. Never embeds secrets. Plain Pods require operator deletion.
 */
export function buildNatProbePodManifest(inventory, options = {}) {
  const expected = inventory.cidrs.restrictedProbe.natProbePod;
  const gvisorToleration = inventory.cidrs.restrictedProbe.requiredGvisorToleration;
  const name = options.name ?? "adr146-nat-probe";
  const image = resolveNatProbeImage(inventory, options);
  const hardened = buildProbeSecurityAndResources(
    options.activeDeadlineSeconds ?? ADR146_PROBE_ACTIVE_DEADLINE_SECONDS
  );
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: expected.namespace,
      labels: {
        "app.kubernetes.io/name": "exec-pod",
        [expected.requiredComponentLabel]: expected.requiredComponentLabelValue,
        [expected.requiredLabel]: expected.requiredLabelValue,
        [ADR146_CONTROLLED_PROBE_LABEL]: "true"
      }
    },
    spec: {
      runtimeClassName: expected.runtimeClassName,
      serviceAccountName: expected.serviceAccountName,
      automountServiceAccountToken: false,
      restartPolicy: "Never",
      activeDeadlineSeconds: hardened.activeDeadlineSeconds,
      nodeSelector: {
        workload: "sandbox"
      },
      tolerations: [{ ...gvisorToleration }],
      securityContext: hardened.securityContext,
      containers: [
        {
          name: "probe",
          image,
          command: hardened.command,
          env: [],
          securityContext: hardened.containerSecurityContext,
          resources: hardened.resources
        }
      ]
    }
  };
}

/**
 * Normalize a kubectl Pod list item into the exec-pod shape used by live
 * collectors and validators. Preserves exact live `spec.tolerations` so
 * controlled-probe contour checks see admitted Pod truth.
 */
export function mapExecPodFromKubectlItem(pod) {
  const tolerations = pod.spec?.tolerations;
  return {
    name: pod.metadata?.name,
    phase: pod.status?.phase,
    nodeName: pod.spec?.nodeName,
    serviceAccountName: pod.spec?.serviceAccountName,
    automountServiceAccountToken: pod.spec?.automountServiceAccountToken,
    runtimeClassName: pod.spec?.runtimeClassName,
    activeDeadlineSeconds: pod.spec?.activeDeadlineSeconds ?? null,
    labels: pod.metadata?.labels ?? {},
    metadata: { labels: pod.metadata?.labels ?? {} },
    status: { phase: pod.status?.phase },
    tolerations,
    spec: {
      nodeName: pod.spec?.nodeName,
      serviceAccountName: pod.spec?.serviceAccountName,
      automountServiceAccountToken: pod.spec?.automountServiceAccountToken,
      runtimeClassName: pod.spec?.runtimeClassName,
      activeDeadlineSeconds: pod.spec?.activeDeadlineSeconds ?? null,
      securityContext: pod.spec?.securityContext ?? {},
      tolerations,
      containers: pod.spec?.containers ?? []
    },
    securityContext: pod.spec?.securityContext ?? {},
    containers: pod.spec?.containers ?? [],
    podIP: pod.status?.podIP ?? null
  };
}

/** Flatten a generated Pod manifest into the shape used by live validators. */
export function probeManifestToValidatorPod(
  manifest,
  { nodeName = "private-node", phase = "Running" } = {}
) {
  return {
    name: manifest.metadata.name,
    phase,
    nodeName,
    serviceAccountName: manifest.spec.serviceAccountName,
    automountServiceAccountToken: manifest.spec.automountServiceAccountToken,
    runtimeClassName: manifest.spec.runtimeClassName,
    activeDeadlineSeconds: manifest.spec.activeDeadlineSeconds,
    labels: manifest.metadata.labels,
    metadata: { labels: manifest.metadata.labels },
    status: { phase },
    securityContext: manifest.spec.securityContext,
    tolerations: manifest.spec.tolerations,
    spec: {
      nodeName,
      serviceAccountName: manifest.spec.serviceAccountName,
      automountServiceAccountToken: manifest.spec.automountServiceAccountToken,
      runtimeClassName: manifest.spec.runtimeClassName,
      activeDeadlineSeconds: manifest.spec.activeDeadlineSeconds,
      securityContext: manifest.spec.securityContext,
      tolerations: manifest.spec.tolerations,
      containers: manifest.spec.containers
    },
    containers: manifest.spec.containers
  };
}

export function renderProbeManifestYaml(manifest) {
  // Minimal deterministic YAML without pulling a YAML dependency or embedding secrets.
  const tolerations = manifest?.spec?.tolerations;
  if (!Array.isArray(tolerations) || tolerations.length !== 1) {
    throw new Error(
      `cannot render controlled probe manifest: expected exactly one gVisor runtime toleration, got ${Array.isArray(tolerations) ? tolerations.length : "missing"}`
    );
  }
  const tolerationErrors = validateRequiredGvisorTolerationShape(tolerations[0]);
  if (tolerationErrors.length > 0) {
    throw new Error(
      `cannot render controlled probe manifest: invalid canonical gVisor toleration:\n- ${tolerationErrors.join("\n- ")}`
    );
  }
  const toleration = tolerations[0];
  const labels = Object.entries(manifest.metadata.labels)
    .map(([key, value]) => `    ${key}: ${JSON.stringify(String(value))}`)
    .join("\n");
  const container = manifest.spec.containers[0];
  const env =
    (container.env ?? []).length === 0
      ? "      env: []"
      : `      env:\n${container.env
          .map(
            (entry) =>
              `        - name: ${entry.name}\n          value: ${JSON.stringify(entry.value ?? "")}`
          )
          .join("\n")}`;
  const commandJson = JSON.stringify(container.command ?? ["sleep", "600"]);
  const resources = container.resources ?? {
    requests: { ...ADR146_PROBE_RESOURCES.requests },
    limits: { ...ADR146_PROBE_RESOURCES.limits }
  };
  const podSecurity = manifest.spec.securityContext ?? {};
  const containerSecurity = container.securityContext ?? {};
  return [
    "apiVersion: v1",
    "kind: Pod",
    "metadata:",
    `  name: ${manifest.metadata.name}`,
    `  namespace: ${manifest.metadata.namespace}`,
    "  labels:",
    labels,
    "spec:",
    `  runtimeClassName: ${manifest.spec.runtimeClassName}`,
    `  serviceAccountName: ${manifest.spec.serviceAccountName}`,
    "  automountServiceAccountToken: false",
    "  restartPolicy: Never",
    `  activeDeadlineSeconds: ${manifest.spec.activeDeadlineSeconds ?? ADR146_PROBE_ACTIVE_DEADLINE_SECONDS}`,
    "  nodeSelector:",
    '    workload: "sandbox"',
    "  tolerations:",
    `    - key: ${toleration.key}`,
    `      operator: ${toleration.operator}`,
    `      value: ${JSON.stringify(String(toleration.value))}`,
    `      effect: ${toleration.effect}`,
    "  securityContext:",
    `    runAsNonRoot: ${podSecurity.runAsNonRoot === true}`,
    `    runAsUser: ${podSecurity.runAsUser ?? 1000}`,
    `    runAsGroup: ${podSecurity.runAsGroup ?? 1000}`,
    `    fsGroup: ${podSecurity.fsGroup ?? 1000}`,
    "    seccompProfile:",
    `      type: ${podSecurity.seccompProfile?.type ?? "RuntimeDefault"}`,
    "  containers:",
    `    - name: ${container.name}`,
    `      image: ${JSON.stringify(String(container.image))}`,
    `      command: ${commandJson}`,
    env,
    "      securityContext:",
    `        allowPrivilegeEscalation: ${containerSecurity.allowPrivilegeEscalation === true}`,
    `        readOnlyRootFilesystem: ${containerSecurity.readOnlyRootFilesystem === true}`,
    "        capabilities:",
    '          drop: ["ALL"]',
    "        seccompProfile:",
    `          type: ${containerSecurity.seccompProfile?.type ?? "RuntimeDefault"}`,
    "      resources:",
    "        requests:",
    `          cpu: ${JSON.stringify(resources.requests.cpu)}`,
    `          memory: ${JSON.stringify(resources.requests.memory)}`,
    "        limits:",
    `          cpu: ${JSON.stringify(resources.limits.cpu)}`,
    `          memory: ${JSON.stringify(resources.limits.memory)}`,
    ""
  ].join("\n");
}

export function shellJoin(argv) {
  return argv
    .map((part) =>
      /^[A-Za-z0-9_./:=,@+-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`
    )
    .join(" ");
}
