import type { RuntimeContextHydrationConfig, RuntimeSandboxPolicy } from "@persai/runtime-contract";

export type AdminPlanStatus = "active" | "inactive";
export type AdminPlanRuntimeTier =
  | "free_shared_restricted"
  | "paid_shared_restricted"
  | "paid_isolated";

export type AdminPlanEntitlementControls = {
  toolClasses: {
    costDrivingTools: boolean;
    utilityTools: boolean;
    costDrivingQuotaGoverned: boolean;
    utilityQuotaGoverned: boolean;
  };
  channelsAndSurfaces: {
    webChat: boolean;
    telegram: boolean;
    whatsapp: boolean;
    max: boolean;
  };
  mediaClasses: {
    image: boolean;
    audio: boolean;
    video: boolean;
    file: boolean;
  };
};

export type AdminPlanToolActivation = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  active: boolean;
  dailyCallLimit: number | null;
  /**
   * ADR-074 Slice L1 — per-plan override of the per-turn hard cap on this
   * tool's executions inside a single runtime turn. NULL means "use the
   * runtime code default" (TOOL_HARD_CAP_PER_TURN).
   */
  perTurnCap: number | null;
  visibleInPlanEditor: boolean;
};

export type AdminPlanToolActivationInput = {
  toolCode: string;
  active: boolean;
  dailyCallLimit: number | null;
  /** ADR-074 Slice L1 — see `AdminPlanToolActivation.perTurnCap`. */
  perTurnCap: number | null;
};

/**
 * ADR-074 Slice L1 — per-plan override of the tool-loop iteration limit per
 * execution mode. NULL on a leaf means "use the runtime code default for
 * that mode" (TOOL_LOOP_LIMIT_BY_MODE in
 * apps/runtime/src/modules/turns/tool-budget-policy.ts).
 */
export type AdminPlanToolBudgets = {
  loopLimitByMode: {
    normal: number | null;
    premium: number | null;
    reasoning: number | null;
  };
};

export type AdminPlanContextPolicy = RuntimeContextHydrationConfig;

export type AdminPlanRetrievalPolicy = {
  defaultMaxResults: number;
  maxMaxResults: number;
  lexicalCandidateLimit: number;
  vectorCandidateLimit: number;
  knowledgeFetchWindowRadius: number;
  chatFetchWindowRadius: number;
  fetchMaxChars: number;
  helperEnabled: boolean;
  helperCandidateLimit: number;
  helperMaxOutputTokens: number;
  embeddingSearchEnabled: boolean;
};

export type AdminPlanSandboxPolicy = RuntimeSandboxPolicy;

export type AdminPlanInput = {
  displayName: string;
  description: string | null;
  status: AdminPlanStatus;
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadata: {
    commercialTag: string | null;
    notes: string | null;
  };
  entitlements: AdminPlanEntitlementControls;
  quotaLimits: {
    tokenBudgetLimit: number | null;
    mediaStorageBytesLimit: number | null;
    knowledgeStorageBytesLimit: number | null;
    workspaceStorageBytesLimit: number | null;
  };
  contextPolicy: AdminPlanContextPolicy;
  retrievalPolicy: AdminPlanRetrievalPolicy;
  sandboxPolicy: AdminPlanSandboxPolicy;
  primaryModelKey: string | null;
  premiumModelKey: string | null;
  reasoningModelKey: string | null;
  retrievalModelKey: string | null;
  embeddingModelKey: string | null;
  imageGenerateModelKey: string | null;
  imageEditModelKey: string | null;
  videoGenerateModelKey: string | null;
  runtimeTierDefault: AdminPlanRuntimeTier | null;
  toolActivations?: AdminPlanToolActivationInput[];
  /**
   * ADR-074 Slice L1 — per-plan tool-loop iteration limits per execution
   * mode. Optional on input; resolveStoredPlanToolBudgets fills in defaults
   * (NULL leaves) so the plan stays editable from the admin UI.
   */
  toolBudgets: AdminPlanToolBudgets;
};

export type AdminCreatePlanInput = AdminPlanInput & {
  code: string;
};

export type AdminPlanState = {
  code: string;
  displayName: string;
  description: string | null;
  status: AdminPlanStatus;
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadata: {
    commercialTag: string | null;
    notes: string | null;
  };
  entitlements: AdminPlanEntitlementControls;
  quotaLimits: {
    tokenBudgetLimit: number | null;
    mediaStorageBytesLimit: number | null;
    knowledgeStorageBytesLimit: number | null;
    workspaceStorageBytesLimit: number | null;
  };
  contextPolicy: AdminPlanContextPolicy;
  retrievalPolicy: AdminPlanRetrievalPolicy;
  sandboxPolicy: AdminPlanSandboxPolicy;
  primaryModelKey: string | null;
  premiumModelKey: string | null;
  reasoningModelKey: string | null;
  retrievalModelKey: string | null;
  embeddingModelKey: string | null;
  imageGenerateModelKey: string | null;
  imageEditModelKey: string | null;
  videoGenerateModelKey: string | null;
  runtimeTierDefault: AdminPlanRuntimeTier | null;
  toolActivations: AdminPlanToolActivation[];
  /** ADR-074 Slice L1 — see `AdminPlanInput.toolBudgets`. */
  toolBudgets: AdminPlanToolBudgets;
  createdAt: string;
  updatedAt: string;
};
