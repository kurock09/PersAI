import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildFirewallDenyDestinations,
  buildRestrictedProxyDeniedCidrs,
  cidrsOverlap
} from "./lib/cidr.mjs";
import {
  APPLY_PHASE_ORDER,
  buildPhasePlans,
  evaluateCalicoReadiness,
  evaluateLiveFoundation,
  evaluatePreflight,
  evaluatePublicPoolCordon,
  evaluateRetirementGate,
  exactIpBlockOnlyPeers,
  exactPeerPodSelector,
  exactPodSelector,
  inventoryConflictingEgressAllows,
  inventoryNatEligibleConsumers,
  loadInventory,
  natEgressIdentityMatches,
  nodeServiceAccountIdentity,
  resolveCalicoOwnedProbeTargets,
  resolveRestrictedProbeTargets,
  runStaticDeployTruth,
  squidDenialHttpStatusIndicatesProxyDeny,
  validateInventory,
  validateNatProbePod,
  validateRestrictedProbePod
} from "./lib/foundation.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function baseLive(inventory) {
  const { email } = nodeServiceAccountIdentity(inventory);
  const privatePool = {
    name: inventory.sandboxNodePool.replacementName,
    autoscaling: { enabled: true, minNodeCount: 1, maxNodeCount: 2 },
    config: {
      machineType: "e2-standard-4",
      diskSizeGb: 100,
      imageType: "COS_CONTAINERD",
      serviceAccount: email,
      labels: { "sandbox.gke.io/runtime": "gvisor", workload: "sandbox" },
      tags: ["persai-sandbox-node"],
      taints: [
        {
          key: "sandbox.gke.io/runtime",
          value: "gvisor",
          effect: "NO_SCHEDULE"
        }
      ],
      shieldedInstanceConfig: {
        enableSecureBoot: true,
        enableIntegrityMonitoring: true
      },
      metadata: { "disable-legacy-endpoints": "true" },
      sandboxConfig: { type: "gvisor" }
    },
    networkConfig: {
      enablePrivateNodes: true,
      podRange: "persai-sandbox-pods",
      podIpv4CidrBlock: "10.109.0.0/20"
    }
  };
  return {
    identity: {
      project: inventory.cluster.projectId,
      account: inventory.cluster.expectedAccount,
      kubeContext: inventory.cluster.expectedKubeContext
    },
    cluster: {
      name: inventory.cluster.name,
      location: inventory.cluster.location,
      network: inventory.network.vpcName,
      subnetwork: inventory.network.subnetName,
      networkConfig: {
        datapathProvider: "LEGACY_DATAPATH",
        dnsConfig: { clusterDns: "KUBE_DNS" }
      },
      networkPolicy: { enabled: true, provider: "CALICO" },
      addonsConfig: { networkPolicyConfig: { disabled: false } },
      ipAllocationPolicy: {
        clusterIpv4CidrBlock: inventory.cidrs.podDefault,
        servicesIpv4CidrBlock: inventory.cidrs.service
      },
      maintenancePolicy: {}
    },
    subnet: {
      ipCidrRange: inventory.cidrs.nodePrimary,
      privateIpGoogleAccess: true,
      enableFlowLogs: true,
      logConfig: {
        aggregationInterval: inventory.network.flowLogs.aggregationInterval,
        flowSampling: inventory.network.flowLogs.flowSampling,
        metadata: inventory.network.flowLogs.metadata
      },
      secondaryIpRanges: [
        ...Object.entries(inventory.network.existingSecondaryRanges).map(
          ([rangeName, ipCidrRange]) => ({ rangeName, ipCidrRange })
        ),
        {
          rangeName: inventory.sandboxNodePool.podSecondaryRangeName,
          ipCidrRange: inventory.cidrs.sandboxPodSecondary
        }
      ]
    },
    vpcSubnetRoutes: [inventory.cidrs.nodePrimary, ...inventory.cidrs.vpcSubnetDenies],
    peerRoutes: [...inventory.cidrs.observedPeerRoutes],
    psaRanges: [inventory.cidrs.peers.psaA, inventory.cidrs.peers.psaB],
    publicPool: null,
    privatePool,
    nodeSa: {
      email,
      displayName: inventory.nodeServiceAccount.displayName,
      disabled: false
    },
    nodeSaPolicy: {
      bindings: inventory.nodeServiceAccount.requiredRoles.map((role) => ({
        role,
        members: [`serviceAccount:${email}`]
      }))
    },
    natAddresses: [
      {
        name: "persai-sandbox-nat-1",
        address: "34.1.1.1",
        region: "regions/europe-west1",
        addressType: "EXTERNAL",
        networkTier: "PREMIUM",
        status: "IN_USE"
      },
      {
        name: "persai-sandbox-nat-2",
        address: "34.1.1.2",
        region: "regions/europe-west1",
        addressType: "EXTERNAL",
        networkTier: "PREMIUM",
        status: "IN_USE"
      }
    ],
    router: {
      name: inventory.nat.routerName,
      network: inventory.network.vpcName,
      region: "regions/europe-west1"
    },
    nat: {
      name: inventory.nat.natName,
      natIpAllocateOption: "MANUAL_ONLY",
      sourceSubnetworkIpRangesToNat: "LIST_OF_SUBNETWORKS",
      subnetworks: [
        {
          name: "regions/europe-west1/subnetworks/default",
          sourceIpRangesToNat: ["PRIMARY_IP_RANGE", "LIST_OF_SECONDARY_IP_RANGES"],
          secondaryIpRangeNames: ["persai-sandbox-pods"]
        }
      ],
      minPortsPerVm: 64,
      natIps: ["addresses/persai-sandbox-nat-1", "addresses/persai-sandbox-nat-2"],
      logConfig: { enable: true, filter: "ALL" }
    },
    firewall: {
      name: inventory.firewall.denyEgressRuleName,
      network: inventory.network.vpcName,
      direction: "EGRESS",
      priority: 900,
      denied: [{ IPProtocol: "all" }],
      destinationRanges: buildFirewallDenyDestinations(inventory),
      targetTags: ["persai-sandbox-node"]
    },
    allNodes: [
      {
        name: "private-node",
        uid: "new-node",
        pool: inventory.sandboxNodePool.replacementName,
        ready: true,
        calicoReady: true,
        externalIp: null
      }
    ],
    privatePoolNodes: [
      {
        name: "private-node",
        uid: "new-node",
        pool: inventory.sandboxNodePool.replacementName,
        ready: true,
        calicoReady: true,
        externalIp: null
      }
    ],
    natEligibleConsumers: [
      {
        name: "private-node",
        zone: "europe-west1-b",
        networkIp: "10.132.0.50",
        pool: inventory.sandboxNodePool.replacementName,
        tags: [inventory.firewall.networkTag],
        eligibleVia: ["PRIMARY_IP_RANGE", inventory.sandboxNodePool.podSecondaryRangeName]
      }
    ],
    publicPoolNodes: [],
    execPods: [
      {
        name: "ses-fixture",
        phase: "Running",
        nodeName: "private-node",
        serviceAccountName: "sandbox-exec-sa",
        automountServiceAccountToken: false,
        runtimeClassName: "gvisor",
        labels: { "app.kubernetes.io/component": "sandbox-exec" },
        podIP: "10.109.0.10"
      }
    ],
    calicoDaemonSets: [{ name: "calico-node", desired: 1, ready: 1 }],
    dnsPodIps: ["10.107.128.20"],
    conflictingEgressAllows: [],
    execServiceAccount: {
      metadata: { name: "sandbox-exec-sa" },
      automountServiceAccountToken: false
    },
    execRoleBindings: [],
    execClusterRoleBindings: [],
    kubeDnsService: {
      spec: {
        clusterIP: "34.118.224.10",
        ports: [
          { protocol: "UDP", port: 53 },
          { protocol: "TCP", port: 53 }
        ]
      }
    },
    kubeDnsUpstreamService: {
      spec: {
        clusterIP: "34.118.233.32",
        ports: [
          { protocol: "UDP", port: 53 },
          { protocol: "TCP", port: 53 }
        ]
      }
    },
    kubernetesApiService: {
      spec: { clusterIP: "34.118.224.1", ports: [{ protocol: "TCP", port: 443 }] }
    },
    metricsServerService: {
      spec: { clusterIP: "34.118.226.126", ports: [{ protocol: "TCP", port: 443 }] }
    },
    redisInstance: {
      name: "projects/test/locations/europe-west1/instances/openclaw-runtime-redis",
      host: "10.107.45.68",
      port: 6379
    },
    filestoreInstance: {
      name: "projects/test/locations/europe-west1-b/instances/personal-ai-openclaw-fs",
      networks: [{ ipAddresses: ["10.105.140.58"] }]
    },
    cloudSqlInstance: {
      name: "persai-dev-postgres",
      ipAddresses: [{ type: "PRIVATE", ipAddress: "10.11.128.5" }]
    },
    nodeLocalDnsDaemonSet: {
      metadata: { name: "node-local-dns" },
      status: { desiredNumberScheduled: 1, numberReady: 1 }
    },
    nodeLocalDnsAddresses: ["169.254.20.10", "34.118.224.10"],
    execNetworkPolicy: {
      metadata: { name: "sandbox-exec-isolation" },
      spec: {
        podSelector: {
          matchLabels: { "app.kubernetes.io/component": "sandbox-exec" }
        },
        policyTypes: ["Ingress", "Egress"],
        ingress: [],
        egress: [
          {
            to: [
              { ipBlock: { cidr: "169.254.20.10/32" } },
              { ipBlock: { cidr: "34.118.224.10/32" } }
            ],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 }
            ]
          },
          {
            to: [
              {
                podSelector: {
                  matchLabels: { "app.kubernetes.io/name": "sandbox-egress-proxy" }
                }
              }
            ],
            ports: [{ protocol: "TCP", port: 3128 }]
          }
        ]
      }
    },
    legacyExecNetworkPolicy: null,
    proxyNetworkPolicy: {
      metadata: { name: "sandbox-egress-proxy-isolation" },
      spec: {
        podSelector: {
          matchLabels: { "app.kubernetes.io/name": "sandbox-egress-proxy" }
        },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          {
            from: [
              {
                podSelector: {
                  matchLabels: { "app.kubernetes.io/component": "sandbox-exec" }
                }
              }
            ],
            ports: [{ protocol: "TCP", port: 3128 }]
          }
        ],
        egress: [
          {
            to: [
              { ipBlock: { cidr: "169.254.20.10/32" } },
              { ipBlock: { cidr: "34.118.224.10/32" } }
            ],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 }
            ]
          },
          {
            to: [
              {
                ipBlock: {
                  cidr: "0.0.0.0/0",
                  except: buildRestrictedProxyDeniedCidrs(inventory)
                }
              }
            ],
            ports: [
              { protocol: "TCP", port: 80 },
              { protocol: "TCP", port: 443 }
            ]
          }
        ]
      }
    },
    natProbeNetworkPolicy: {
      metadata: { name: "sandbox-nat-identity-probe-isolation" },
      spec: {
        podSelector: {
          matchLabels: { "sandbox.gke.io/adr146-nat-probe": "true" }
        },
        policyTypes: ["Ingress", "Egress"],
        ingress: [],
        egress: [
          {
            to: [
              { ipBlock: { cidr: "169.254.20.10/32" } },
              { ipBlock: { cidr: "34.118.224.10/32" } }
            ],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 }
            ]
          },
          {
            to: [
              {
                ipBlock: {
                  cidr: "0.0.0.0/0",
                  except: buildRestrictedProxyDeniedCidrs(inventory)
                }
              }
            ],
            ports: [{ protocol: "TCP", port: 443 }]
          }
        ]
      }
    },
    metadataDaemonSet: {
      metadata: { name: "gke-metadata-server" },
      status: { desiredNumberScheduled: 1, numberReady: 1 }
    },
    trustedProbePods: [{ name: "sandbox-control", phase: "Running", podIP: "10.107.200.10" }],
    dynamicProbesRun: false
  };
}

test("inventory locks exact live cluster and non-overlapping sandbox range", () => {
  const inventory = loadInventory();
  assert.deepEqual(validateInventory(inventory), []);
  assert.equal(inventory.network.vpcName, "default");
  assert.equal(inventory.network.subnetName, "default");
  assert.equal(
    cidrsOverlap(inventory.cidrs.sandboxPodSecondary, inventory.cidrs.podDefault),
    false
  );
});

test("VPC deny excludes node-primary, Pod, Service, metadata, and broad 10/8", () => {
  const inventory = loadInventory();
  const denied = buildFirewallDenyDestinations(inventory);
  assert.ok(!denied.includes("10.0.0.0/8"));
  assert.ok(!denied.includes(inventory.cidrs.podDefault));
  assert.ok(!denied.includes(inventory.cidrs.sandboxPodSecondary));
  assert.ok(!denied.includes(inventory.cidrs.service));
  assert.ok(!denied.includes("169.254.0.0/16"));
  assert.ok(!denied.includes(inventory.cidrs.nodePrimary));
  assert.ok(denied.includes(inventory.cidrs.peers.redis));
});

test("inventory validation rejects accidental node/Pod/Service overlap without required-path ALLOW", () => {
  const inventory = loadInventory();
  const broken = structuredClone(inventory);
  broken.cidrs.vpcSubnetDenies.push("10.0.0.0/8");
  const errors = validateInventory(broken);
  assert.ok(errors.some((error) => /Pod\/Service\/metadata/.test(error)));
  assert.ok(errors.some((error) => /broad 10/.test(error)));
});

test("firewall command denies all protocols only to reviewed destinations", () => {
  const inventory = loadInventory();
  const command = buildPhasePlans(inventory)["apply-firewall"][0];
  assert.ok(command.argv.includes("--rules=all"));
  const ranges = command.argv.find((arg) => arg.startsWith("--destination-ranges="));
  assert.ok(!ranges.includes(inventory.cidrs.nodePrimary));
  assert.ok(!ranges.includes(inventory.cidrs.service));
  assert.ok(!ranges.includes(inventory.cidrs.podDefault));
});

test("NAT covers the primary plus dedicated sandbox secondary for default GKE SNAT", () => {
  const inventory = loadInventory();
  const plans = buildPhasePlans(inventory);
  assert.ok(
    plans.prepare
      .find((command) => command.id === "create-sandbox-pod-secondary")
      .argv.includes("--add-secondary-ranges=persai-sandbox-pods=10.109.0.0/20")
  );
  const nat = plans["apply-nat"].find((command) => command.id === "create-nat").argv;
  assert.ok(nat.includes("--nat-custom-subnet-ip-ranges=default,default:persai-sandbox-pods"));
  assert.ok(!nat.includes("--nat-all-subnet-ip-ranges"));
  const pool = plans["apply-sandbox-pool"].find(
    (command) => command.id === "create-private-sandbox-pool"
  ).argv;
  assert.ok(pool.includes("--pod-ipv4-range=persai-sandbox-pods"));
  assert.ok(pool.includes("--sandbox=type=gvisor"));
  assert.ok(!pool.some((argument) => argument.startsWith("--create-pod-ipv4-range=")));
  assert.ok(plans["apply-sandbox-pool"].some((command) => command.id === "cordon-public-pool"));
});

test("private pool create requires GKE Sandbox gVisor, not labels alone", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  assert.equal(evaluateLiveFoundation(inventory, live).ok, true);
  delete live.privatePool.config.sandboxConfig;
  const evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(evaluated.ok, false);
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "private-pool-present-exact" && !entry.ok)
  );
});

test("NAT consumer inventory includes primary-private and selected-secondary alias consumers", () => {
  const inventory = loadInventory();
  const network = `projects/test/global/networks/${inventory.network.vpcName}`;
  const subnetwork = `projects/test/regions/europe-west1/subnetworks/${inventory.network.subnetName}`;
  const instances = [
    {
      name: "private-primary",
      zone: "zones/europe-west1-b",
      networkInterfaces: [{ network, subnetwork, networkIP: "10.132.0.2" }]
    },
    {
      name: "external-selected-alias",
      zone: "zones/europe-west1-b",
      networkInterfaces: [
        {
          network,
          subnetwork,
          networkIP: "10.132.0.3",
          accessConfigs: [{ natIP: "34.1.1.9" }],
          aliasIpRanges: [{ subnetworkRangeName: "persai-sandbox-pods" }]
        }
      ]
    },
    {
      name: "external-unselected",
      zone: "zones/europe-west1-b",
      networkInterfaces: [
        {
          network,
          subnetwork,
          networkIP: "10.132.0.4",
          accessConfigs: [{ natIP: "34.1.1.10" }],
          aliasIpRanges: [{ subnetworkRangeName: "other-pods" }]
        }
      ]
    }
  ];
  const eligible = inventoryNatEligibleConsumers(inventory, instances, []);
  assert.deepEqual(
    eligible.map((consumer) => [consumer.name, consumer.eligibleVia]),
    [
      ["private-primary", ["PRIMARY_IP_RANGE"]],
      ["external-selected-alias", ["persai-sandbox-pods"]]
    ]
  );
});

test("NAT egress identity accepts only an exact reserved valid IPv4 address", () => {
  const addresses = [{ address: "34.1.1.1" }, { address: "34.1.1.2" }];
  assert.equal(natEgressIdentityMatches("34.1.1.2", addresses), true);
  assert.equal(natEgressIdentityMatches("34.1.1.3", addresses), false);
  assert.equal(natEgressIdentityMatches("999.1.1.1", addresses), false);
  assert.equal(natEgressIdentityMatches("34.1.1.2\nheaders", addresses), false);
});

test("apply phase order excludes explicit maintenance retirement", () => {
  assert.deepEqual(APPLY_PHASE_ORDER, [
    "prepare",
    "apply-nat",
    "apply-firewall",
    "apply-calico",
    "apply-sandbox-pool"
  ]);
  const inventory = loadInventory();
  assert.ok(
    buildPhasePlans(inventory)["retire-public-pool"].some(
      (item) => item.id === "delete-public-pool"
    )
  );
});

test("preflight fails on identity, CIDR, secondary, peer, or maintenance drift", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.identity.account = "other@example.com";
  live.subnet.secondaryIpRanges.push({ rangeName: "unexpected", ipCidrRange: "10.109.0.0/21" });
  live.peerRoutes = [];
  live.cluster.maintenancePolicy = { window: { dailyMaintenanceWindow: {} } };
  const evaluated = evaluatePreflight(inventory, live, "verify");
  assert.equal(evaluated.ok, false);
  for (const id of [
    "gcloud-account",
    "existing-secondary-ranges",
    "sandbox-secondary-available",
    "peer-route-inventory",
    "maintenance-policy"
  ]) {
    assert.ok(
      evaluated.checks.some((entry) => entry.id === id && !entry.ok),
      id
    );
  }
});

test("preflight allows exact current disabled-NP state before Calico apply", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.cluster.networkPolicy = {};
  live.cluster.addonsConfig.networkPolicyConfig.disabled = true;
  live.privatePool = null;
  live.publicPool = {
    name: "sandbox-pool",
    autoscaling: { enabled: true, minNodeCount: 1, maxNodeCount: 2 },
    config: {
      machineType: "e2-standard-4",
      diskSizeGb: 100,
      imageType: "COS_CONTAINERD",
      serviceAccount: "default",
      labels: { "sandbox.gke.io/runtime": "gvisor", workload: "sandbox" },
      taints: [{ key: "sandbox.gke.io/runtime", value: "gvisor", effect: "NO_SCHEDULE" }]
    },
    networkConfig: {
      enablePrivateNodes: false,
      podRange: "gke-personal-ai-gke-pods-3d820e68",
      podIpv4CidrBlock: "10.107.128.0/17"
    }
  };
  const evaluated = evaluatePreflight(inventory, live, "apply-calico");
  assert.equal(
    evaluated.ok,
    true,
    evaluated.checks
      .filter((entry) => !entry.ok)
      .map((entry) => `${entry.id}: ${entry.detail}`)
      .join("; ")
  );
});

test("Calico apply accepts the safe addon-enabled enforcement-disabled intermediate state", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.cluster.networkPolicy = {};
  live.cluster.addonsConfig.networkPolicyConfig.disabled = false;
  assert.equal(evaluatePreflight(inventory, live, "apply-calico").ok, true);
});

test("repair preflight remains runnable after legacy public pool deletion", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.publicPool = null;
  for (const phase of [
    "prepare",
    "apply-nat",
    "apply-firewall",
    "apply-calico",
    "apply-sandbox-pool"
  ]) {
    assert.equal(
      evaluatePreflight(inventory, live, phase).ok,
      true,
      `${phase} must accept exact private-pool replacement state`
    );
  }
  live.privatePool = null;
  assert.equal(
    evaluatePreflight(inventory, live, "apply-sandbox-pool").ok,
    true,
    "private pool recreation must remain possible after legacy pool deletion"
  );
});

test("preflight detects kube-dns and NodeLocal DNS address drift", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.kubeDnsService.spec.clusterIP = "34.118.224.11";
  live.nodeLocalDnsAddresses = ["169.254.20.11", "34.118.224.10"];
  const evaluated = evaluatePreflight(inventory, live, "verify");
  assert.ok(evaluated.checks.some((entry) => entry.id === "kube-dns-service-address" && !entry.ok));
  assert.ok(evaluated.checks.some((entry) => entry.id === "node-local-dns-addresses" && !entry.ok));
});

test("preflight resolves Service and managed listener controls from live facts", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  const targets = resolveRestrictedProbeTargets(inventory, live);
  assert.deepEqual(
    targets.slice(0, 5).map((target) => [target.label, target.host, target.port]),
    [
      ["Kubernetes API Service", "34.118.224.1", 443],
      ["metrics-server Service", "34.118.226.126", 443],
      ["Redis", "10.107.45.68", 6379],
      ["Filestore NFS", "10.105.140.58", 2049],
      ["Cloud SQL PostgreSQL", "10.11.128.5", 5432]
    ]
  );
  live.metricsServerService.spec.clusterIP = "35.1.1.1";
  live.redisInstance.host = "10.107.45.80";
  const evaluated = evaluatePreflight(inventory, live, "verify");
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "probe-service-listeners-live" && !entry.ok)
  );
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "probe-managed-listeners-live" && !entry.ok)
  );
});

test("preflight rejects disabled default SNAT or global non-masquerade", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.cluster.defaultSnatStatus = { disabled: true };
  live.ipMasqAgentConfig = { data: { config: "nonMasqueradeCIDRs:\n- 0.0.0.0/0\n" } };
  const evaluated = evaluatePreflight(inventory, live, "verify");
  assert.ok(evaluated.checks.some((entry) => entry.id === "default-gke-snat-enabled" && !entry.ok));
  assert.ok(evaluated.checks.some((entry) => entry.id === "no-global-non-masquerade" && !entry.ok));
});

test("existing resource drift fails closed", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.nat.natIpAllocateOption = "AUTO_ONLY";
  live.nat.subnetworks[0].sourceIpRangesToNat = ["LIST_OF_SECONDARY_IP_RANGES"];
  live.firewall.denied = [{ IPProtocol: "tcp" }];
  live.privatePool.config.serviceAccount = "default";
  const evaluated = evaluatePreflight(inventory, live, "verify");
  for (const id of [
    "nat-exact-or-absent",
    "firewall-exact-or-absent",
    "private-pool-exact-or-absent"
  ]) {
    assert.ok(
      evaluated.checks.some((entry) => entry.id === id && !entry.ok),
      id
    );
  }
});

test("live verify checks all forbidden IAM roles, subnet, NAT, firewall, pools, and Calico", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  assert.equal(evaluateLiveFoundation(inventory, live).ok, true);
  const { email } = nodeServiceAccountIdentity(inventory);
  live.nodeSaPolicy.bindings.push({
    role: "roles/container.admin",
    members: [`serviceAccount:${email}`]
  });
  live.subnet.logConfig.filter = "bad";
  live.allNodes[0].calicoReady = false;
  const evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(evaluated.ok, false);
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "node-sa-no-forbidden-roles" && !entry.ok)
  );
  assert.ok(evaluated.checks.some((entry) => entry.id === "all-nodes-calico-ready" && !entry.ok));
});

test("live verify rejects all-namespace or cluster RBAC and stale/widened policies", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.execClusterRoleBindings = [{ metadata: { name: "unexpected" } }];
  live.legacyExecNetworkPolicy = { metadata: { name: "sandbox-exec-deny-egress" } };
  live.execNetworkPolicy.spec.egress[0].ports = [{ protocol: "UDP", port: 53 }];
  live.proxyNetworkPolicy.spec.egress[1].to[0].ipBlock.except = ["10.0.0.0/8"];
  const evaluated = evaluateLiveFoundation(inventory, live);
  for (const id of [
    "exec-ksa-no-rbac",
    "legacy-exec-networkpolicy-absent",
    "exec-networkpolicy-structural",
    "proxy-networkpolicy-structural"
  ]) {
    assert.ok(
      evaluated.checks.some((entry) => entry.id === id && !entry.ok),
      id
    );
  }
});

test("live verify rejects extra or narrowing top-level NetworkPolicy selectors", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.execNetworkPolicy.spec.podSelector.matchLabels.extra = "widened";
  live.proxyNetworkPolicy.spec.podSelector.matchExpressions = [
    { key: "app.kubernetes.io/name", operator: "Exists" }
  ];
  live.natProbeNetworkPolicy.spec.podSelector.matchLabels.extra = "wrong";
  const evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "exec-networkpolicy-structural" && !entry.ok)
  );
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "proxy-networkpolicy-structural" && !entry.ok)
  );
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "nat-probe-networkpolicy-structural" && !entry.ok)
  );
});

test("live verify fails on shared NAT consumers, missing controls, or metadata unready", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.natEligibleConsumers.push({
    name: "unrelated-private-vm",
    zone: "europe-west1-b",
    networkIp: "10.132.0.99",
    pool: null,
    tags: []
  });
  live.trustedProbePods = [];
  live.metadataDaemonSet.status.numberReady = 0;
  const evaluated = evaluateLiveFoundation(inventory, live);
  for (const id of [
    "nat-consumers-currently-sandbox-exclusive",
    "trusted-probe-control-available",
    "gke-metadata-server-ready"
  ]) {
    assert.ok(
      evaluated.checks.some((entry) => entry.id === id && !entry.ok),
      id
    );
  }
});

test("Calico readiness rejects empty selectors and stale unrecreated nodes", () => {
  const inventory = loadInventory();
  assert.equal(
    evaluateCalicoReadiness(inventory, { allNodes: [], calicoDaemonSets: [] }).ok,
    false
  );
  const live = baseLive(inventory);
  live.preApplyNodeUids = ["new-node"];
  assert.equal(evaluateCalicoReadiness(inventory, live).ok, false);
});

test("public pool retirement requires operator confirmation and zero old-pool exec pods", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.publicPool = {
    name: "sandbox-pool",
    config: { machineType: "e2-standard-4" }
  };
  live.publicPoolNodes = [{ name: "old-node", unschedulable: true }];
  live.execPods = [{ name: "active-exec", nodeName: "old-node", phase: "Running" }];
  assert.equal(evaluateRetirementGate(inventory, live, undefined).ok, false);
  assert.equal(
    evaluateRetirementGate(inventory, live, "NO_ACTIVE_SANDBOX_JOBS_CONFIRMED").ok,
    false
  );
  live.execPods = [
    {
      name: "ses-fixture",
      phase: "Running",
      nodeName: "private-node",
      serviceAccountName: "sandbox-exec-sa",
      automountServiceAccountToken: false,
      runtimeClassName: "gvisor",
      labels: { "app.kubernetes.io/component": "sandbox-exec" }
    }
  ];
  assert.equal(
    evaluateRetirementGate(inventory, live, "NO_ACTIVE_SANDBOX_JOBS_CONFIRMED").ok,
    true
  );
  live.publicPoolNodes = [{ name: "old-node", unschedulable: false }];
  assert.equal(
    evaluatePublicPoolCordon(inventory, live).ok,
    false,
    "uncordoned legacy nodes must fail closed"
  );
});

test("static deploy truth passes values-dev and structural/probe separation", () => {
  const inventory = loadInventory();
  const valuesDevText = readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8");
  assert.equal(runStaticDeployTruth(inventory, { valuesDevText }).ok, true);
});

test("Helm render has identity-less exec KSA, empty ingress, tight DNS, and no full-public mode", () => {
  const rendered = spawnSync(
    "helm",
    ["template", "persai-dev", "infra/helm", "-f", "infra/helm/values-dev.yaml"],
    { cwd: repoRoot, encoding: "utf8", shell: false }
  );
  assert.equal(rendered.status, 0, rendered.stderr);
  const yaml = rendered.stdout;
  assert.match(yaml, /kind: ServiceAccount\nmetadata:\n  name: sandbox-exec-sa/);
  const execSa = yaml.slice(
    yaml.indexOf("name: sandbox-exec-sa"),
    yaml.indexOf("---", yaml.indexOf("name: sandbox-exec-sa"))
  );
  assert.match(execSa, /automountServiceAccountToken: false/);
  assert.doesNotMatch(execSa, /iam\.gke\.io|RoleBinding|annotations:/);
  assert.match(
    yaml,
    /name: sandbox-exec-isolation[\s\S]*policyTypes:\n    - Ingress\n    - Egress\n  # Untrusted execution pods are outbound-only in every future egress mode\.\n  ingress: \[\]/
  );
  assert.match(
    yaml,
    /cidr: "169\.254\.20\.10\/32"[\s\S]*cidr: "34\.118\.224\.10\/32"[\s\S]*protocol: UDP\n          port: 53[\s\S]*protocol: TCP\n          port: 53/
  );
  assert.doesNotMatch(yaml, /kubernetes\.io\/metadata\.name: kube-system/);
  const proxyPolicy = yaml.slice(
    yaml.indexOf("name: sandbox-egress-proxy-isolation"),
    yaml.indexOf("---", yaml.indexOf("name: sandbox-egress-proxy-isolation"))
  );
  for (const cidr of buildRestrictedProxyDeniedCidrs(loadInventory())) {
    assert.match(proxyPolicy, new RegExp(cidr.replaceAll(".", "\\.").replace("/", "\\/")));
  }
  assert.match(
    yaml,
    /name: sandbox-nat-identity-probe-isolation[\s\S]*sandbox\.gke\.io\/adr146-nat-probe: "true"[\s\S]*ingress: \[\][\s\S]*port: 443/
  );
  assert.doesNotMatch(yaml, /full-public|full_public/);
});

test("Helm fails closed when required proxy deny or DNS inventories are absent", () => {
  for (const override of [
    "networkPolicy.sandboxEgress.requiredDeniedCidrs=[]",
    "networkPolicy.sandboxDns.allowedCidrs=[]"
  ]) {
    const rendered = spawnSync(
      "helm",
      [
        "template",
        "persai-dev",
        "infra/helm",
        "-f",
        "infra/helm/values-dev.yaml",
        "--set-json",
        override
      ],
      { cwd: repoRoot, encoding: "utf8", shell: false }
    );
    assert.notEqual(rendered.status, 0, override);
  }
});

test("Squid denial status validator accepts only exact HTTP 403", () => {
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("403"), true);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("403\n"), true);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny(" 403 "), true);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("000"), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny(""), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny(undefined), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("200"), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("404"), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("502"), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("403 Forbidden"), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("40"), false);
  assert.equal(squidDenialHttpStatusIndicatesProxyDeny("4030"), false);
});

test("restricted probes use audited listeners and treat refusal as reachable", () => {
  const source = readFileSync(
    path.join(repoRoot, "infra/bootstrap/adr146-sandbox-egress-foundation.mjs"),
    "utf8"
  );
  assert.match(source, /resolveRestrictedProbeTargets/);
  assert.match(source, /trusted positive control failed/);
  assert.match(source, /nat-egress-ip/);
  assert.match(source, /natEgressIdentityMatches\(observedEgressIp, live\.natAddresses\)/);
  assert.match(source, /validateRestrictedProbePod/);
  assert.match(source, /validateNatProbePod/);
  assert.match(source, /squidDeniedPublicHttpsHostname/);
  assert.match(source, /squidDenialHttpStatusIndicatesProxyDeny/);
  assert.match(source, /-w[\s\S]*%\{http_code\}/);
  assert.match(source, /-o[\s\S]*\/dev\/null/);
  assert.match(source, /errno\.ENETUNREACH,errno\.EHOSTUNREACH,errno\.ETIMEDOUT/);
  assert.match(source, /ECONNREFUSED is not denial/);
  assert.match(source, /kube-dns Pod/);
  assert.match(source, /Unclaimed by this phase: inbound denial/);
  assert.doesNotMatch(source, /dnsPodIps\[0\]|split\("\/"\)\[0\]/);
  assert.doesNotMatch(source, /34\.118\.224\.1|34\.118\.226\.126|10\.107\.45\.68|10\.105\.140\.58/);
  assert.doesNotMatch(source, /Authorization|auth header|query string|file contents/i);
  assert.doesNotMatch(source, /denialExitIndicatesDrop/);
});

test("live verify rejects zero exec pods and default-SA pods for KSA wiring", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.execPods = [];
  let evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-object-ready" && entry.ok));
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-live-wiring" && !entry.ok));
  live.execPods = [
    {
      name: "bad-exec",
      phase: "Running",
      nodeName: "private-node",
      serviceAccountName: "default",
      automountServiceAccountToken: false,
      runtimeClassName: "gvisor",
      labels: { "app.kubernetes.io/component": "sandbox-exec" }
    }
  ];
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-live-wiring" && !entry.ok));
});

test("NetworkPolicy DNS and selector matchers reject widened shapes", () => {
  const inventory = loadInventory();
  const expectedDns = [
    inventory.network.dns.nodeLocalAddress,
    inventory.network.dns.kubeDnsServiceAddress
  ];
  assert.equal(
    exactIpBlockOnlyPeers(
      [{ ipBlock: { cidr: expectedDns[0] } }, { ipBlock: { cidr: expectedDns[1] } }],
      expectedDns
    ),
    true
  );
  assert.equal(
    exactIpBlockOnlyPeers(
      [
        { ipBlock: { cidr: expectedDns[0] }, namespaceSelector: {} },
        { ipBlock: { cidr: expectedDns[1] } }
      ],
      expectedDns
    ),
    false
  );
  assert.equal(
    exactIpBlockOnlyPeers(
      [
        { ipBlock: { cidr: expectedDns[0] }, podSelector: { matchLabels: { a: "b" } } },
        { ipBlock: { cidr: expectedDns[1] } }
      ],
      expectedDns
    ),
    false
  );
  assert.equal(
    exactPodSelector(
      {
        matchLabels: { "app.kubernetes.io/component": "sandbox-exec" },
        matchExpressions: [{ key: "app", operator: "Exists" }]
      },
      { "app.kubernetes.io/component": "sandbox-exec" }
    ),
    false
  );
  assert.equal(
    exactPeerPodSelector(
      {
        podSelector: { matchLabels: { "app.kubernetes.io/component": "sandbox-exec" } },
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "persai-dev" } }
      },
      { "app.kubernetes.io/component": "sandbox-exec" }
    ),
    false
  );
  const live = baseLive(inventory);
  live.execNetworkPolicy.spec.egress[0].to[0].namespaceSelector = {
    matchLabels: { ns: "kube-system" }
  };
  live.proxyNetworkPolicy.spec.ingress[0].from[0].namespaceSelector = {
    matchLabels: { "kubernetes.io/metadata.name": "persai-dev" }
  };
  live.natProbeNetworkPolicy.spec.egress[0].to.push({
    podSelector: { matchLabels: { "k8s-app": "kube-dns" } }
  });
  const evaluated = evaluateLiveFoundation(inventory, live);
  for (const id of [
    "exec-networkpolicy-structural",
    "proxy-networkpolicy-structural",
    "nat-probe-networkpolicy-structural"
  ]) {
    assert.ok(
      evaluated.checks.some((entry) => entry.id === id && !entry.ok),
      id
    );
  }
});

test("probe helpers bind restricted and NAT pods to the private gVisor contour", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  const okPod = live.execPods[0];
  assert.equal(validateRestrictedProbePod(okPod, live, inventory).ok, true);
  assert.equal(
    validateRestrictedProbePod({ ...okPod, runtimeClassName: "runc" }, live, inventory).ok,
    false
  );
  assert.equal(
    validateRestrictedProbePod({ ...okPod, serviceAccountName: "default" }, live, inventory).ok,
    false
  );
  const natPod = {
    status: { phase: "Running" },
    metadata: {
      labels: {
        "sandbox.gke.io/adr146-nat-probe": "true",
        "app.kubernetes.io/component": "sandbox-exec"
      }
    },
    spec: {
      nodeName: "private-node",
      serviceAccountName: "sandbox-exec-sa",
      automountServiceAccountToken: false,
      runtimeClassName: "gvisor",
      containers: [{ name: "probe", env: [] }]
    }
  };
  assert.equal(validateNatProbePod(natPod, live, inventory).ok, true);
  natPod.spec.containers[0].env = [{ name: "HTTPS_PROXY", value: "http://proxy:3128" }];
  assert.equal(validateNatProbePod(natPod, live, inventory).ok, false);
});

test("Calico-owned probe targets require live kube-dns and trusted Pod IPs", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  const calicoTargets = resolveCalicoOwnedProbeTargets(inventory, live);
  assert.equal(calicoTargets.length, 3);
  assert.deepEqual(
    calicoTargets.map((target) => [target.label, target.host, target.port, target.protocol]),
    [
      ["kube-dns Pod UDP/53", "10.107.128.20", 53, "UDP"],
      ["kube-dns Pod TCP/53", "10.107.128.20", 53, "TCP"],
      ["trusted sandbox control-plane Pod", "10.107.200.10", 3013, "TCP"]
    ]
  );
  live.dnsPodIps = [];
  live.trustedProbePods = [{ name: "sandbox-control", phase: "Running" }];
  const evaluated = evaluatePreflight(inventory, live, "verify");
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "probe-calico-owned-targets-live" && !entry.ok)
  );
  const missing = resolveRestrictedProbeTargets(inventory, live).filter(
    (target) => target.calicoOwned && (!target.host || !target.port)
  );
  assert.ok(missing.length > 0, "absent Calico targets must not resolve as probeable");
});

test("conflicting higher-priority EGRESS ALLOW firewall rules are rejected", () => {
  const inventory = loadInventory();
  const conflicts = inventoryConflictingEgressAllows(inventory, [
    {
      name: "allow-all-egress",
      direction: "EGRESS",
      priority: 800,
      allowed: [{ IPProtocol: "all" }],
      destinationRanges: ["0.0.0.0/0"],
      targetTags: [inventory.firewall.networkTag]
    },
    {
      name: "lower-priority-allow",
      direction: "EGRESS",
      priority: 1000,
      allowed: [{ IPProtocol: "tcp" }],
      destinationRanges: ["10.5.48.0/20"],
      targetTags: [inventory.firewall.networkTag]
    }
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].name, "allow-all-egress");
  const live = baseLive(inventory);
  live.conflictingEgressAllows = conflicts;
  const evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(
    evaluated.checks.some(
      (entry) => entry.id === "no-conflicting-higher-priority-egress-allows" && !entry.ok
    )
  );
});
