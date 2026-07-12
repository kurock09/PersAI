#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPLY_PHASE_ORDER,
  ADR146_CONTROLLED_PROBE_LABEL,
  ADR146_CONTROLLED_PROBE_POD_NAMES,
  buildControlledProbeCleanupPlan,
  buildEvidenceBinding,
  buildNatProbePodManifest,
  buildPhasePlans,
  buildRestrictedProbePodManifest,
  evaluateCalicoReadiness,
  evaluateLiveFoundation,
  evaluatePreflight,
  evaluatePublicPoolCordon,
  evaluateRetirementGate,
  inventoryNatEligibleConsumers,
  inventoryConflictingEgressAllows,
  isNetworkPolicyAddonEnabled,
  loadInventory,
  mapExecPodFromKubectlItem,
  natAddressName,
  natEgressIdentityMatches,
  nodeServiceAccountIdentity,
  renderPlanText,
  renderProbeManifestYaml,
  resolveRestrictedProbeTargets,
  runStaticDeployTruth,
  privatePoolMatches,
  readLiveSandboxConfigType,
  selectApplySandboxPoolCommandIds,
  selectPrepareCommandIds,
  shellJoin,
  squidDenialHttpStatusIndicatesProxyDeny,
  validateNatProbePod,
  validateRestrictedProbePod
} from "./lib/foundation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHASES = new Set([
  "plan",
  "static-check",
  "generate-probe-manifests",
  "cleanup-controlled-probes",
  "preflight",
  "prepare",
  "apply-nat",
  "apply-firewall",
  "apply-calico",
  "apply-sandbox-pool",
  "retire-public-pool",
  "apply",
  "verify",
  "probe-restricted"
]);

function parseArgs(argv) {
  const parsed = {
    phase: "plan",
    execute: false,
    inventoryPath: undefined,
    maintenanceConfirm: undefined,
    probePod: undefined,
    natProbePod: undefined,
    outDir: undefined,
    help: false
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--inventory") parsed.inventoryPath = argv[++index];
    else if (arg === "--maintenance-confirm") parsed.maintenanceConfirm = argv[++index];
    else if (arg === "--probe-pod") parsed.probePod = argv[++index];
    else if (arg === "--nat-probe-pod") parsed.natProbePod = argv[++index];
    else if (arg === "--out-dir") parsed.outDir = argv[++index];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg.startsWith("-")) throw new Error(`unknown argument: ${arg}`);
    else positional.push(arg);
  }
  if (positional[0]) parsed.phase = positional[0];
  return parsed;
}

function usage() {
  return `Usage:
  node infra/bootstrap/adr146-sandbox-egress-foundation.mjs <phase> [--execute]

Phases: ${[...PHASES].join(", ")}

Mutating phases are dry-run unless --execute is supplied. Every mutating execute
phase runs a fresh read-only fail-closed preflight before any mutation.
CI never auto-applies these phases.

generate-probe-manifests writes local YAML only (optional --out-dir). It does
not apply to the cluster.

cleanup-controlled-probes deletes only the two known controlled probe Pods by
exact name and/or label ${ADR146_CONTROLLED_PROBE_LABEL}=true
(${ADR146_CONTROLLED_PROBE_POD_NAMES.join(", ")}). Dry-run by default;
requires --execute. Never broad-deletes production sandbox-exec pods.

Public pool retirement additionally requires:
  --maintenance-confirm NO_ACTIVE_SANDBOX_JOBS_CONFIRMED

Restricted active probes additionally require:
  --execute --probe-pod <running-restricted-exec-pod>
  --nat-probe-pod <controlled-direct-egress-sandbox-pod>
`;
}

function commandExists(name) {
  if (process.platform === "win32") {
    return spawnSync("where.exe", [name], { encoding: "utf8", shell: false }).status === 0;
  }
  const args = name === "kubectl" ? ["version", "--client"] : ["version"];
  return spawnSync(name, args, { encoding: "utf8", shell: false }).status === 0;
}

function run(argv, options = {}) {
  const { print = true, allowFailure = false } = options;
  if (print) console.log(`$ ${shellJoin(argv)}`);
  const result = spawnPortable(argv, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `command failed (${result.status}): ${shellJoin(argv)}\n${result.stderr || result.stdout || ""}`
    );
  }
  return result;
}

function spawnPortable(argv, options) {
  if (process.platform === "win32" && argv[0] === "gcloud") {
    const located = spawnSync("where.exe", ["gcloud.cmd"], {
      encoding: "utf8",
      shell: false
    })
      .stdout?.split(/\r?\n/)
      .find(Boolean);
    if (!located) return spawnSync(argv[0], argv.slice(1), options);
    return spawnSync("cmd.exe", ["/d", "/c", "call", located, ...argv.slice(1)], options);
  }
  return spawnSync(argv[0], argv.slice(1), options);
}

function text(argv, allowFailure = false) {
  return run(argv, { print: false, allowFailure }).stdout?.trim() ?? "";
}

function json(argv, allowMissing = false) {
  const result = run(argv, { print: false, allowFailure: allowMissing });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout || "null");
}

function gcloudJson(args, allowMissing = false) {
  return json(["gcloud", ...args], allowMissing);
}

function kubectlJson(args, allowMissing = false) {
  return json(["kubectl", ...args], allowMissing);
}

function collectLive(inventory) {
  const project = inventory.cluster.projectId;
  const zone = inventory.cluster.location;
  const clusterName = inventory.cluster.name;
  const region = inventory.cluster.region;
  const { email: nodeSaEmail } = nodeServiceAccountIdentity(inventory);

  const cluster = gcloudJson([
    "container",
    "clusters",
    "describe",
    clusterName,
    `--project=${project}`,
    `--zone=${zone}`,
    "--format=json"
  ]);
  const subnetName = basenameRef(cluster?.subnetwork ?? cluster?.networkConfig?.subnetwork);
  const subnet = gcloudJson([
    "compute",
    "networks",
    "subnets",
    "describe",
    subnetName,
    `--project=${project}`,
    `--region=${region}`,
    "--format=json"
  ]);
  const routes = gcloudJson([
    "compute",
    "routes",
    "list",
    `--project=${project}`,
    `--filter=network=${inventory.network.vpcName}`,
    "--format=json"
  ]);
  const psaAddresses = gcloudJson([
    "compute",
    "addresses",
    "list",
    `--project=${project}`,
    "--filter=purpose=VPC_PEERING",
    "--format=json"
  ]);
  const regionalInstances = gcloudJson([
    "compute",
    "instances",
    "list",
    `--project=${project}`,
    `--filter=zone:(${region}-*)`,
    "--format=json"
  ]);
  const redisInstance = gcloudJson([
    "redis",
    "instances",
    "describe",
    inventory.cidrs.restrictedProbe.managedListeners.redis.name,
    `--project=${project}`,
    `--region=${inventory.cidrs.restrictedProbe.managedListeners.redis.region}`,
    "--format=json"
  ]);
  const filestoreInstance = gcloudJson([
    "filestore",
    "instances",
    "describe",
    inventory.cidrs.restrictedProbe.managedListeners.filestore.name,
    `--project=${project}`,
    `--location=${inventory.cidrs.restrictedProbe.managedListeners.filestore.location}`,
    "--format=json"
  ]);
  const cloudSqlInstance = gcloudJson([
    "sql",
    "instances",
    "describe",
    inventory.cidrs.restrictedProbe.managedListeners.cloudSql.name,
    `--project=${project}`,
    "--format=json"
  ]);

  const publicPool = describePool(inventory, inventory.sandboxNodePool.retirePublicPoolName);
  const privatePool = describePool(inventory, inventory.sandboxNodePool.replacementName);
  const nodeSa = gcloudJson(
    ["iam", "service-accounts", "describe", nodeSaEmail, `--project=${project}`, "--format=json"],
    true
  );
  const nodeSaPolicy = gcloudJson(["projects", "get-iam-policy", project, "--format=json"]);
  const natAddresses = Array.from({ length: inventory.nat.staticAddressCount }, (_, index) =>
    gcloudJson(
      [
        "compute",
        "addresses",
        "describe",
        natAddressName(inventory, index),
        `--project=${project}`,
        `--region=${region}`,
        "--format=json"
      ],
      true
    )
  );
  const router = gcloudJson(
    [
      "compute",
      "routers",
      "describe",
      inventory.nat.routerName,
      `--project=${project}`,
      `--region=${region}`,
      "--format=json"
    ],
    true
  );
  const nat = gcloudJson(
    [
      "compute",
      "routers",
      "nats",
      "describe",
      inventory.nat.natName,
      `--project=${project}`,
      `--router=${inventory.nat.routerName}`,
      `--region=${region}`,
      "--format=json"
    ],
    true
  );
  const firewall = gcloudJson(
    [
      "compute",
      "firewall-rules",
      "describe",
      inventory.firewall.denyEgressRuleName,
      `--project=${project}`,
      "--format=json"
    ],
    true
  );
  const firewallRules = gcloudJson([
    "compute",
    "firewall-rules",
    "list",
    `--project=${project}`,
    `--filter=network=${inventory.network.vpcName}`,
    "--format=json"
  ]);
  const conflictingEgressAllows = inventoryConflictingEgressAllows(inventory, firewallRules);

  const nodes = kubectlJson(["get", "nodes", "-o", "json"]);
  const allNodes = (nodes?.items ?? []).map(mapNode);
  const privatePoolNodes = allNodes.filter(
    (node) => node.pool === inventory.sandboxNodePool.replacementName
  );
  const publicPoolNodes = allNodes.filter(
    (node) => node.pool === inventory.sandboxNodePool.retirePublicPoolName
  );
  const execPodsJson = kubectlJson([
    "-n",
    "persai-dev",
    "get",
    "pods",
    "-l",
    "app.kubernetes.io/component=sandbox-exec",
    "-o",
    "json"
  ]);
  const execPods = (execPodsJson?.items ?? []).map(mapExecPodFromKubectlItem);
  const daemonSets = kubectlJson(["-n", "kube-system", "get", "daemonsets", "-o", "json"]);
  const calicoDaemonSets = (daemonSets?.items ?? [])
    .filter((daemon) => /calico/i.test(daemon.metadata?.name ?? ""))
    .map((daemon) => ({
      name: daemon.metadata?.name,
      desired: Number(daemon.status?.desiredNumberScheduled ?? 0),
      current: Number(daemon.status?.currentNumberScheduled ?? 0),
      ready: Number(daemon.status?.numberReady ?? 0)
    }));
  const dnsPods = kubectlJson([
    "-n",
    "kube-system",
    "get",
    "pods",
    "-l",
    "k8s-app=kube-dns",
    "-o",
    "json"
  ]);
  const kubeDnsService = kubectlJson([
    "-n",
    "kube-system",
    "get",
    "service",
    "kube-dns",
    "-o",
    "json"
  ]);
  const kubeDnsUpstreamService = kubectlJson([
    "-n",
    "kube-system",
    "get",
    "service",
    "kube-dns-upstream",
    "-o",
    "json"
  ]);
  const kubernetesApiService = kubectlJson([
    "-n",
    inventory.cidrs.restrictedProbe.serviceListeners.kubernetesApi.namespace,
    "get",
    "service",
    inventory.cidrs.restrictedProbe.serviceListeners.kubernetesApi.name,
    "-o",
    "json"
  ]);
  const metricsServerService = kubectlJson([
    "-n",
    inventory.cidrs.restrictedProbe.serviceListeners.metricsServer.namespace,
    "get",
    "service",
    inventory.cidrs.restrictedProbe.serviceListeners.metricsServer.name,
    "-o",
    "json"
  ]);
  const nodeLocalDnsDaemonSet = kubectlJson([
    "-n",
    "kube-system",
    "get",
    "daemonset",
    "node-local-dns",
    "-o",
    "json"
  ]);
  const ipMasqAgentConfig = kubectlJson(
    ["-n", "kube-system", "get", "configmap", "ip-masq-agent", "-o", "json"],
    true
  );
  const nodeLocalDnsArgs =
    nodeLocalDnsDaemonSet?.spec?.template?.spec?.containers?.find(
      (container) => container.name === "node-cache"
    )?.args ?? [];
  const localIpIndex = nodeLocalDnsArgs.indexOf("-localip");
  const nodeLocalDnsAddresses =
    localIpIndex >= 0
      ? String(nodeLocalDnsArgs[localIpIndex + 1] ?? "")
          .split(",")
          .filter(Boolean)
      : [];
  const execServiceAccount = kubectlJson(
    ["-n", "persai-dev", "get", "serviceaccount", "sandbox-exec-sa", "-o", "json"],
    true
  );
  const roleBindings = kubectlJson(["get", "rolebindings", "--all-namespaces", "-o", "json"]);
  const clusterRoleBindings = kubectlJson(["get", "clusterrolebindings", "-o", "json"]);
  const execNetworkPolicy = kubectlJson(
    ["-n", "persai-dev", "get", "networkpolicy", "sandbox-exec-isolation", "-o", "json"],
    true
  );
  const legacyExecNetworkPolicy = kubectlJson(
    ["-n", "persai-dev", "get", "networkpolicy", "sandbox-exec-deny-egress", "-o", "json"],
    true
  );
  const proxyNetworkPolicy = kubectlJson(
    ["-n", "persai-dev", "get", "networkpolicy", "sandbox-egress-proxy-isolation", "-o", "json"],
    true
  );
  const natProbeNetworkPolicy = kubectlJson(
    [
      "-n",
      "persai-dev",
      "get",
      "networkpolicy",
      "sandbox-nat-identity-probe-isolation",
      "-o",
      "json"
    ],
    true
  );
  const metadataDaemonSet = kubectlJson([
    "-n",
    inventory.cidrs.restrictedProbe.metadata.daemonSetNamespace,
    "get",
    "daemonset",
    inventory.cidrs.restrictedProbe.metadata.daemonSetName,
    "-o",
    "json"
  ]);
  const trustedProbePodsJson = kubectlJson([
    "-n",
    inventory.cidrs.restrictedProbe.trustedPod.namespace,
    "get",
    "pods",
    "-l",
    inventory.cidrs.restrictedProbe.trustedPod.labelSelector,
    "-o",
    "json"
  ]);
  const trustedProbePods = (trustedProbePodsJson?.items ?? []).map((pod) => ({
    name: pod.metadata?.name,
    phase: pod.status?.phase,
    podIP: pod.status?.podIP ?? null,
    nodeName: pod.spec?.nodeName,
    labels: pod.metadata?.labels ?? {},
    runtimeClassName: pod.spec?.runtimeClassName,
    serviceAccountName: pod.spec?.serviceAccountName
  }));
  const natEligibleConsumers = inventoryNatEligibleConsumers(
    inventory,
    regionalInstances,
    allNodes
  );

  return {
    identity: {
      project: text(["gcloud", "config", "get-value", "project"]),
      account: text(["gcloud", "config", "get-value", "account"]),
      kubeContext: text(["kubectl", "config", "current-context"])
    },
    cluster,
    subnet,
    vpcSubnetRoutes: (routes ?? [])
      .filter(
        (route) =>
          String(route.name).startsWith("default-route-r-") &&
          route.destRange !== inventory.cidrs.podDefault
      )
      .map((route) => route.destRange)
      .filter(Boolean),
    peerRoutes: (routes ?? [])
      .filter((route) => Boolean(route.nextHopPeering))
      .map((route) => route.destRange)
      .filter(Boolean),
    psaRanges: (psaAddresses ?? []).map((address) => `${address.address}/${address.prefixLength}`),
    publicPool,
    privatePool,
    nodeSa,
    nodeSaPolicy,
    natAddresses,
    router,
    nat,
    firewall,
    conflictingEgressAllows,
    allNodes,
    privatePoolNodes,
    publicPoolNodes,
    execPods,
    calicoDaemonSets,
    dnsPodIps: (dnsPods?.items ?? []).map((pod) => pod.status?.podIP).filter(Boolean),
    kubeDnsService,
    kubeDnsUpstreamService,
    kubernetesApiService,
    metricsServerService,
    nodeLocalDnsDaemonSet,
    nodeLocalDnsAddresses,
    ipMasqAgentConfig,
    execServiceAccount,
    execRoleBindings: (roleBindings?.items ?? []).filter((binding) =>
      (binding.subjects ?? []).some(
        (subject) =>
          subject.kind === "ServiceAccount" &&
          subject.name === "sandbox-exec-sa" &&
          subject.namespace === "persai-dev"
      )
    ),
    execClusterRoleBindings: (clusterRoleBindings?.items ?? []).filter((binding) =>
      (binding.subjects ?? []).some(
        (subject) =>
          subject.kind === "ServiceAccount" &&
          subject.name === "sandbox-exec-sa" &&
          subject.namespace === "persai-dev"
      )
    ),
    execNetworkPolicy,
    legacyExecNetworkPolicy,
    proxyNetworkPolicy,
    natProbeNetworkPolicy,
    metadataDaemonSet,
    trustedProbePods,
    redisInstance,
    filestoreInstance,
    cloudSqlInstance,
    natEligibleConsumers,
    dynamicProbesRun: false
  };
}

function describePool(inventory, poolName) {
  return gcloudJson(
    [
      "container",
      "node-pools",
      "describe",
      poolName,
      `--project=${inventory.cluster.projectId}`,
      `--cluster=${inventory.cluster.name}`,
      `--zone=${inventory.cluster.location}`,
      "--format=json"
    ],
    true
  );
}

function mapNode(node) {
  const addresses = node.status?.addresses ?? [];
  return {
    name: node.metadata?.name,
    uid: node.metadata?.uid,
    pool: node.metadata?.labels?.["cloud.google.com/gke-nodepool"],
    ready: (node.status?.conditions ?? []).some(
      (condition) => condition.type === "Ready" && condition.status === "True"
    ),
    calicoReady: node.metadata?.labels?.["projectcalico.org/ds-ready"] === "true",
    externalIp: addresses.find((entry) => entry.type === "ExternalIP")?.address ?? null,
    internalIp: addresses.find((entry) => entry.type === "InternalIP")?.address ?? null,
    unschedulable: node.spec?.unschedulable === true
  };
}

function basenameRef(value) {
  return (
    String(value ?? "")
      .split("/")
      .at(-1) ?? ""
  );
}

function printChecks(title, evaluated) {
  console.log(`\n${title}`);
  for (const entry of evaluated.checks) {
    console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.id}: ${entry.detail}`);
  }
  console.log(evaluated.ok ? "RESULT: PASS" : "RESULT: FAIL");
}

function requirePreflight(inventory, phase) {
  const live = collectLive(inventory);
  const evaluated = evaluatePreflight(inventory, live, phase);
  printChecks(`Preflight (${phase})`, evaluated);
  if (!evaluated.ok) {
    throw new Error(`preflight failed before ${phase}; no mutation was attempted`);
  }
  return live;
}

function executePhase(inventory, phase, before) {
  const commands = buildPhasePlans(inventory, {
    network: inventory.network.vpcName,
    subnet: inventory.network.subnetName
  })[phase];
  if (!commands) throw new Error(`no command plan for phase ${phase}`);

  if (phase === "prepare") {
    const toRun = new Set(selectPrepareCommandIds(inventory, before));
    for (const item of commands) {
      if (toRun.has(item.id)) runCommand(commands, item.id);
      else console.log(`[exact] skip ${item.id}`);
    }
    return;
  }
  if (phase === "apply-nat") {
    if (before.router == null) runCommand(commands, "create-router");
    else console.log("[exact] router");
    if (before.nat == null) runCommand(commands, "create-nat");
    else console.log("[exact] NAT");
    return;
  }
  if (phase === "apply-firewall") {
    if (before.firewall == null) runCommand(commands, "create-deny-private-egress");
    else console.log("[exact] firewall");
    return;
  }
  if (phase === "apply-calico") {
    const addonEnabled = isNetworkPolicyAddonEnabled(before.cluster);
    const alreadyEnabled = before.cluster.networkPolicy?.enabled === true && addonEnabled;
    if (alreadyEnabled) {
      console.log("[exact] Calico NetworkPolicy already enabled");
      const ready = evaluateCalicoReadiness(inventory, before);
      printChecks("Calico readiness", ready);
      if (!ready.ok) {
        console.log("[resume] Calico enabled; waiting for in-progress node rollout/readiness");
        waitForCalico(inventory, [], before.allNodes.length);
      }
      return;
    }
    const oldUids = before.allNodes.map((node) => node.uid);
    const expectedCount = before.allNodes.length;
    if (!addonEnabled) {
      runCommand(commands, "enable-network-policy-addon");
    } else {
      console.log("[exact] Calico addon already enabled");
    }
    runCommand(commands, "enable-network-policy");
    waitForCalico(inventory, oldUids, expectedCount);
    return;
  }
  if (phase === "apply-sandbox-pool") {
    const toRun = new Set(selectApplySandboxPoolCommandIds(inventory, before));
    if (toRun.has("create-private-sandbox-pool")) {
      if (before.privatePool != null) {
        const observed = readLiveSandboxConfigType(before.privatePool);
        throw new Error(
          `existing private pool ${before.privatePool.name} does not match inventory contour; refuse create/replace (observed sandboxConfig.type=${observed ?? "missing"})`
        );
      }
      runCommand(commands, "create-private-sandbox-pool");
    } else {
      console.log("[exact] private sandbox pool");
    }
    run([
      "kubectl",
      "wait",
      "--for=condition=Ready",
      "nodes",
      "-l",
      `cloud.google.com/gke-nodepool=${inventory.sandboxNodePool.replacementName}`,
      "--timeout=30m"
    ]);
    const afterPrivate = collectLive(inventory);
    const nodes = afterPrivate.privatePoolNodes;
    if (nodes.length === 0 || nodes.some((node) => !node.ready || node.externalIp)) {
      throw new Error("private pool selector returned no nodes or a node is not Ready/private");
    }
    if (!privatePoolMatches(inventory, afterPrivate.privatePool)) {
      const sandboxType = readLiveSandboxConfigType(afterPrivate.privatePool);
      throw new Error(
        `private pool must match inventory contour including GKE sandboxConfig.type=gvisor (GVISOR casing accepted; observed=${sandboxType ?? "missing"}); managed label/taint, private nodes, KSA, and Pod range required`
      );
    }
    const publicPresent =
      afterPrivate.publicPool != null || (afterPrivate.publicPoolNodes?.length ?? 0) > 0;
    if (publicPresent) {
      runCommand(commands, "cordon-public-pool");
    } else {
      console.log("[exact] legacy public sandbox pool already absent; cordon skipped");
    }
    const after = collectLive(inventory);
    const cordon = evaluatePublicPoolCordon(inventory, after);
    printChecks("Legacy public pool cordon", cordon);
    if (!cordon.ok) {
      throw new Error(
        "private pool Ready but legacy public sandbox nodes were not all unschedulable; dual-pool scheduling window remains open"
      );
    }
    const postflight = evaluatePreflight(inventory, after, "apply-sandbox-pool");
    printChecks("Private pool postflight", postflight);
    if (!postflight.ok) throw new Error("private pool postflight failed");
    return;
  }
  throw new Error(`executePhase does not handle ${phase}`);
}

function runCommand(commands, id) {
  const item = commands.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing planned command ${id}`);
  run(item.argv);
}

function waitForCalico(inventory, oldUids, expectedCount) {
  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const live = collectLive(inventory);
    live.preApplyNodeUids = oldUids;
    const evaluated = evaluateCalicoReadiness(inventory, live);
    const countOk = live.allNodes.length >= expectedCount;
    printChecks("Calico recreation/readiness", evaluated);
    if (evaluated.ok && countOk) return;
    console.log("[wait] node recreation/Calico readiness incomplete; retrying in 20s");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
  }
  throw new Error(
    "Calico did not recreate and ready every expected node within 60m; maintenance policy may be delaying rollout"
  );
}

function retirePublicPool(inventory, confirmation) {
  const before = requirePreflight(inventory, "retire-public-pool");
  if (before.publicPool == null) {
    console.log("[exact] legacy public sandbox pool already absent");
    return;
  }
  const initialGate = evaluateRetirementGate(inventory, before, confirmation);
  printChecks("Public pool retirement maintenance gate", initialGate);
  if (!initialGate.ok) {
    throw new Error(
      "retirement gate failed; confirm durable job state externally and wait for zero exec pods on old nodes"
    );
  }
  const commands = buildPhasePlans(inventory)["retire-public-pool"];
  runCommand(commands, "cordon-public-pool");
  const cordoned = collectLive(inventory);
  if (
    cordoned.publicPoolNodes.length === 0 ||
    cordoned.publicPoolNodes.some((node) => !node.unschedulable)
  ) {
    throw new Error("legacy sandbox nodes were not all cordoned; pool deletion blocked");
  }
  const finalGate = evaluateRetirementGate(inventory, cordoned, confirmation);
  printChecks("Post-cordon retirement gate", finalGate);
  if (!finalGate.ok) throw new Error("an exec pod still uses the old pool; deletion blocked");
  runCommand(commands, "delete-public-pool");
  if (describePool(inventory, inventory.sandboxNodePool.retirePublicPoolName) != null) {
    throw new Error("legacy sandbox pool still exists after delete");
  }
  console.log("[verified] legacy public sandbox pool absent");
}

function runRestrictedProbes(inventory, podName, natProbePodName) {
  if (!podName || !natProbePodName) {
    throw new Error("probe-restricted requires --probe-pod and --nat-probe-pod");
  }
  const live = collectLive(inventory);
  const structural = evaluateLiveFoundation(inventory, live);
  printChecks("Pre-probe structural foundation", structural);
  if (!structural.ok) throw new Error("structural foundation must pass before active probes");
  const pod = live.execPods.find(
    (candidate) => candidate.name === podName && candidate.phase === "Running"
  );
  const probePodGate = validateRestrictedProbePod(pod, live, inventory);
  if (!probePodGate.ok) {
    throw new Error(`restricted probe pod contour invalid: ${probePodGate.errors.join("; ")}`);
  }
  const probe = inventory.cidrs.restrictedProbe;
  const trustedPod = live.trustedProbePods.find(
    (candidate) => candidate.phase === "Running" && candidate.podIP
  );
  if (!trustedPod) throw new Error("no running trusted sandbox control-plane pod is available");
  const resolvedTargets = resolveRestrictedProbeTargets(inventory, live);
  if (resolvedTargets.some((target) => !target.host || !target.port)) {
    throw new Error(
      "one or more live listener targets could not be resolved; refusal to false-pass"
    );
  }
  const trustedTcpScript = [
    "const net=require('node:net');",
    "const socket=net.createConnection({host:process.argv[1],port:Number(process.argv[2])});",
    "socket.setTimeout(4000);",
    "socket.on('connect',()=>{socket.destroy();process.exit(0)});",
    "socket.on('timeout',()=>{socket.destroy();process.exit(42)});",
    "socket.on('error',()=>process.exit(42));"
  ].join("");
  const trustedUdpScript = [
    "const dgram=require('node:dgram');",
    "const socket=dgram.createSocket('udp4');",
    "const host=process.argv[1];",
    "const port=Number(process.argv[2]);",
    "let done=false;",
    "const finish=(code)=>{if(done)return;done=true;try{socket.close()}catch{};process.exit(code)};",
    "socket.on('message',()=>finish(0));",
    "socket.on('error',()=>finish(42));",
    "const q=Buffer.from([0x12,0x34,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x01]);",
    "socket.send(q,port,host,(err)=>{if(err)finish(42)});",
    "setTimeout(()=>finish(42),2500);"
  ].join("");
  for (const target of resolvedTargets) {
    const script = target.protocol === "UDP" ? trustedUdpScript : trustedTcpScript;
    const result = run(
      [
        "kubectl",
        "-n",
        probe.trustedPod.namespace,
        "exec",
        trustedPod.name,
        "-c",
        probe.trustedPod.containerName,
        "--",
        "node",
        "-e",
        script,
        target.host,
        String(target.port)
      ],
      { allowFailure: true }
    );
    const ok = result.status === 0;
    console.log(`${ok ? "PASS" : "INCONCLUSIVE"} control ${target.label}`);
    if (!ok) {
      throw new Error(
        `trusted positive control failed for ${target.label}; denial is inconclusive`
      );
    }
  }
  const natProbePod = kubectlJson([
    "-n",
    probe.natProbePod.namespace,
    "get",
    "pod",
    natProbePodName,
    "-o",
    "json"
  ]);
  const natProbeGate = validateNatProbePod(natProbePod, live, inventory);
  if (!natProbeGate.ok) {
    throw new Error(`NAT probe pod contour invalid: ${natProbeGate.errors.join("; ")}`);
  }
  const identityResult = run(
    [
      "kubectl",
      "-n",
      probe.natProbePod.namespace,
      "exec",
      natProbePodName,
      "--",
      "curl",
      "--noproxy",
      "*",
      "-fsS",
      "--max-time",
      "20",
      probe.publicEgressIdentityEndpoint.url
    ],
    { allowFailure: true, print: false }
  );
  const observedEgressIp = identityResult.stdout?.trim() ?? "";
  const identityOk =
    identityResult.status === 0 && natEgressIdentityMatches(observedEgressIp, live.natAddresses);
  console.log(
    `${identityOk ? "PASS" : "FAIL"} probe nat-egress-ip${identityOk ? ` ip=${observedEgressIp}` : ""}`
  );
  if (!identityOk) {
    throw new Error("controlled sandbox NAT egress identity did not match a reserved NAT IP");
  }
  const exec = (argv, expectSuccess, label) => {
    const result = run(["kubectl", "-n", "persai-dev", "exec", podName, "--", ...argv], {
      allowFailure: true
    });
    const combined = `${result.stderr || ""}\n${result.stdout || ""}`;
    if (expectSuccess && /ECONNREFUSED|connection refused/i.test(combined)) {
      console.log(`FAIL probe ${label}: ECONNREFUSED proves reachability, not denial`);
      throw new Error(`restricted probe failed: ${label} (ECONNREFUSED is not denial)`);
    }
    const ok = expectSuccess ? result.status === 0 : result.status !== 0;
    console.log(`${ok ? "PASS" : "FAIL"} probe ${label}`);
    if (!ok) throw new Error(`restricted probe failed: ${label}`);
    return result;
  };
  const tcpDropOnlyScript = [
    "import errno,socket,sys",
    "host=sys.argv[1]; port=int(sys.argv[2])",
    "s=socket.socket(); s.settimeout(4)",
    "try:",
    " s.connect((host,port))",
    "except socket.timeout:",
    " sys.exit(0)",
    "except OSError as exc:",
    " sys.exit(0 if exc.errno in (errno.ENETUNREACH,errno.EHOSTUNREACH,errno.ETIMEDOUT) else 42)",
    "sys.exit(42)"
  ].join("\n");
  const udpDropOnlyScript = [
    "import errno,socket,sys",
    "host=sys.argv[1]; port=int(sys.argv[2])",
    "s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(2)",
    "try:",
    " s.sendto(b'\\xff',(host,port))",
    " s.recvfrom(512)",
    " sys.exit(42)",
    "except socket.timeout:",
    " sys.exit(0)",
    "except OSError as exc:",
    " sys.exit(0 if exc.errno in (errno.ENETUNREACH,errno.EHOSTUNREACH,errno.ETIMEDOUT) else 42)"
  ].join("\n");
  exec(["getent", "hosts", "pypi.org"], true, "DNS resolution");
  exec(["curl", "-fsSI", "--max-time", "20", "https://pypi.org/"], true, "Squid allowlisted HTTPS");
  const squidDenialLabel = `Squid denial for non-allowlisted ${probe.squidDeniedPublicHttpsHostname}`;
  const squidDenialResult = run(
    [
      "kubectl",
      "-n",
      "persai-dev",
      "exec",
      podName,
      "--",
      "curl",
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--max-time",
      "20",
      `https://${probe.squidDeniedPublicHttpsHostname}/`
    ],
    { allowFailure: true }
  );
  const squidDenialOk = squidDenialHttpStatusIndicatesProxyDeny(squidDenialResult.stdout);
  console.log(`${squidDenialOk ? "PASS" : "FAIL"} probe ${squidDenialLabel}`);
  if (!squidDenialOk) throw new Error(`restricted probe failed: ${squidDenialLabel}`);
  exec(
    [
      "env",
      "-u",
      "HTTP_PROXY",
      "-u",
      "HTTPS_PROXY",
      "-u",
      "http_proxy",
      "-u",
      "https_proxy",
      "python3",
      "-c",
      tcpDropOnlyScript,
      "pypi.org",
      "443"
    ],
    true,
    "direct public bypass denied"
  );
  const deniedTargets = [
    ...resolvedTargets.map((target) => [
      target.label,
      target.host,
      target.port,
      target.protocol ?? "TCP"
    ]),
    ["metadata", probe.metadata.host, probe.metadata.port, "TCP"]
  ];
  for (const [label, host, port, protocol] of deniedTargets) {
    if (!host || !port) {
      throw new Error(`refusing to false-pass: missing denial target for ${label}`);
    }
    const script = protocol === "UDP" ? udpDropOnlyScript : tcpDropOnlyScript;
    exec(
      ["python3", "-c", script, host, String(port)],
      true,
      `${label} ${protocol} ${host}:${port} dropped`
    );
  }
  console.log(
    "PASS restricted outbound probes (including Calico-owned kube-dns Pod and same-namespace control-plane Pod). Unclaimed by this phase: inbound denial, HTTP redirect, and DNS-rebind — see RUNBOOK."
  );
}

function cleanupControlledProbes(inventory, execute) {
  const namespace =
    inventory.cidrs.restrictedProbe.natProbePod.namespace ??
    inventory.cidrs.restrictedProbe.restrictedExecPod.namespace ??
    "persai-dev";
  const plan = buildControlledProbeCleanupPlan(
    ADR146_CONTROLLED_PROBE_POD_NAMES.map((name) => ({
      name,
      phase: "Unknown",
      labels: { [ADR146_CONTROLLED_PROBE_LABEL]: "true" }
    })),
    { namespace }
  );
  console.log(
    `Bounded controlled-probe cleanup (exact names ${plan.exactNames.join(", ")} + label ${plan.labelSelector}). Never deletes unlabeled production sandbox-exec pods.`
  );
  for (const argv of plan.argvByName) {
    console.log(`${execute ? "$" : "[dry-run]"} ${shellJoin(argv)}`);
  }
  console.log(`${execute ? "$" : "[dry-run]"} ${shellJoin(plan.labelDeleteArgv)}`);
  if (!execute) {
    console.log("Dry-run only. Re-run with --execute to delete controlled probe Pods.");
    return;
  }
  if (!commandExists("kubectl")) {
    throw new Error("cleanup-controlled-probes --execute requires kubectl");
  }
  for (const argv of plan.argvByName) {
    run(argv, { allowFailure: true });
  }
  run(plan.labelDeleteArgv, { allowFailure: true });
  const remainingJson = kubectlJson(
    ["-n", namespace, "get", "pods", "-l", `${ADR146_CONTROLLED_PROBE_LABEL}=true`, "-o", "json"],
    true
  );
  const remaining = (remainingJson?.items ?? []).map((pod) => pod.metadata?.name).filter(Boolean);
  // Also check exact names in case label was stripped but Pod remains.
  for (const name of ADR146_CONTROLLED_PROBE_POD_NAMES) {
    const still = kubectlJson(["-n", namespace, "get", "pod", name, "-o", "json"], true);
    if (still?.metadata?.name && !remaining.includes(still.metadata.name)) {
      remaining.push(still.metadata.name);
    }
  }
  if (remaining.length > 0) {
    throw new Error(`controlled probe Pods still present after cleanup: ${remaining.join(", ")}`);
  }
  console.log("PASS cleanup-controlled-probes: no controlled probe Pods remain (idempotent).");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return process.stdout.write(usage());
  if (!PHASES.has(args.phase)) throw new Error(`unsupported phase ${args.phase}\n${usage()}`);
  const inventoryPath =
    args.inventoryPath ??
    path.join(repoRoot, "infra/bootstrap/adr146-sandbox-egress-foundation.json");
  const inventory = loadInventory(inventoryPath);
  const valuesDevText = readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8");
  const evidence = buildEvidenceBinding(inventoryPath);

  if (args.phase === "plan") {
    process.stdout.write(renderPlanText(inventory, evidence));
    const staticResult = runStaticDeployTruth(inventory, { valuesDevText });
    printChecks("Static deploy truth", staticResult);
    if (!staticResult.ok) process.exitCode = 1;
    return;
  }
  if (args.phase === "static-check") {
    console.log(
      `evidence.gitCommitSha=${evidence.gitCommitSha} inventorySha256=${evidence.inventorySha256}`
    );
    const staticResult = runStaticDeployTruth(inventory, { valuesDevText });
    printChecks("Static deploy truth", staticResult);
    if (!staticResult.ok) process.exitCode = 1;
    return;
  }
  if (args.phase === "generate-probe-manifests") {
    const restricted = buildRestrictedProbePodManifest(inventory);
    const nat = buildNatProbePodManifest(inventory);
    const outDir = args.outDir ?? path.join(repoRoot, "infra/bootstrap/adr146-probe-manifests");
    mkdirSync(outDir, { recursive: true });
    const restrictedPath = path.join(outDir, "restricted-probe.pod.yaml");
    const natPath = path.join(outDir, "nat-probe.pod.yaml");
    const evidencePath = path.join(outDir, "evidence.json");
    writeFileSync(restrictedPath, renderProbeManifestYaml(restricted));
    writeFileSync(natPath, renderProbeManifestYaml(nat));
    writeFileSync(`${evidencePath}`, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${restrictedPath}`);
    console.log(`wrote ${natPath}`);
    console.log(`wrote ${evidencePath}`);
    console.log(
      "Local generation only — operators apply explicitly after sandbox-only pin; CI does not apply."
    );
    console.log(
      "Plain probe Pods are not auto-deleted; run cleanup-controlled-probes after probe-restricted (success or failure)."
    );
    return;
  }
  if (args.phase === "cleanup-controlled-probes") {
    cleanupControlledProbes(inventory, args.execute);
    return;
  }
  if (!commandExists("gcloud") || !commandExists("kubectl")) {
    throw new Error("live phases require gcloud and kubectl");
  }
  if (args.phase === "preflight") {
    const evaluated = evaluatePreflight(inventory, collectLive(inventory), "prepare");
    printChecks("Live preflight", evaluated);
    if (!evaluated.ok) process.exitCode = 1;
    return;
  }
  if (args.phase === "verify") {
    console.log(
      `evidence.gitCommitSha=${evidence.gitCommitSha} inventorySha256=${evidence.inventorySha256}`
    );
    const evaluated = evaluateLiveFoundation(inventory, collectLive(inventory));
    printChecks("Structural live foundation verify", evaluated);
    if (!evaluated.ok) {
      process.exitCode = 1;
      console.error("Structural verify failed. Dynamic probes were not run or claimed.");
      console.error(
        "If controlled probe Pods were applied, run cleanup-controlled-probes on both success and failure paths."
      );
    } else {
      console.log(
        "Structural verify passed. Run probe-restricted separately with founder approval."
      );
      const probeReport = evaluated.checks.find(
        (entry) => entry.id === "controlled-probe-pods-reported"
      );
      if (probeReport?.detail && probeReport.detail !== "[]") {
        console.log(
          `Controlled probe Pods currently present (cleanup required after probes): ${probeReport.detail}`
        );
      }
    }
    return;
  }
  if (args.phase === "probe-restricted") {
    if (!args.execute) {
      console.log(
        "[dry-run] would run trusted TCP controls, reserved NAT-IP identity, then restricted denial probes"
      );
      return;
    }
    console.log(
      `evidence.gitCommitSha=${evidence.gitCommitSha} inventorySha256=${evidence.inventorySha256}`
    );
    runRestrictedProbes(inventory, args.probePod, args.natProbePod);
    return;
  }
  if (!args.execute) {
    const phases = args.phase === "apply" ? APPLY_PHASE_ORDER : [args.phase];
    for (const phase of phases) {
      console.log(`\n[dry-run] ${phase}: live preflight would run before mutation`);
      for (const item of buildPhasePlans(inventory)[phase] ?? []) {
        console.log(`$ ${shellJoin(item.argv)}`);
      }
    }
    return;
  }
  if (args.phase === "retire-public-pool") {
    retirePublicPool(inventory, args.maintenanceConfirm);
    return;
  }
  const phases = args.phase === "apply" ? APPLY_PHASE_ORDER : [args.phase];
  for (const phase of phases) {
    const before = requirePreflight(inventory, phase);
    executePhase(inventory, phase, before);
  }
  console.log(
    "[done] requested phase(s) completed; structural verify and active probes remain required"
  );
}

try {
  main();
} catch (error) {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
