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
  if (inventory.sandboxNodePool?.sandboxType !== "gvisor") {
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
  if (inventory.nat?.scope?.type !== "CUSTOM_PRIMARY_AND_SANDBOX_SECONDARY") {
    errors.push("Cloud NAT must select the cluster subnet primary plus sandbox Pod secondary");
  }
  return errors;
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
      taint.key === "sandbox.gke.io/runtime" &&
      taint.value === "gvisor" &&
      ["NO_SCHEDULE", "NoSchedule"].includes(taint.effect)
  );
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
        `--logging-aggregation-interval=${inventory.network.flowLogs.aggregationInterval}`,
        `--logging-flow-sampling=${inventory.network.flowLogs.flowSampling}`,
        `--logging-metadata=${inventory.network.flowLogs.metadata}`
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
      command("create-private-sandbox-pool", "Create exact private sandbox node pool", [
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
        `--node-labels=${Object.entries(pool.labels)
          .map(([key, value]) => `${key}=${value}`)
          .join(",")}`,
        `--node-taints=${pool.taints
          .map((taint) => `${taint.key}=${taint.value}:NoSchedule`)
          .join(",")}`,
        `--tags=${pool.networkTags.join(",")}`,
        `--sandbox=type=${pool.sandboxType}`,
        "--shielded-secure-boot",
        "--shielded-integrity-monitoring",
        "--metadata=disable-legacy-endpoints=true"
      ]),
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

  check(
    checks,
    "vpc-subnet-route-inventory",
    sameSet(live.vpcSubnetRoutes ?? [], [
      inventory.cidrs.nodePrimary,
      ...inventory.cidrs.vpcSubnetDenies
    ]),
    JSON.stringify(live.vpcSubnetRoutes ?? [])
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
  const addonEnabled = live.cluster?.addonsConfig?.networkPolicyConfig?.disabled === false;
  const safeNpState =
    (!npEnabled && !addonEnabled) || (!npEnabled && addonEnabled) || (npEnabled && addonEnabled);
  const npStateAllowed =
    phase === "apply-calico" ||
    phase === "prepare" ||
    phase === "apply-nat" ||
    phase === "apply-firewall"
      ? safeNpState
      : npEnabled && addonEnabled;
  check(
    checks,
    "network-policy-state-valid-for-phase",
    npStateAllowed,
    `NP=${npEnabled} addon=${addonEnabled}`
  );

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
  const execSaAnnotations = live.execServiceAccount?.metadata?.annotations ?? {};
  check(
    checks,
    "exec-ksa-object-ready",
    live.execServiceAccount?.metadata?.name === "sandbox-exec-sa" &&
      live.execServiceAccount?.automountServiceAccountToken === false &&
      Object.keys(execSaAnnotations).length === 0,
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
  check(
    checks,
    "exec-ksa-live-wiring",
    runningExecPods.length > 0 &&
      runningExecPods.every(
        (pod) =>
          pod.serviceAccountName === "sandbox-exec-sa" &&
          pod.automountServiceAccountToken === false &&
          pod.runtimeClassName === "gvisor" &&
          pod.labels?.["app.kubernetes.io/component"] === "sandbox-exec"
      ),
    runningExecPods.length === 0
      ? "zero Running sandbox-exec pods; KSA object readiness is not live wiring proof"
      : JSON.stringify(runningExecPods)
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
  checks.push(...evaluateCalicoReadiness(inventory, live).checks);
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
  return (
    policy.metadata?.name === "sandbox-exec-isolation" &&
    exactPodSelector(spec.podSelector, {
      "app.kubernetes.io/component": "sandbox-exec"
    }) &&
    sameSet(spec.policyTypes ?? [], ["Ingress", "Egress"]) &&
    Array.isArray(spec.ingress) &&
    spec.ingress.length === 0 &&
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
  return (
    policy.metadata?.name === "sandbox-nat-identity-probe-isolation" &&
    exactPodSelector(spec.podSelector, {
      "sandbox.gke.io/adr146-nat-probe": "true"
    }) &&
    sameSet(spec.policyTypes ?? [], ["Ingress", "Egress"]) &&
    Array.isArray(spec.ingress) &&
    spec.ingress.length === 0 &&
    egress.length === 2 &&
    Boolean(dnsRule) &&
    Boolean(publicRule)
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

export function evaluateCalicoReadiness(inventory, live) {
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
  check(
    checks,
    "calico-daemon-ready",
    (live.calicoDaemonSets?.length ?? 0) > 0 &&
      live.calicoDaemonSets.every(
        (daemon) => daemon.desired > 0 && daemon.ready === daemon.desired
      ),
    JSON.stringify(live.calicoDaemonSets ?? [])
  );
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
    "release-gate-blocker-honest",
    inventory.releaseGate.repositoryEnforced === false &&
      inventory.releaseGate.deferredSlice === "0.1b" &&
      (inventory.releaseGate.blockers?.length ?? 0) >= 3,
    "Argo HEAD + GAR-only WIF + old-image KSA circularity must remain explicit until parent resolves it"
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

function privatePoolMatches(inventory, pool) {
  if (!pool) return false;
  const expected = inventory.sandboxNodePool;
  const { email } = nodeServiceAccountIdentity(inventory);
  const sandboxType = String(
    pool.config?.sandboxConfig?.type ?? pool.config?.sandboxConfig?.sandboxType ?? ""
  ).toLowerCase();
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
    hasExpectedTaint(pool.config?.taints ?? []) &&
    sandboxType === String(expected.sandboxType).toLowerCase() &&
    sameSet(pool.config?.tags ?? [], expected.networkTags) &&
    pool.config?.shieldedInstanceConfig?.enableSecureBoot === true &&
    pool.config?.shieldedInstanceConfig?.enableIntegrityMonitoring === true &&
    pool.config?.metadata?.["disable-legacy-endpoints"] === "true"
  );
}

export function validateRestrictedProbePod(pod, live, inventory) {
  const expected = inventory.cidrs.restrictedProbe.restrictedExecPod;
  const privateNodeNames = new Set((live.privatePoolNodes ?? []).map((node) => node.name));
  const errors = [];
  if (!pod) errors.push("pod missing");
  if (pod?.phase !== "Running") errors.push(`phase=${pod?.phase ?? "missing"}`);
  if (pod?.labels?.[expected.requiredComponentLabel] !== expected.requiredComponentLabelValue) {
    errors.push("missing exact sandbox-exec component label");
  }
  if (!privateNodeNames.has(pod?.nodeName)) errors.push("not on private-pool node");
  if (pod?.serviceAccountName !== expected.serviceAccountName) {
    errors.push(`serviceAccountName=${pod?.serviceAccountName ?? "missing"}`);
  }
  if (pod?.automountServiceAccountToken !== false) errors.push("automount must be false");
  if (pod?.runtimeClassName !== expected.runtimeClassName) {
    errors.push(`runtimeClassName=${pod?.runtimeClassName ?? "missing"}`);
  }
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
  const hasProxyEnv = containers.some((container) =>
    (container.env ?? []).some((entry) =>
      ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].includes(entry.name)
    )
  );
  if (hasProxyEnv) errors.push("proxy env must be absent");
  return { ok: errors.length === 0, errors };
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

export function renderPlanText(inventory) {
  const phases = buildPhasePlans(inventory);
  const lines = [
    "ADR-146 Slice 0.1 foundation plan",
    `cluster=${inventory.cluster.name} project=${inventory.cluster.projectId} location=${inventory.cluster.location}`,
    `network=${inventory.network.vpcName} subnet=${inventory.network.subnetName}`,
    "",
    "Every mutating --execute phase runs a fresh fail-closed live preflight first.",
    "Existing resources skip only on exact configuration; drift fails with remediation guidance.",
    "VPC deny excludes own node-primary, Pod, Service, and metadata CIDRs; mandatory Calico owns those paths.",
    "Default GKE public SNAT uses node primary IPs; Cloud NAT selects subnet primary plus sandbox Pod secondary.",
    "Static NAT attribution is currently exclusive only while all eligible no-external-IP consumers verify as private sandbox nodes.",
    "Private pool create uses --sandbox=type=gvisor; labels/taints alone are not GKE Sandbox proof.",
    "After private pool Ready, apply-sandbox-pool cordons the legacy public pool to close the dual-pool scheduling window without deleting it or killing running jobs.",
    "Structural verify never claims dynamic restricted probes or Calico label readiness as enforcement proof; probe-restricted is separate.",
    "Inbound denial, HTTP redirect, and DNS-rebind remain unclaimed by probe-restricted.",
    "Public pool retirement requires explicit maintenance confirmation and zero exec pods on old nodes.",
    "Production push remains blocked: current Argo/WIF workflow cannot enforce exact-commit live attestation.",
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

export function shellJoin(argv) {
  return argv
    .map((part) =>
      /^[A-Za-z0-9_./:=,@+-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`
    )
    .join(" ");
}
