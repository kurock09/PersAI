import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  ADR146_CONTROLLED_PROBE_LABEL,
  ADR146_CONTROLLED_PROBE_POD_NAMES,
  ADR146_PROBE_ACTIVE_DEADLINE_SECONDS,
  ADR146_PROBE_RESOURCES,
  EXEC_KSA_INERT_ANNOTATION_KEYS,
  GKE_MANAGED_SANDBOX_RUNTIME_KEY,
  GKE_SANDBOX_TYPE_GVISOR,
  KUBERNETES_REJECTED_TOLERATION_OPERATOR_CASINGS,
  KUBERNETES_TOLERATION_OPERATOR_EQUAL,
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
  execKsaAnnotationsAreIdentityLess,
  exactIpBlockOnlyPeers,
  exactPeerPodSelector,
  exactPodSelector,
  networkPolicyIngressIsEmpty,
  FLOW_LOG_METADATA_API_TO_CLI,
  flowLogAggregationCliArg,
  flowLogMetadataCliArg,
  inventoryConflictingEgressAllows,
  inventoryNatEligibleConsumers,
  isAcceptedGvisorSandboxType,
  isAdr146ControlledProbePod,
  isNetworkPolicyAddonEnabled,
  listControlledProbeCleanupTargets,
  loadInventory,
  mapExecPodFromKubectlItem,
  natEgressIdentityMatches,
  nodeServiceAccountIdentity,
  operatorOwnedNodeLabels,
  operatorOwnedNodeTaints,
  privatePoolMatches,
  probeManifestToValidatorPod,
  readLiveSandboxConfigType,
  renderPlanText,
  renderProbeManifestYaml,
  resolveCalicoOwnedProbeTargets,
  resolveRestrictedProbeTargets,
  runStaticDeployTruth,
  selectApplySandboxPoolCommandIds,
  selectPrepareCommandIds,
  selectRealExecPodsForKsaWiring,
  squidDenialHttpStatusIndicatesProxyDeny,
  validateControlledProbeGvisorToleration,
  validateControlledProbeHardening,
  validateInventory,
  validateNatProbePod,
  validateRequiredGvisorTolerationShape,
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
    vpcSubnetRoutes: [
      inventory.cidrs.nodePrimary,
      ...inventory.cidrs.vpcSubnetDenies,
      inventory.cidrs.sandboxPodSecondary
    ],
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
    calicoDaemonSets: [{ name: "calico-node", desired: 1, current: 1, ready: 1 }],
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

test("subnet flow-log command emits gcloud CLI enums, not API describe enums", () => {
  const inventory = loadInventory();
  assert.equal(inventory.network.flowLogs.metadata, "INCLUDE_ALL_METADATA");
  assert.equal(inventory.network.flowLogs.aggregationInterval, "INTERVAL_5_SEC");
  assert.equal(flowLogMetadataCliArg(inventory.network.flowLogs.metadata), "include-all");
  assert.equal(
    flowLogAggregationCliArg(inventory.network.flowLogs.aggregationInterval),
    "interval-5-sec"
  );
  assert.notEqual(
    flowLogMetadataCliArg(inventory.network.flowLogs.metadata),
    inventory.network.flowLogs.metadata
  );

  const command = buildPhasePlans(inventory).prepare.find(
    (entry) => entry.id === "enable-subnet-flow-logs"
  );
  assert.ok(command.argv.includes("--logging-metadata=include-all"));
  assert.ok(command.argv.includes("--logging-aggregation-interval=interval-5-sec"));
  assert.ok(!command.argv.includes("--logging-metadata=INCLUDE_ALL_METADATA"));
  assert.ok(!command.argv.includes("--logging-metadata=INCLUDE_ALL"));
  assert.ok(!command.argv.includes("--logging-aggregation-interval=INTERVAL_5_SEC"));
});

test("live flow-log matcher keeps API describe metadata INCLUDE_ALL_METADATA", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  assert.equal(live.subnet.logConfig.metadata, "INCLUDE_ALL_METADATA");
  assert.equal(evaluateLiveFoundation(inventory, live).ok, true);

  live.subnet.logConfig.metadata = "include-all";
  const cliShaped = evaluateLiveFoundation(inventory, live);
  assert.equal(cliShaped.ok, false);
  assert.ok(cliShaped.checks.some((entry) => entry.id === "subnet-flow-logs-exact" && !entry.ok));

  live.subnet.logConfig.metadata = "INCLUDE_ALL";
  const shortForm = evaluateLiveFoundation(inventory, live);
  assert.equal(shortForm.ok, false);
  assert.ok(shortForm.checks.some((entry) => entry.id === "subnet-flow-logs-exact" && !entry.ok));
});

test("flow-log CLI mapping rejects unknown API enums", () => {
  assert.throws(() => flowLogMetadataCliArg("INCLUDE_ALL"), /unsupported subnet flow-log metadata/);
  assert.throws(
    () => flowLogMetadataCliArg("INCLUDE_ALL_METADATA_TYPO"),
    /unsupported subnet flow-log metadata/
  );
  assert.throws(
    () => flowLogAggregationCliArg("INTERVAL_5_SECOND"),
    /unsupported subnet flow-log aggregationInterval/
  );
  assert.equal(FLOW_LOG_METADATA_API_TO_CLI.INCLUDE_ALL_METADATA, "include-all");
});

test("partial prepare resume skips exact SA/roles/IPs and continues at subnet steps", () => {
  const inventory = loadInventory();
  const { email } = nodeServiceAccountIdentity(inventory);
  const before = {
    nodeSa: { email, disabled: false },
    nodeSaPolicy: {
      bindings: inventory.nodeServiceAccount.requiredRoles.map((role) => ({
        role,
        members: [`serviceAccount:${email}`]
      }))
    },
    natAddresses: Array.from({ length: inventory.nat.staticAddressCount }, (_, index) => ({
      name: `persai-sandbox-nat-${index + 1}`,
      address: `34.1.1.${index + 1}`
    })),
    subnet: {
      privateIpGoogleAccess: false,
      enableFlowLogs: false,
      logConfig: null,
      secondaryIpRanges: Object.entries(inventory.network.existingSecondaryRanges).map(
        ([rangeName, ipCidrRange]) => ({ rangeName, ipCidrRange })
      )
    }
  };

  assert.deepEqual(selectPrepareCommandIds(inventory, before), [
    "enable-subnet-flow-logs",
    "ensure-private-google-access",
    "create-sandbox-pod-secondary"
  ]);

  const complete = baseLive(inventory);
  assert.deepEqual(selectPrepareCommandIds(inventory, complete), []);
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

test("private pool matcher accepts live GKE sandboxConfig.type=GVISOR casing", () => {
  const inventory = loadInventory();
  assert.equal(isAcceptedGvisorSandboxType("gvisor"), true);
  assert.equal(isAcceptedGvisorSandboxType("GVISOR"), true);
  assert.equal(isAcceptedGvisorSandboxType("Gvisor"), true);
  assert.equal(isAcceptedGvisorSandboxType(""), false);
  assert.equal(isAcceptedGvisorSandboxType(undefined), false);
  assert.equal(isAcceptedGvisorSandboxType("runc"), false);
  assert.equal(isAcceptedGvisorSandboxType("GVISOR "), false);
  const live = baseLive(inventory);
  live.privatePool.config.sandboxConfig = { type: "GVISOR" };
  assert.equal(readLiveSandboxConfigType(live.privatePool), "GVISOR");
  assert.equal(privatePoolMatches(inventory, live.privatePool), true);
  assert.equal(evaluateLiveFoundation(inventory, live).ok, true);
});

test("private pool matcher rejects missing or non-gVisor sandboxConfig.type", () => {
  const inventory = loadInventory();
  const missing = baseLive(inventory);
  delete missing.privatePool.config.sandboxConfig;
  assert.equal(privatePoolMatches(inventory, missing.privatePool), false);
  assert.equal(evaluateLiveFoundation(inventory, missing).ok, false);

  const wrong = baseLive(inventory);
  wrong.privatePool.config.sandboxConfig = { type: "runc" };
  assert.equal(isAcceptedGvisorSandboxType(readLiveSandboxConfigType(wrong.privatePool)), false);
  assert.equal(privatePoolMatches(inventory, wrong.privatePool), false);
  assert.equal(evaluateLiveFoundation(inventory, wrong).ok, false);
});

test("apply-sandbox-pool resume planner skips create for exact private pool including GVISOR", () => {
  const inventory = loadInventory();
  assert.deepEqual(selectApplySandboxPoolCommandIds(inventory, { privatePool: null }), [
    "create-private-sandbox-pool"
  ]);
  const exactLower = baseLive(inventory);
  assert.deepEqual(selectApplySandboxPoolCommandIds(inventory, exactLower), []);
  const exactUpper = baseLive(inventory);
  exactUpper.privatePool.config.sandboxConfig = { type: "GVISOR" };
  assert.deepEqual(selectApplySandboxPoolCommandIds(inventory, exactUpper), []);
  const drifted = baseLive(inventory);
  drifted.privatePool.config.sandboxConfig = { type: "runc" };
  assert.deepEqual(selectApplySandboxPoolCommandIds(inventory, drifted), [
    "create-private-sandbox-pool"
  ]);
  assert.equal(inventory.sandboxNodePool.sandboxType, GKE_SANDBOX_TYPE_GVISOR);
});

test("private pool create omits GKE-managed sandbox label and taint but keeps sandbox flag and workload label", () => {
  const inventory = loadInventory();
  assert.equal(
    inventory.sandboxNodePool.labels[GKE_MANAGED_SANDBOX_RUNTIME_KEY],
    "gvisor",
    "inventory still expects resulting GKE-managed label for live match"
  );
  assert.deepEqual(operatorOwnedNodeLabels(inventory.sandboxNodePool.labels), {
    workload: "sandbox"
  });
  assert.deepEqual(operatorOwnedNodeTaints(inventory.sandboxNodePool.taints), []);
  const operatorTaint = { key: "persai.dev/dedicated", value: "sandbox", effect: "NO_SCHEDULE" };
  assert.deepEqual(
    operatorOwnedNodeTaints([...inventory.sandboxNodePool.taints, operatorTaint]),
    [operatorTaint],
    "filter removes only the managed sandbox taint"
  );
  const pool = buildPhasePlans(inventory)["apply-sandbox-pool"].find(
    (command) => command.id === "create-private-sandbox-pool"
  ).argv;
  assert.ok(pool.includes("--sandbox=type=gvisor"));
  assert.ok(pool.includes("--node-labels=workload=sandbox"));
  assert.ok(
    !pool.some(
      (argument) =>
        typeof argument === "string" &&
        argument.startsWith("--node-labels=") &&
        argument.includes(`${GKE_MANAGED_SANDBOX_RUNTIME_KEY}=`)
    ),
    "create must not manually set GKE-managed sandbox.gke.io/runtime label"
  );
  assert.ok(
    !pool.some((argument) => typeof argument === "string" && argument.startsWith("--node-taints=")),
    "create must omit --node-taints when no operator-owned taints remain"
  );
});

test("private pool matcher rejects missing GKE-managed sandbox runtime label", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  assert.equal(evaluateLiveFoundation(inventory, live).ok, true);
  delete live.privatePool.config.labels[GKE_MANAGED_SANDBOX_RUNTIME_KEY];
  const evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(evaluated.ok, false);
  assert.ok(
    evaluated.checks.some((entry) => entry.id === "private-pool-present-exact" && !entry.ok)
  );
});

test("private pool matcher rejects missing resulting GKE-managed sandbox taint", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  assert.equal(evaluateLiveFoundation(inventory, live).ok, true);
  live.privatePool.config.taints = [];
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

test("vpc subnet route inventory accepts exact pre/post-prepare states and fails closed on drift", () => {
  const inventory = loadInventory();
  const reviewedRoutes = [inventory.cidrs.nodePrimary, ...inventory.cidrs.vpcSubnetDenies];
  const postPrepareRoutes = [...reviewedRoutes, inventory.cidrs.sandboxPodSecondary];
  const existingSecondariesOnly = Object.entries(inventory.network.existingSecondaryRanges).map(
    ([rangeName, ipCidrRange]) => ({ rangeName, ipCidrRange })
  );

  const preLive = baseLive(inventory);
  preLive.subnet.secondaryIpRanges = existingSecondariesOnly;
  preLive.vpcSubnetRoutes = [...reviewedRoutes];
  const preEvaluated = evaluatePreflight(inventory, preLive, "prepare");
  assert.ok(
    preEvaluated.checks.some((entry) => entry.id === "vpc-subnet-route-inventory" && entry.ok),
    "pre-prepare reviewed routes must pass"
  );

  const postLive = baseLive(inventory);
  postLive.vpcSubnetRoutes = [...postPrepareRoutes];
  const postEvaluated = evaluatePreflight(inventory, postLive, "apply-nat");
  assert.ok(
    postEvaluated.checks.some((entry) => entry.id === "vpc-subnet-route-inventory" && entry.ok),
    "post-prepare reviewed routes plus sandbox secondary route must pass"
  );
  assert.equal(
    postEvaluated.ok,
    true,
    postEvaluated.checks
      .filter((entry) => !entry.ok)
      .map((entry) => `${entry.id}: ${entry.detail}`)
      .join("; ")
  );
  assert.ok(
    postEvaluated.checks.some((entry) => entry.id === "prepare-phase-complete" && entry.ok),
    "apply-nat and later phases already require post-prepare exact state via prepare-phase-complete"
  );

  const extraLive = baseLive(inventory);
  extraLive.vpcSubnetRoutes = [...postPrepareRoutes, "10.200.0.0/20"];
  const extraEvaluated = evaluatePreflight(inventory, extraLive, "apply-nat");
  assert.ok(
    extraEvaluated.checks.some((entry) => entry.id === "vpc-subnet-route-inventory" && !entry.ok),
    "arbitrary extra routes must fail closed"
  );

  const routeWithoutSecondary = baseLive(inventory);
  routeWithoutSecondary.subnet.secondaryIpRanges = existingSecondariesOnly;
  routeWithoutSecondary.vpcSubnetRoutes = [...postPrepareRoutes];
  const routeWithoutSecondaryEvaluated = evaluatePreflight(
    inventory,
    routeWithoutSecondary,
    "prepare"
  );
  assert.ok(
    routeWithoutSecondaryEvaluated.checks.some(
      (entry) => entry.id === "vpc-subnet-route-inventory" && !entry.ok
    ),
    "sandbox route without exact named secondary must fail closed"
  );

  const secondaryWithoutRoute = baseLive(inventory);
  secondaryWithoutRoute.vpcSubnetRoutes = [...reviewedRoutes];
  const secondaryWithoutRouteEvaluated = evaluatePreflight(
    inventory,
    secondaryWithoutRoute,
    "apply-nat"
  );
  assert.ok(
    secondaryWithoutRouteEvaluated.checks.some(
      (entry) => entry.id === "vpc-subnet-route-inventory" && !entry.ok
    ),
    "exact named secondary without exact sandbox route must fail closed"
  );
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

test("networkPolicyConfig empty object and disabled:false mean addon enabled; disabled:true and absent fail closed", () => {
  assert.equal(
    isNetworkPolicyAddonEnabled({ addonsConfig: { networkPolicyConfig: {} } }),
    true,
    "gcloud omitted-default live shape {} must count as enabled"
  );
  assert.equal(
    isNetworkPolicyAddonEnabled({
      addonsConfig: { networkPolicyConfig: { disabled: false } }
    }),
    true
  );
  assert.equal(
    isNetworkPolicyAddonEnabled({
      addonsConfig: { networkPolicyConfig: { disabled: true } }
    }),
    false
  );
  assert.equal(isNetworkPolicyAddonEnabled({ addonsConfig: {} }), false);
  assert.equal(isNetworkPolicyAddonEnabled({}), false);
  assert.equal(isNetworkPolicyAddonEnabled(null), false);
  assert.equal(isNetworkPolicyAddonEnabled({ addonsConfig: { networkPolicyConfig: null } }), false);
});

test("post-Calico apply-sandbox-pool preflight requires NP, addon, and current Calico readiness", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.cluster.networkPolicy = { enabled: true, provider: "CALICO" };
  live.cluster.addonsConfig = { networkPolicyConfig: {} };

  const npCheck = (evaluated) =>
    evaluated.checks.find((entry) => entry.id === "network-policy-state-valid-for-phase");

  let evaluated = evaluatePreflight(inventory, live, "apply-sandbox-pool");
  assert.equal(evaluated.ok, true, npCheck(evaluated)?.detail);
  assert.equal(npCheck(evaluated)?.ok, true);
  assert.match(npCheck(evaluated)?.detail ?? "", /NP=true provider=CALICO addon=true/);

  assert.equal(
    evaluateCalicoReadiness(inventory, live).ok,
    true,
    "fixture readiness is green alongside NP+addon"
  );
  for (const phase of ["apply-sandbox-pool", "retire-public-pool", "verify"]) {
    assert.equal(
      evaluatePreflight(inventory, live, phase).ok,
      true,
      `${phase} must accept exact current Calico readiness`
    );
  }

  live.cluster.networkPolicy = { enabled: false, provider: "CALICO" };
  evaluated = evaluatePreflight(inventory, live, "apply-sandbox-pool");
  assert.equal(evaluated.ok, false);
  assert.equal(npCheck(evaluated)?.ok, false);
  assert.match(npCheck(evaluated)?.detail ?? "", /NP=false provider=CALICO addon=true/);

  live.cluster.networkPolicy = { enabled: true, provider: "CALICO" };
  live.cluster.addonsConfig = { networkPolicyConfig: { disabled: true } };
  evaluated = evaluatePreflight(inventory, live, "apply-sandbox-pool");
  assert.equal(evaluated.ok, false);
  assert.equal(npCheck(evaluated)?.ok, false);
  assert.match(npCheck(evaluated)?.detail ?? "", /NP=true provider=CALICO addon=false/);

  live.cluster.addonsConfig = {};
  evaluated = evaluatePreflight(inventory, live, "apply-sandbox-pool");
  assert.equal(evaluated.ok, false);
  assert.equal(npCheck(evaluated)?.ok, false);
  assert.match(npCheck(evaluated)?.detail ?? "", /NP=true provider=CALICO addon=false/);

  live.cluster.addonsConfig = { networkPolicyConfig: {} };
  evaluated = evaluatePreflight(inventory, live, "apply-sandbox-pool");
  assert.equal(evaluated.ok, true);
  const readinessBroken = structuredClone(live);
  readinessBroken.allNodes = [];
  readinessBroken.calicoDaemonSets = [];
  assert.equal(
    evaluateCalicoReadiness(inventory, readinessBroken).ok,
    false,
    "Calico daemon/node readiness stays an independent gate"
  );
  for (const phase of ["apply-sandbox-pool", "retire-public-pool", "verify"]) {
    assert.equal(
      evaluatePreflight(inventory, readinessBroken, phase).ok,
      false,
      `${phase} must fail closed when current Calico readiness is red`
    );
  }

  for (const phase of ["prepare", "apply-nat", "apply-firewall", "apply-calico"]) {
    assert.equal(
      evaluatePreflight(inventory, readinessBroken, phase).ok,
      true,
      `${phase} must remain runnable before current Calico readiness is established`
    );
  }

  const daemonNotCurrent = structuredClone(live);
  daemonNotCurrent.calicoDaemonSets[0].current = 0;
  assert.equal(
    evaluatePreflight(inventory, daemonNotCurrent, "apply-sandbox-pool").ok,
    false,
    "calico-node desired/current/ready must match exactly"
  );

  const nodeNotReady = structuredClone(live);
  nodeNotReady.allNodes[0].ready = false;
  assert.equal(
    evaluatePreflight(inventory, nodeNotReady, "apply-sandbox-pool").ok,
    false,
    "every current node must be Ready"
  );

  const nodeWithoutExactCalicoLabel = structuredClone(live);
  nodeWithoutExactCalicoLabel.allNodes[0].calicoReady = false;
  assert.equal(
    evaluatePreflight(inventory, nodeWithoutExactCalicoLabel, "apply-sandbox-pool").ok,
    false,
    "every current node must have projectcalico.org/ds-ready=true"
  );

  const wrongProvider = structuredClone(live);
  wrongProvider.cluster.networkPolicy.provider = "PROVIDER_UNSPECIFIED";
  assert.equal(
    evaluatePreflight(inventory, wrongProvider, "apply-sandbox-pool").ok,
    false,
    "post-Calico provider must remain exactly CALICO"
  );
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

test("exec-ksa-object-ready allows only inert controller bookkeeping annotations", () => {
  assert.deepEqual(
    [...EXEC_KSA_INERT_ANNOTATION_KEYS],
    ["argocd.argoproj.io/tracking-id", "kubectl.kubernetes.io/last-applied-configuration"]
  );
  assert.equal(execKsaAnnotationsAreIdentityLess(undefined), true);
  assert.equal(execKsaAnnotationsAreIdentityLess(null), true);
  assert.equal(execKsaAnnotationsAreIdentityLess({}), true);
  assert.equal(
    execKsaAnnotationsAreIdentityLess({
      "argocd.argoproj.io/tracking-id": "persai-dev:apps/ServiceAccount:persai-dev/sandbox-exec-sa",
      "kubectl.kubernetes.io/last-applied-configuration": "{}"
    }),
    true
  );
  assert.equal(
    execKsaAnnotationsAreIdentityLess({
      "iam.gke.io/gcp-service-account": "sandbox@example.iam.gserviceaccount.com"
    }),
    false
  );
  assert.equal(
    execKsaAnnotationsAreIdentityLess({
      "argocd.argoproj.io/tracking-id": "ok",
      "cloud.google.com/gke-workload-identity": "true"
    }),
    false
  );
  assert.equal(execKsaAnnotationsAreIdentityLess({ "example.com/arbitrary": "x" }), false);

  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.execPods = [];
  live.execServiceAccount = {
    metadata: {
      name: "sandbox-exec-sa",
      annotations: {
        "argocd.argoproj.io/tracking-id":
          "persai-dev:apps/ServiceAccount:persai-dev/sandbox-exec-sa",
        "kubectl.kubernetes.io/last-applied-configuration": "{}"
      }
    },
    automountServiceAccountToken: false
  };
  let evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(evaluated.checks.find((entry) => entry.id === "exec-ksa-object-ready").ok, true);
  // Zero real exec pods remain expected until controlled restricted probe apply.
  assert.equal(evaluated.checks.find((entry) => entry.id === "exec-ksa-live-wiring").ok, false);

  live.execServiceAccount.metadata.annotations = {
    "iam.gke.io/gcp-service-account": "evil@example.iam.gserviceaccount.com"
  };
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(evaluated.checks.find((entry) => entry.id === "exec-ksa-object-ready").ok, false);
});

test("NetworkPolicy structural verify treats omitted ingress as empty and rejects widened ingress", () => {
  assert.equal(networkPolicyIngressIsEmpty(undefined), true);
  assert.equal(networkPolicyIngressIsEmpty(null), true);
  assert.equal(networkPolicyIngressIsEmpty([]), true);
  assert.equal(networkPolicyIngressIsEmpty([{ from: [] }]), false);
  assert.equal(networkPolicyIngressIsEmpty({}), false);

  const inventory = loadInventory();
  const live = baseLive(inventory);
  live.execPods = [];

  // Live Kubernetes omits submitted ingress: [] — accept absent as empty deny-all.
  delete live.execNetworkPolicy.spec.ingress;
  delete live.natProbeNetworkPolicy.spec.ingress;
  let evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(
    evaluated.checks.find((entry) => entry.id === "exec-networkpolicy-structural").ok,
    true
  );
  assert.equal(
    evaluated.checks.find((entry) => entry.id === "nat-probe-networkpolicy-structural").ok,
    true
  );
  assert.equal(
    typeof evaluated.checks.find((entry) => entry.id === "exec-networkpolicy-structural").ok,
    "boolean"
  );

  // Explicit empty array still passes.
  live.execNetworkPolicy.spec.ingress = [];
  live.natProbeNetworkPolicy.spec.ingress = [];
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(
    evaluated.checks.find((entry) => entry.id === "exec-networkpolicy-structural").ok,
    true
  );
  assert.equal(
    evaluated.checks.find((entry) => entry.id === "nat-probe-networkpolicy-structural").ok,
    true
  );

  // Any non-empty ingress is a widen and fails closed.
  live.execNetworkPolicy.spec.ingress = [
    {
      from: [
        {
          podSelector: {
            matchLabels: { "app.kubernetes.io/component": "sandbox-exec" }
          }
        }
      ]
    }
  ];
  live.natProbeNetworkPolicy.spec.ingress = [{ from: [{ podSelector: {} }] }];
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.equal(
    evaluated.checks.find((entry) => entry.id === "exec-networkpolicy-structural").ok,
    false
  );
  assert.equal(
    evaluated.checks.find((entry) => entry.id === "nat-probe-networkpolicy-structural").ok,
    false
  );
});

test("exec-ksa-live-wiring excludes controlled probes and requires a real exec pod", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  const probeA = probeManifestToValidatorPod(buildRestrictedProbePodManifest(inventory));
  const probeB = probeManifestToValidatorPod(buildNatProbePodManifest(inventory));
  // Zero real + two controlled probes must fail.
  live.execPods = [probeA, probeB];
  let evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-live-wiring" && !entry.ok));
  assert.match(
    evaluated.checks.find((entry) => entry.id === "exec-ksa-live-wiring").detail,
    /controlled probe/
  );
  assert.equal(selectRealExecPodsForKsaWiring(live.execPods, live).length, 0);

  // One valid real + probes passes.
  const real = {
    name: "ses-real",
    phase: "Running",
    nodeName: "private-node",
    serviceAccountName: "sandbox-exec-sa",
    automountServiceAccountToken: false,
    runtimeClassName: "gvisor",
    labels: { "app.kubernetes.io/component": "sandbox-exec" },
    podIP: "10.109.0.99"
  };
  live.execPods = [probeA, probeB, real];
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-live-wiring" && entry.ok));
  assert.equal(selectRealExecPodsForKsaWiring(live.execPods, live).length, 1);

  // Wrong real (default SA) + probes fails.
  live.execPods = [
    probeA,
    probeB,
    {
      ...real,
      name: "ses-wrong",
      serviceAccountName: "default"
    }
  ];
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-live-wiring" && !entry.ok));

  // Wrong real (public node) + probes fails when private contour is known.
  live.execPods = [
    probeA,
    {
      ...real,
      name: "ses-public-node",
      nodeName: "public-node"
    }
  ];
  evaluated = evaluateLiveFoundation(inventory, live);
  assert.ok(evaluated.checks.some((entry) => entry.id === "exec-ksa-live-wiring" && !entry.ok));

  const reported = evaluated.checks.find((entry) => entry.id === "controlled-probe-pods-reported");
  assert.ok(reported?.ok);
  assert.match(reported.detail, /adr146-restricted-probe/);
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
  const okPod = probeManifestToValidatorPod(buildRestrictedProbePodManifest(inventory));
  assert.equal(validateRestrictedProbePod(okPod, live, inventory).ok, true);
  assert.equal(
    validateRestrictedProbePod({ ...okPod, runtimeClassName: "runc" }, live, inventory).ok,
    false
  );
  assert.equal(
    validateRestrictedProbePod({ ...okPod, serviceAccountName: "default" }, live, inventory).ok,
    false
  );
  const natPod = probeManifestToValidatorPod(buildNatProbePodManifest(inventory));
  assert.equal(validateNatProbePod(natPod, live, inventory).ok, true);
  const natWithProxy = structuredClone(natPod);
  natWithProxy.spec.containers[0].env = [{ name: "HTTPS_PROXY", value: "http://proxy:3128" }];
  natWithProxy.containers = natWithProxy.spec.containers;
  assert.equal(validateNatProbePod(natWithProxy, live, inventory).ok, false);
});

test("controlled probe validators reject each material hardening class", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  const good = probeManifestToValidatorPod(buildRestrictedProbePodManifest(inventory));
  assert.equal(validateRestrictedProbePod(good, live, inventory).ok, true);
  assert.equal(validateControlledProbeHardening(good).ok, true);
  assert.deepEqual(good.spec.containers[0].resources, {
    requests: { ...ADR146_PROBE_RESOURCES.requests },
    limits: { ...ADR146_PROBE_RESOURCES.limits }
  });
  assert.deepEqual(good.spec.containers[0].securityContext.capabilities, { drop: ["ALL"] });

  const missingLabel = structuredClone(good);
  delete missingLabel.labels[ADR146_CONTROLLED_PROBE_LABEL];
  delete missingLabel.metadata.labels[ADR146_CONTROLLED_PROBE_LABEL];
  assert.equal(validateRestrictedProbePod(missingLabel, live, inventory).ok, false);

  const badDeadline = structuredClone(good);
  badDeadline.spec.activeDeadlineSeconds = ADR146_PROBE_ACTIVE_DEADLINE_SECONDS + 1;
  badDeadline.activeDeadlineSeconds = ADR146_PROBE_ACTIVE_DEADLINE_SECONDS + 1;
  assert.equal(validateRestrictedProbePod(badDeadline, live, inventory).ok, false);

  const badCommand = structuredClone(good);
  badCommand.spec.containers[0].command = ["sleep", "infinity"];
  badCommand.containers = badCommand.spec.containers;
  assert.equal(validateRestrictedProbePod(badCommand, live, inventory).ok, false);

  const badPodSecurity = structuredClone(good);
  badPodSecurity.spec.securityContext.runAsNonRoot = false;
  assert.equal(validateRestrictedProbePod(badPodSecurity, live, inventory).ok, false);

  const badContainerSecurity = structuredClone(good);
  badContainerSecurity.spec.containers[0].securityContext.allowPrivilegeEscalation = true;
  badContainerSecurity.spec.containers[0].securityContext.readOnlyRootFilesystem = false;
  badContainerSecurity.containers = badContainerSecurity.spec.containers;
  assert.equal(validateRestrictedProbePod(badContainerSecurity, live, inventory).ok, false);

  const badResourcesMissing = structuredClone(good);
  delete badResourcesMissing.spec.containers[0].resources.limits;
  badResourcesMissing.containers = badResourcesMissing.spec.containers;
  assert.equal(validateRestrictedProbePod(badResourcesMissing, live, inventory).ok, false);

  const oversizedCpu = structuredClone(good);
  oversizedCpu.spec.containers[0].resources.limits.cpu = "2";
  oversizedCpu.containers = oversizedCpu.spec.containers;
  assert.equal(validateControlledProbeHardening(oversizedCpu).ok, false);

  const oversizedMemory = structuredClone(good);
  oversizedMemory.spec.containers[0].resources.requests.memory = "512Mi";
  oversizedMemory.containers = oversizedMemory.spec.containers;
  assert.equal(validateControlledProbeHardening(oversizedMemory).ok, false);

  const alteredUnits = structuredClone(good);
  alteredUnits.spec.containers[0].resources.requests.cpu = "0.05";
  alteredUnits.spec.containers[0].resources.limits.memory = "128M";
  alteredUnits.containers = alteredUnits.spec.containers;
  assert.equal(validateControlledProbeHardening(alteredUnits).ok, false);

  const missingRequestCpu = structuredClone(good);
  delete missingRequestCpu.spec.containers[0].resources.requests.cpu;
  missingRequestCpu.containers = missingRequestCpu.spec.containers;
  assert.equal(validateControlledProbeHardening(missingRequestCpu).ok, false);

  const capabilitiesAdd = structuredClone(good);
  capabilitiesAdd.spec.containers[0].securityContext.capabilities = {
    add: ["NET_ADMIN"],
    drop: ["ALL"]
  };
  capabilitiesAdd.containers = capabilitiesAdd.spec.containers;
  assert.equal(validateControlledProbeHardening(capabilitiesAdd).ok, false);

  const dropMismatch = structuredClone(good);
  dropMismatch.spec.containers[0].securityContext.capabilities = {
    drop: ["ALL", "NET_RAW"]
  };
  dropMismatch.containers = dropMismatch.spec.containers;
  assert.equal(validateControlledProbeHardening(dropMismatch).ok, false);

  const dropMissingAll = structuredClone(good);
  dropMissingAll.spec.containers[0].securityContext.capabilities = {
    drop: ["NET_RAW"]
  };
  dropMissingAll.containers = dropMissingAll.spec.containers;
  assert.equal(validateControlledProbeHardening(dropMissingAll).ok, false);

  const natGood = probeManifestToValidatorPod(buildNatProbePodManifest(inventory));
  assert.equal(validateNatProbePod(natGood, live, inventory).ok, true);
  const natMissingProbeLabel = structuredClone(natGood);
  delete natMissingProbeLabel.labels["sandbox.gke.io/adr146-nat-probe"];
  delete natMissingProbeLabel.metadata.labels["sandbox.gke.io/adr146-nat-probe"];
  assert.equal(validateNatProbePod(natMissingProbeLabel, live, inventory).ok, false);

  const natMissingControlled = structuredClone(natGood);
  delete natMissingControlled.labels[ADR146_CONTROLLED_PROBE_LABEL];
  delete natMissingControlled.metadata.labels[ADR146_CONTROLLED_PROBE_LABEL];
  assert.equal(validateNatProbePod(natMissingControlled, live, inventory).ok, false);
});

test("controlled probe cleanup plan is bounded to exact names/labels", () => {
  const pods = [
    {
      name: "ses-production",
      phase: "Running",
      labels: { "app.kubernetes.io/component": "sandbox-exec" }
    },
    {
      name: "adr146-restricted-probe",
      phase: "Running",
      labels: {
        "app.kubernetes.io/component": "sandbox-exec",
        [ADR146_CONTROLLED_PROBE_LABEL]: "true"
      }
    },
    {
      name: "adr146-nat-probe",
      phase: "Succeeded",
      labels: {
        "app.kubernetes.io/component": "sandbox-exec",
        [ADR146_CONTROLLED_PROBE_LABEL]: "true",
        "sandbox.gke.io/adr146-nat-probe": "true"
      }
    }
  ];
  const targets = listControlledProbeCleanupTargets(pods);
  assert.deepEqual(targets.map((pod) => pod.name).sort(), [
    "adr146-nat-probe",
    "adr146-restricted-probe"
  ]);
  assert.equal(isAdr146ControlledProbePod(pods[0]), false);
  assert.equal(isAdr146ControlledProbePod(pods[1]), true);
  const plan = buildControlledProbeCleanupPlan(pods);
  assert.deepEqual(plan.exactNames, [...ADR146_CONTROLLED_PROBE_POD_NAMES]);
  assert.equal(plan.labelSelector, `${ADR146_CONTROLLED_PROBE_LABEL}=true`);
  assert.equal(plan.targets.length, 2);
  assert.ok(plan.argvByName.every((argv) => argv.includes("--ignore-not-found=true")));
  assert.ok(!plan.labelDeleteArgv.join(" ").includes("app.kubernetes.io/component=sandbox-exec"));
  assert.ok(plan.labelDeleteArgv.includes(`${ADR146_CONTROLLED_PROBE_LABEL}=true`));
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

test("release gate is repository-enforced with honest human residuals", () => {
  const inventory = loadInventory();
  assert.equal(inventory.releaseGate.repositoryEnforced, true);
  assert.equal(inventory.releaseGate.mechanism, "dev-image-publish-split-pin");
  assert.equal(inventory.releaseGate.githubEnvironment, "persai-dev-adr146-foundation");
  assert.equal(inventory.releaseGate.deferredSlice, undefined);
  assert.ok(Array.isArray(inventory.releaseGate.residuals));
  assert.ok(inventory.releaseGate.residuals.length >= 2);
  assert.ok(
    inventory.releaseGate.residuals.some((entry) => /can_admins_bypass=true/i.test(entry)),
    "live Environment can_admins_bypass=true must remain an honest residual"
  );
  assert.ok(inventory.releaseGate.pushLastSequence?.length >= 6);
  assert.ok(
    inventory.releaseGate.failureRollback?.some((entry) => /Never disable Calico/i.test(entry))
  );
  const valuesDevText = readFileSync(path.join(repoRoot, "infra/helm/values-dev.yaml"), "utf8");
  assert.equal(runStaticDeployTruth(inventory, { valuesDevText }).ok, true);
});

test("plan/verify evidence binds clean commit SHA and committed inventory SHA-256", () => {
  const inventory = loadInventory();
  const inventoryRel = "infra/bootstrap/adr146-sandbox-egress-foundation.json";
  const inventoryBytes = readFileSync(path.join(repoRoot, inventoryRel));
  const inventorySha = createHash("sha256").update(inventoryBytes).digest("hex");
  const evidence = buildEvidenceBinding(path.join(repoRoot, inventoryRel), {
    repoRoot,
    execGit(args) {
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
      }
      if (args[0] === "show") return inventoryBytes;
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readFile() {
      return inventoryBytes;
    }
  });
  assert.equal(evidence.gitCommitSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(evidence.inventorySha256, inventorySha);
  assert.equal(evidence.inventoryPath, inventoryRel);
  const plan = renderPlanText(inventory, evidence);
  assert.match(plan, new RegExp(`evidence.gitCommitSha=${evidence.gitCommitSha}`));
  assert.match(plan, new RegExp(`evidence.inventorySha256=${evidence.inventorySha256}`));
  assert.doesNotMatch(plan, /password|token|secret|private[_-]?key/i);
  assert.doesNotMatch(plan, /UNAVAILABLE/);
});

test("evidence binding fails closed on dirty tracked files", () => {
  assert.throws(
    () =>
      buildEvidenceBinding(undefined, {
        execGit(args) {
          if (args[0] === "status")
            return " M infra/bootstrap/adr146-sandbox-egress-foundation.json\n";
          throw new Error("unexpected");
        }
      }),
    /dirty git working tree/
  );
});

test("evidence binding fails closed on dirty untracked files", () => {
  assert.throws(
    () =>
      buildEvidenceBinding(undefined, {
        execGit(args) {
          if (args[0] === "status") return "?? infra/bootstrap/scratch-probe.yaml\n";
          throw new Error("unexpected");
        }
      }),
    /dirty git working tree/
  );
});

test("evidence binding fails closed when git is unavailable", () => {
  assert.throws(
    () =>
      buildEvidenceBinding(undefined, {
        execGit() {
          throw new Error("git missing");
        }
      }),
    /git status unavailable/
  );
});

test("evidence binding fails closed on disk-vs-commit inventory mismatch", () => {
  const inventoryRel = "infra/bootstrap/adr146-sandbox-egress-foundation.json";
  const committed = Buffer.from('{"committed":true}\n');
  const disk = Buffer.from('{"disk":true}\n');
  assert.throws(
    () =>
      buildEvidenceBinding(path.join(repoRoot, inventoryRel), {
        repoRoot,
        execGit(args) {
          if (args[0] === "status") return "";
          if (args[0] === "rev-parse") return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n";
          if (args[0] === "show") return committed;
          throw new Error(`unexpected git ${args.join(" ")}`);
        },
        readFile() {
          return disk;
        }
      }),
    /does not match committed blob/
  );
});

test("generated restricted and NAT probe manifests satisfy live validators", () => {
  const inventory = loadInventory();
  const live = {
    privatePoolNodes: [{ name: "private-node", ready: true, externalIp: "" }]
  };
  const restrictedManifest = buildRestrictedProbePodManifest(inventory);
  const natManifest = buildNatProbePodManifest(inventory);
  assert.equal(
    validateRestrictedProbePod(probeManifestToValidatorPod(restrictedManifest), live, inventory).ok,
    true
  );
  assert.equal(
    validateNatProbePod(probeManifestToValidatorPod(natManifest), live, inventory).ok,
    true
  );
  const natWithProxy = structuredClone(natManifest);
  natWithProxy.spec.containers[0].env = [{ name: "HTTPS_PROXY", value: "http://proxy:3128" }];
  assert.equal(
    validateNatProbePod(probeManifestToValidatorPod(natWithProxy), live, inventory).ok,
    false
  );
  const yaml = `${renderProbeManifestYaml(restrictedManifest)}\n${renderProbeManifestYaml(natManifest)}`;
  assert.match(yaml, /serviceAccountName: sandbox-exec-sa/);
  assert.match(yaml, /runtimeClassName: gvisor/);
  assert.match(yaml, /automountServiceAccountToken: false/);
  assert.match(yaml, /sandbox\.gke\.io\/adr146-nat-probe: "true"/);
  assert.match(yaml, /sandbox\.gke\.io\/adr146-controlled-probe: "true"/);
  assert.match(yaml, /workload: "sandbox"/);
  assert.match(yaml, /activeDeadlineSeconds: 600/);
  assert.match(yaml, /command: \["sleep","600"\]/);
  assert.doesNotMatch(yaml, /sleep", "3600"|sleep","3600"/);
  assert.match(yaml, /runAsNonRoot: true/);
  assert.match(yaml, /readOnlyRootFilesystem: true/);
  assert.match(yaml, /allowPrivilegeEscalation: false/);
  assert.match(yaml, /drop: \["ALL"\]/);
  assert.match(yaml, /seccompProfile:\n\s+type: RuntimeDefault/);
  assert.match(yaml, /cpu: "50m"/);
  assert.match(yaml, /memory: "64Mi"/);
  assert.doesNotMatch(yaml, /HTTP_PROXY|HTTPS_PROXY|password:|secret:/i);
  assert.equal(restrictedManifest.spec.securityContext.runAsNonRoot, true);
  assert.equal(
    restrictedManifest.spec.containers[0].securityContext.allowPrivilegeEscalation,
    false
  );
  assert.equal(
    restrictedManifest.metadata.labels["sandbox.gke.io/adr146-controlled-probe"],
    "true"
  );
});

test("controlled probe gVisor toleration uses canonical Equal and rejects apiserver-rejected casings", () => {
  const inventory = loadInventory();
  const live = {
    privatePoolNodes: [{ name: "private-node", ready: true, externalIp: "" }]
  };
  const expected = inventory.cidrs.restrictedProbe.requiredGvisorToleration;
  assert.deepEqual(validateRequiredGvisorTolerationShape(expected), []);
  assert.equal(expected.operator, KUBERNETES_TOLERATION_OPERATOR_EQUAL);
  assert.equal(expected.key, GKE_MANAGED_SANDBOX_RUNTIME_KEY);
  assert.equal(expected.value, GKE_SANDBOX_TYPE_GVISOR);
  assert.equal(expected.effect, "NoSchedule");

  const restrictedManifest = buildRestrictedProbePodManifest(inventory);
  const natManifest = buildNatProbePodManifest(inventory);
  const exactShape = {
    key: GKE_MANAGED_SANDBOX_RUNTIME_KEY,
    operator: KUBERNETES_TOLERATION_OPERATOR_EQUAL,
    value: GKE_SANDBOX_TYPE_GVISOR,
    effect: "NoSchedule"
  };
  assert.deepEqual(restrictedManifest.spec.tolerations, [exactShape]);
  assert.deepEqual(natManifest.spec.tolerations, [exactShape]);
  assert.deepEqual(restrictedManifest.spec.tolerations[0], expected);
  assert.deepEqual(natManifest.spec.tolerations[0], expected);

  const yaml = `${renderProbeManifestYaml(restrictedManifest)}\n${renderProbeManifestYaml(natManifest)}`;
  assert.match(yaml, /operator: Equal/);
  assert.doesNotMatch(yaml, /operator: equal\b/);
  assert.doesNotMatch(yaml, /operator: EQUAL\b/);
  assert.match(yaml, /key: sandbox\.gke\.io\/runtime/);
  assert.match(yaml, /value: "gvisor"/);
  assert.match(yaml, /effect: NoSchedule/);

  const good = probeManifestToValidatorPod(restrictedManifest);
  assert.equal(validateControlledProbeGvisorToleration(good, inventory).ok, true);
  assert.equal(validateRestrictedProbePod(good, live, inventory).ok, true);

  // Reproduce live apiserver rejection: Unsupported value: "equal"
  // (supported values: "Equal", "Exists") — validators must fail closed the same way.
  for (const badOperator of KUBERNETES_REJECTED_TOLERATION_OPERATOR_CASINGS) {
    const badInventory = structuredClone(inventory);
    badInventory.cidrs.restrictedProbe.requiredGvisorToleration.operator = badOperator;
    assert.ok(
      validateRequiredGvisorTolerationShape(
        badInventory.cidrs.restrictedProbe.requiredGvisorToleration
      ).some((error) => error.includes(`exactly "${KUBERNETES_TOLERATION_OPERATOR_EQUAL}"`)),
      `inventory must reject operator=${badOperator}`
    );
    assert.ok(
      validateInventory(badInventory).some((error) =>
        error.includes(`exactly "${KUBERNETES_TOLERATION_OPERATOR_EQUAL}"`)
      ),
      `validateInventory must reject operator=${badOperator}`
    );

    const badPod = structuredClone(good);
    badPod.spec.tolerations[0].operator = badOperator;
    badPod.tolerations = badPod.spec.tolerations;
    const gate = validateControlledProbeGvisorToleration(badPod, inventory);
    assert.equal(gate.ok, false, `live probe must reject operator=${badOperator}`);
    assert.ok(
      gate.errors.some((error) => error.includes("rejects lowercase") || error.includes("casings")),
      gate.errors.join("; ")
    );
    assert.equal(validateRestrictedProbePod(badPod, live, inventory).ok, false);
    const badNat = probeManifestToValidatorPod(natManifest);
    badNat.spec.tolerations[0].operator = badOperator;
    assert.equal(validateNatProbePod(badNat, live, inventory).ok, false);
  }

  const missingToleration = structuredClone(good);
  delete missingToleration.spec.tolerations;
  delete missingToleration.tolerations;
  assert.equal(validateControlledProbeGvisorToleration(missingToleration, inventory).ok, false);
  assert.equal(validateRestrictedProbePod(missingToleration, live, inventory).ok, false);

  const wrongKey = structuredClone(good);
  wrongKey.spec.tolerations[0].key = "dedicated";
  assert.equal(validateControlledProbeGvisorToleration(wrongKey, inventory).ok, false);
});

test("probe manifest renderer fails closed on invalid gVisor tolerations", () => {
  const inventory = loadInventory();
  const manifest = buildRestrictedProbePodManifest(inventory);
  const yaml = renderProbeManifestYaml(manifest);
  assert.match(
    yaml,
    /tolerations:\n\s+- key: sandbox\.gke\.io\/runtime\n\s+operator: Equal\n\s+value: "gvisor"\n\s+effect: NoSchedule/
  );

  const missing = structuredClone(manifest);
  delete missing.spec.tolerations;
  assert.throws(
    () => renderProbeManifestYaml(missing),
    /expected exactly one gVisor runtime toleration, got missing/
  );

  const empty = structuredClone(manifest);
  empty.spec.tolerations = [];
  assert.throws(
    () => renderProbeManifestYaml(empty),
    /expected exactly one gVisor runtime toleration, got 0/
  );

  const nullEntry = structuredClone(manifest);
  nullEntry.spec.tolerations = [null];
  assert.throws(
    () => renderProbeManifestYaml(nullEntry),
    /invalid canonical gVisor toleration.*requiredGvisorToleration must be an object/s
  );

  for (const badOperator of KUBERNETES_REJECTED_TOLERATION_OPERATOR_CASINGS) {
    const wrongCasing = structuredClone(manifest);
    wrongCasing.spec.tolerations[0].operator = badOperator;
    assert.throws(
      () => renderProbeManifestYaml(wrongCasing),
      new RegExp(
        `invalid canonical gVisor toleration.*operator must be exactly "${KUBERNETES_TOLERATION_OPERATOR_EQUAL}"`,
        "s"
      )
    );
  }

  const extra = structuredClone(manifest);
  extra.spec.tolerations.push({
    key: "dedicated",
    operator: "Exists",
    effect: "NoSchedule"
  });
  assert.throws(
    () => renderProbeManifestYaml(extra),
    /expected exactly one gVisor runtime toleration, got 2/
  );

  const extraField = structuredClone(manifest);
  extraField.spec.tolerations[0].tolerationSeconds = 30;
  assert.throws(
    () => renderProbeManifestYaml(extraField),
    /invalid canonical gVisor toleration.*unexpected fields: tolerationSeconds/s
  );
});

function probeManifestToKubectlItem(manifest, { nodeName = "private-node", phase = "Running" } = {}) {
  return {
    metadata: {
      name: manifest.metadata.name,
      labels: manifest.metadata.labels
    },
    spec: {
      ...manifest.spec,
      nodeName
    },
    status: {
      phase,
      podIP: "10.0.0.1"
    }
  };
}

test("collectLive exec pod mapper preserves admitted tolerations for probe contour validation", () => {
  const inventory = loadInventory();
  const live = baseLive(inventory);
  const manifest = buildRestrictedProbePodManifest(inventory);
  const kubectlItem = probeManifestToKubectlItem(manifest);
  const mapped = mapExecPodFromKubectlItem(kubectlItem);

  assert.deepEqual(mapped.spec.tolerations, manifest.spec.tolerations);
  assert.deepEqual(mapped.tolerations, manifest.spec.tolerations);
  assert.equal(validateRestrictedProbePod(mapped, live, inventory).ok, true);

  const withoutTolerations = structuredClone(kubectlItem);
  delete withoutTolerations.spec.tolerations;
  const mappedMissing = mapExecPodFromKubectlItem(withoutTolerations);
  assert.equal(mappedMissing.spec.tolerations, undefined);
  const missingGate = validateRestrictedProbePod(mappedMissing, live, inventory);
  assert.equal(missingGate.ok, false);
  assert.ok(
    missingGate.errors.some((error) => error.includes("expected exactly one gVisor runtime toleration"))
  );

  for (const badOperator of KUBERNETES_REJECTED_TOLERATION_OPERATOR_CASINGS) {
    const badItem = structuredClone(kubectlItem);
    badItem.spec.tolerations[0].operator = badOperator;
    const mappedBad = mapExecPodFromKubectlItem(badItem);
    assert.equal(mappedBad.spec.tolerations[0].operator, badOperator);
    const badGate = validateRestrictedProbePod(mappedBad, live, inventory);
    assert.equal(badGate.ok, false, `must reject operator=${badOperator} after collector mapping`);
    assert.ok(
      badGate.errors.some((error) => error.includes("operator must be exactly")),
      badGate.errors.join("; ")
    );
  }

  const extraItem = structuredClone(kubectlItem);
  extraItem.spec.tolerations.push({
    key: "dedicated",
    operator: "Exists",
    effect: "NoSchedule"
  });
  const mappedExtra = mapExecPodFromKubectlItem(extraItem);
  assert.equal(mappedExtra.spec.tolerations.length, 2);
  const extraGate = validateRestrictedProbePod(mappedExtra, live, inventory);
  assert.equal(extraGate.ok, false);
  assert.ok(
    extraGate.errors.some((error) => error.includes("expected exactly one gVisor runtime toleration, got 2"))
  );

  const wrongKeyItem = structuredClone(kubectlItem);
  wrongKeyItem.spec.tolerations[0].key = "dedicated";
  const mappedWrongKey = mapExecPodFromKubectlItem(wrongKeyItem);
  const wrongKeyGate = validateRestrictedProbePod(mappedWrongKey, live, inventory);
  assert.equal(wrongKeyGate.ok, false);
  assert.ok(
    wrongKeyGate.errors.some((error) => error.includes("tolerations[0].key must be"))
  );
});
