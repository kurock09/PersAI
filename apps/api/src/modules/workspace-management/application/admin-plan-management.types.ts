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
  /** ADR-116 — `files` tool only; NULL on other tools in API responses. */
  maxFilePreviewBytes: number | null;
  /** ADR-116 — `files` tool only; NULL on other tools in API responses. */
  maxFilePreviewEdgePx: number | null;
};

export type AdminPlanToolActivationInput = {
  toolCode: string;
  active: boolean;
  dailyCallLimit: number | null;
  /** ADR-074 Slice L1 — see `AdminPlanToolActivation.perTurnCap`. */
  perTurnCap: number | null;
  /** ADR-116 — `files` tool only. */
  maxFilePreviewBytes?: number | null;
  /** ADR-116 — `files` tool only. */
  maxFilePreviewEdgePx?: number | null;
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

/**
 * ADR-121 Slice 4 — per-plan override of the thinking-token budget per
 * routing level. NULL on a leaf means "use the resolver built-in default
 * for that level" (DEFAULT_THINKING_BUDGET_BY_LEVEL). 0 = thinking off.
 */
export type AdminPlanThinkingBudgetByLevel = {
  light: number | null;
  medium: number | null;
  heavy: number | null;
  deep: number | null;
};

export type AdminPlanContextPolicy = RuntimeContextHydrationConfig;

/**
 * ADR-094 — admin-editable per-plan retrieval policy. Mirrors the runtime
 * `KnowledgeRetrievalPolicy` shape; the five `smart…` / `chatSection…` /
 * `fetchFullMode…` fields are additive against the pre-ADR-094 contract.
 */
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
  smartSearchShortDocChars: number;
  smartSearchMediumDocChars: number;
  chatSectionDefaultRadius: number;
  fetchFullModeMaxChars: number;
  fetchFullModeMaxChatMessages: number;
};

export type AdminPlanSandboxPolicy = RuntimeSandboxPolicy;

export type AdminPlanAssistantPolicy = {
  maxAssistants: number;
};

export type AdminPlanLocalizedText = {
  ru: string | null;
  en: string | null;
};

export type AdminPlanLocalizedTextList = {
  ru: string[];
  en: string[];
};

export type AdminPlanPresentationPrice = {
  amount: number | null;
  currency: string | null;
  billingPeriod: "month" | "year" | null;
};

export type AdminPlanPresentation = {
  showOnPricingPage: boolean;
  displayOrder: number;
  highlighted: boolean;
  title: AdminPlanLocalizedText;
  subtitle: AdminPlanLocalizedText;
  notes: AdminPlanLocalizedText;
  badge: AdminPlanLocalizedText;
  ctaLabel: AdminPlanLocalizedText;
  price: AdminPlanPresentationPrice;
  highlightItems: AdminPlanLocalizedTextList;
};

export type AdminPlanTextModelProviderSelection = {
  providerKey: string | null;
  modelKey: string | null;
};

export type AdminPlanInput = {
  displayName: string;
  description: string | null;
  status: AdminPlanStatus;
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  lifecyclePolicy: {
    trialFallbackPlanCode: string | null;
    paidFallbackPlanCode: string | null;
  };
  metadata: {
    commercialTag: string | null;
    notes: string | null;
  };
  presentation: AdminPlanPresentation;
  entitlements: AdminPlanEntitlementControls;
  quotaLimits: {
    tokenBudgetLimit: number | null;
    activeWebChatsLimit: number | null;
    messagesPerChat: number | null;
    imageGenerateMonthlyUnitsLimit: number | null;
    imageEditMonthlyUnitsLimit: number | null;
    documentMonthlyUnitsLimit: number | null;
    mediaStorageBytesLimit: number | null;
    knowledgeStorageBytesLimit: number | null;
    workspaceStorageBytesLimit: number | null;
  };
  skillPolicy: {
    maxEnabledSkills: number | null;
  };
  assistantPolicy: AdminPlanAssistantPolicy;
  contextPolicy: AdminPlanContextPolicy;
  retrievalPolicy: AdminPlanRetrievalPolicy;
  sandboxPolicy: AdminPlanSandboxPolicy;
  primaryModelKey: string | null;
  primaryModelProviderKey: string | null;
  premiumModelKey: string | null;
  premiumModelProviderKey: string | null;
  reasoningModelKey: string | null;
  reasoningModelProviderKey: string | null;
  systemToolModelKey: string | null;
  systemToolModelProviderKey: string | null;
  retrievalModelKey: string | null;
  retrievalModelProviderKey: string | null;
  imageGenerateModelKey: string | null;
  imageGenerateFallbackModelKey: string | null;
  imageEditModelKey: string | null;
  imageEditFallbackModelKey: string | null;
  videoGenerateModelKey: string | null;
  videoGenerateFallbackModelKey: string | null;
  /**
   * ADR-109 Slice 10c — HeyGen talking-avatar model key for this plan.
   * Only HeyGen rows with kind='talking_avatar' are valid here.
   * When null, materialization falls back to the first active HeyGen row.
   */
  talkingAvatarModelKey: string | null;
  /**
   * ADR-109 Slice 10c — Optional fallback HeyGen talking-avatar model key.
   * Only HeyGen rows with kind='talking_avatar' are valid here.
   */
  talkingAvatarFallbackModelKey: string | null;
  /**
   * ADR-109 Slice 8 — plan-level toggle that enables the talking-avatar
   * execution path for `video_generate`. When `false` (default), assistants
   * on this plan use the cinematic-only schema and the runtime blocks any
   * `mode: "talking_avatar"` request with `talking_avatar_plan_disabled`.
   * Stored in `billingProviderHints`; materialized onto the bundle's
   * `video_generate` tool policy so the runtime gate fires correctly.
   */
  talkingVideoEnabled: boolean;
  /**
   * When `true`, async image job completion framing may attach produced (and
   * for edit, source) image bytes for one multimodal review turn before delivery.
   */
  mediaCompletionVisionEnabled: boolean;
  /**
   * ADR-108 Slice 1 — monthly Vcoin grant credited into
   * `WorkspaceVcoinBalance` on subscription period boundary for plans whose
   * users get a recurring `video_generate` Vcoin budget. Stored inside the
   * plan's `billingProviderHints` JSON column. Slice 8 retired the legacy
   * per-unit `videoGenerateMonthlyUnitsLimit` so this is now the SOLE
   * `video_generate` quota knob. Image / TTS / STT / document quotas
   * remain per-unit and are unaffected.
   */
  videoVcoinMonthlyGrant: number;
  runtimeTierDefault: AdminPlanRuntimeTier | null;
  toolActivations?: AdminPlanToolActivationInput[];
  /**
   * ADR-074 Slice L1 — per-plan tool-loop iteration limits per execution
   * mode. Optional on input; resolveStoredPlanToolBudgets fills in defaults
   * (NULL leaves) so the plan stays editable from the admin UI.
   */
  toolBudgets: AdminPlanToolBudgets;
  /**
   * ADR-121 Slice 4 — per-plan thinking-token budget per routing level.
   * Optional on input; createDefaultPlanThinkingBudgetByLevel fills in
   * defaults (NULL leaves) so the plan stays editable from the admin UI.
   */
  thinkingBudgetByLevel: AdminPlanThinkingBudgetByLevel;
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
  lifecyclePolicy: {
    trialFallbackPlanCode: string | null;
    paidFallbackPlanCode: string | null;
  };
  metadata: {
    commercialTag: string | null;
    notes: string | null;
  };
  presentation: AdminPlanPresentation;
  entitlements: AdminPlanEntitlementControls;
  quotaLimits: {
    tokenBudgetLimit: number | null;
    activeWebChatsLimit: number | null;
    messagesPerChat: number | null;
    imageGenerateMonthlyUnitsLimit: number | null;
    imageEditMonthlyUnitsLimit: number | null;
    documentMonthlyUnitsLimit: number | null;
    mediaStorageBytesLimit: number | null;
    knowledgeStorageBytesLimit: number | null;
    workspaceStorageBytesLimit: number | null;
  };
  skillPolicy: {
    maxEnabledSkills: number | null;
  };
  assistantPolicy: AdminPlanAssistantPolicy;
  contextPolicy: AdminPlanContextPolicy;
  retrievalPolicy: AdminPlanRetrievalPolicy;
  sandboxPolicy: AdminPlanSandboxPolicy;
  primaryModelKey: string | null;
  primaryModelProviderKey: string | null;
  premiumModelKey: string | null;
  premiumModelProviderKey: string | null;
  reasoningModelKey: string | null;
  reasoningModelProviderKey: string | null;
  systemToolModelKey: string | null;
  systemToolModelProviderKey: string | null;
  retrievalModelKey: string | null;
  retrievalModelProviderKey: string | null;
  imageGenerateModelKey: string | null;
  imageGenerateFallbackModelKey: string | null;
  imageEditModelKey: string | null;
  imageEditFallbackModelKey: string | null;
  videoGenerateModelKey: string | null;
  videoGenerateFallbackModelKey: string | null;
  /** ADR-109 Slice 10c — see `AdminPlanInput.talkingAvatarModelKey`. */
  talkingAvatarModelKey: string | null;
  /** ADR-109 Slice 10c — see `AdminPlanInput.talkingAvatarFallbackModelKey`. */
  talkingAvatarFallbackModelKey: string | null;
  /** ADR-109 Slice 8 — see `AdminPlanInput.talkingVideoEnabled`. */
  talkingVideoEnabled: boolean;
  /** Plan-level toggle for multimodal image completion framing. */
  mediaCompletionVisionEnabled: boolean;
  /** ADR-108 Slice 1 — see `AdminPlanInput.videoVcoinMonthlyGrant`. */
  videoVcoinMonthlyGrant: number;
  runtimeTierDefault: AdminPlanRuntimeTier | null;
  toolActivations: AdminPlanToolActivation[];
  /** ADR-074 Slice L1 — see `AdminPlanInput.toolBudgets`. */
  toolBudgets: AdminPlanToolBudgets;
  /** ADR-121 Slice 4 — see `AdminPlanInput.thinkingBudgetByLevel`. */
  thinkingBudgetByLevel: AdminPlanThinkingBudgetByLevel;
  createdAt: string;
  updatedAt: string;
};

export type PublicPricingPlanState = {
  code: string;
  displayName: string;
  description: string | null;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  defaultOnRegistration: boolean;
  enabledToolCodes: string[];
  entitlements: AdminPlanEntitlementControls;
  quotaLimits: AdminPlanState["quotaLimits"];
  skillPolicy: AdminPlanState["skillPolicy"];
  assistantPolicy: AdminPlanState["assistantPolicy"];
  presentation: AdminPlanPresentation;
  /** ADR-108 Slice 6a — monthly Vcoin grant credited at subscription period rollover. 0 means no monthly grant. */
  videoVcoinMonthlyGrant: number;
  /** ADR-108 Slice 6a — platform Vcoin exchange rate at the time of the response (VC per 1 USD). */
  vcoinExchangeRate: number;
  /**
   * ADR-108 Slice 6a — server-computed marketing approximation:
   * floor(videoVcoinMonthlyGrant / ceil(avgUsdPerSecond × 5 × vcoinExchangeRate)).
   * Omitted when no time-metered video catalog rows are active OR when videoVcoinMonthlyGrant is 0.
   */
  videoVcoinApproxVideosPerMonth?: number;
};
