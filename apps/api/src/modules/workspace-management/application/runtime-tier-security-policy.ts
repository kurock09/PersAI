import type { RuntimeTier } from "./runtime-assignment";

export const RUNTIME_TIER_SECURITY_POLICY_SCHEMA = "persai.runtimeTierSecurityPolicy.v2";

export type SandboxResourceLimits = {
  pidsLimit: number;
  memoryMb: number;
  cpus: number;
};

export type RuntimeTierSecurityPolicyState = {
  schema: typeof RUNTIME_TIER_SECURITY_POLICY_SCHEMA;
  tier: RuntimeTier;
  poolClass: "shared_restricted" | "isolated";
  sandbox: {
    required: true;
    mode: "all";
    backend: "docker";
    scope: "session";
    workspaceAccess: "rw";
    network: "none";
    readOnlyRoot: true;
    sessionToolsVisibility: "spawned";
  };
  sandboxLimits: SandboxResourceLimits;
  execPolicy: "sandbox_only";
  writePolicy: "sandbox_workspace_only";
  userPlanTools: "plan_managed_only";
  platformManagedTools: string[];
  planManagedServiceTools: string[];
  hiddenInternalTools: string[];
  alwaysDeniedBuiltIns: string[];
  notes: string[];
};

const ALWAYS_DENIED_BUILT_INS = [
  "gateway",
  "nodes",
  "canvas",
  "agents_list",
  "session_status",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "sessions_yield",
  "subagents"
] as const;

const PLATFORM_MANAGED_TOOLS = ["persai_workspace_attach", "persai_tool_quota_status"] as const;
const PLAN_MANAGED_SERVICE_TOOLS = ["reminder_task"] as const;
const HIDDEN_INTERNAL_TOOLS = ["cron"] as const;

const TIER_SANDBOX_LIMITS: Record<RuntimeTier, SandboxResourceLimits> = {
  free_shared_restricted: { pidsLimit: 64, memoryMb: 512, cpus: 0.5 },
  paid_shared_restricted: { pidsLimit: 128, memoryMb: 1024, cpus: 1 },
  paid_isolated: { pidsLimit: 256, memoryMb: 2048, cpus: 2 }
};

function buildRuntimeTierSecurityPolicy(params: {
  tier: RuntimeTier;
  poolClass: "shared_restricted" | "isolated";
  notes: string[];
}): RuntimeTierSecurityPolicyState {
  return {
    schema: RUNTIME_TIER_SECURITY_POLICY_SCHEMA,
    tier: params.tier,
    poolClass: params.poolClass,
    sandbox: {
      required: true,
      mode: "all",
      backend: "docker",
      scope: "session",
      workspaceAccess: "rw",
      network: "none",
      readOnlyRoot: true,
      sessionToolsVisibility: "spawned"
    },
    sandboxLimits: TIER_SANDBOX_LIMITS[params.tier],
    execPolicy: "sandbox_only",
    writePolicy: "sandbox_workspace_only",
    userPlanTools: "plan_managed_only",
    platformManagedTools: [...PLATFORM_MANAGED_TOOLS],
    planManagedServiceTools: [...PLAN_MANAGED_SERVICE_TOOLS],
    hiddenInternalTools: [...HIDDEN_INTERNAL_TOOLS],
    alwaysDeniedBuiltIns: [...ALWAYS_DENIED_BUILT_INS],
    notes: params.notes
  };
}

export function listRuntimeTierSecurityPolicies(): RuntimeTierSecurityPolicyState[] {
  return [
    buildRuntimeTierSecurityPolicy({
      tier: "free_shared_restricted",
      poolClass: "shared_restricted",
      notes: [
        "Free traffic stays on the restricted shared lane and follows the same deny baseline as other shared tiers.",
        "Telegram/webhook ingress follows the active free shared physical pool during cutover."
      ]
    }),
    buildRuntimeTierSecurityPolicy({
      tier: "paid_shared_restricted",
      poolClass: "shared_restricted",
      notes: [
        "Paid shared traffic uses a restricted shared lane instead of inheriting a more permissive runtime profile.",
        "Sandbox-capable shared pools are separate physical deployments behind the same product tier contract."
      ]
    }),
    buildRuntimeTierSecurityPolicy({
      tier: "paid_isolated",
      poolClass: "isolated",
      notes: [
        "Paid isolated keeps a direct isolated tier identity instead of collapsing back into shared routing.",
        "Isolation does not remove the restricted built-in deny baseline; it changes pool topology and blast radius."
      ]
    })
  ];
}
