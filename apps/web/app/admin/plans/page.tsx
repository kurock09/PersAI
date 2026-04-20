"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import type {
  AdminPlanCreateRequest,
  AdminPlanState,
  AdminPlanToolActivation,
  AdminPlanUpdateRequest
} from "@persai/contracts";
import {
  deleteAdminPlan,
  getAdminPlans,
  getAdminRuntimeProviderSettings,
  patchAdminPlan,
  postAdminPlanCreate,
  postAdminForceReapplyAll,
  type ForceReapplyAllSummary
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

/* ─── Draft types ─── */

type ToolActivationDraft = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  active: boolean;
  dailyCallLimit: number | null;
};

type VideoGenerateModelDraft = "" | "sora-2" | "sora-2-pro";
type ContextPolicyPresetDraft = AdminPlanState["contextPolicy"]["preset"];
type ContextPolicyPresetWithDefaults = Exclude<ContextPolicyPresetDraft, "custom">;

export type PlanDraft = {
  displayName: string;
  description: string;
  status: "active" | "inactive";
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadataCommercialTag: string;
  metadataNotes: string;
  toolCostDriving: boolean;
  toolUtility: boolean;
  toolCostDrivingQuotaGoverned: boolean;
  toolUtilityQuotaGoverned: boolean;
  channelWebChat: boolean;
  channelTelegram: boolean;
  channelWhatsapp: boolean;
  channelMax: boolean;
  tokenBudgetLimit: string;
  mediaStorageMb: string;
  knowledgeStorageMb: string;
  workspaceStorageMb: string;
  retrievalDefaultMaxResults: string;
  retrievalHardMaxResults: string;
  retrievalLexicalCandidateLimit: string;
  retrievalVectorCandidateLimit: string;
  retrievalKnowledgeFetchWindowRadius: string;
  retrievalChatFetchWindowRadius: string;
  retrievalFetchMaxChars: string;
  retrievalHelperEnabled: boolean;
  retrievalHelperCandidateLimit: string;
  retrievalHelperMaxOutputTokens: string;
  retrievalEmbeddingSearchEnabled: boolean;
  sandboxEnabled: boolean;
  sandboxMaxSingleFileMb: string;
  sandboxMaxWorkspaceMb: string;
  sandboxMaxArtifactsPerJob: string;
  sandboxMaxFilesPerJob: string;
  sandboxMaxDirsPerJob: string;
  sandboxMaxProcessRuntimeMs: string;
  sandboxMaxCpuMs: string;
  sandboxMaxMemoryMb: string;
  sandboxMaxConcurrentProcesses: string;
  sandboxMaxStdoutKb: string;
  sandboxMaxStderrKb: string;
  sandboxNetworkAccessEnabled: boolean;
  sandboxArtifactMimeAllowlist: string;
  sandboxWebOutboundMb: string;
  sandboxTelegramOutboundMb: string;
  sandboxJobsPerDay: string;
  sandboxMaxArtifactSendCountPerTurn: string;
  contextPolicyPreset: ContextPolicyPresetDraft;
  targetContextBudget: string;
  compactionTriggerThreshold: string;
  keepRecentMinimum: string;
  knowledgeHydrationBudget: string;
  sharedCompactionSummaryBudgetTokens: string;
  autoCompactionWeb: boolean;
  autoCompactionTelegram: boolean;
  primaryModelKey: string;
  premiumModelKey: string;
  reasoningModelKey: string;
  retrievalModelKey: string;
  embeddingModelKey: string;
  videoGenerateModelKey: VideoGenerateModelDraft;
  runtimeTierDefault: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
  toolActivations: ToolActivationDraft[];
};

type NumericDraftField =
  | "tokenBudgetLimit"
  | "mediaStorageMb"
  | "knowledgeStorageMb"
  | "workspaceStorageMb"
  | "retrievalDefaultMaxResults"
  | "retrievalHardMaxResults"
  | "retrievalLexicalCandidateLimit"
  | "retrievalVectorCandidateLimit"
  | "retrievalKnowledgeFetchWindowRadius"
  | "retrievalChatFetchWindowRadius"
  | "retrievalFetchMaxChars"
  | "retrievalHelperCandidateLimit"
  | "retrievalHelperMaxOutputTokens"
  | "sandboxMaxSingleFileMb"
  | "sandboxMaxWorkspaceMb"
  | "sandboxMaxArtifactsPerJob"
  | "sandboxMaxFilesPerJob"
  | "sandboxMaxDirsPerJob"
  | "sandboxMaxProcessRuntimeMs"
  | "sandboxMaxCpuMs"
  | "sandboxMaxMemoryMb"
  | "sandboxMaxConcurrentProcesses"
  | "sandboxMaxStdoutKb"
  | "sandboxMaxStderrKb"
  | "sandboxJobsPerDay"
  | "sandboxWebOutboundMb"
  | "sandboxTelegramOutboundMb"
  | "sandboxMaxArtifactSendCountPerTurn"
  | "targetContextBudget"
  | "compactionTriggerThreshold"
  | "keepRecentMinimum"
  | "knowledgeHydrationBudget"
  | "sharedCompactionSummaryBudgetTokens";

type DraftValidationErrors = Partial<Record<NumericDraftField, string>>;
type NumericDraftRule = {
  field: NumericDraftField;
  label: string;
  min: number;
  allowBlank?: boolean;
};

export const VIDEO_GENERATE_MODEL_OPTIONS: Array<{
  value: VideoGenerateModelDraft;
  label: string;
}> = [
  { value: "", label: "default (sora-2)" },
  { value: "sora-2", label: "sora-2" },
  { value: "sora-2-pro", label: "sora-2-pro" }
];

const CONTEXT_POLICY_PRESET_OPTIONS: Array<{
  value: ContextPolicyPresetDraft;
  label: string;
}> = [
  { value: "lean", label: "Lean" },
  { value: "balanced", label: "Balanced" },
  { value: "rich", label: "Rich" },
  { value: "custom", label: "Custom" }
];

const DEFAULT_SHARED_COMPACTION_SUMMARY_BUDGET_RATIO = 0.04;
const MIN_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS = 250;
const MAX_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS = 1000;
const APPROX_SUMMARY_CHARS_PER_TOKEN = 4;

const CONTEXT_POLICY_PRESET_DEFAULTS: Record<
  ContextPolicyPresetWithDefaults,
  Omit<
    Pick<
      PlanDraft,
      | "targetContextBudget"
      | "compactionTriggerThreshold"
      | "keepRecentMinimum"
      | "knowledgeHydrationBudget"
      | "autoCompactionWeb"
      | "autoCompactionTelegram"
    >,
    never
  >
> = {
  lean: {
    targetContextBudget: "16000",
    compactionTriggerThreshold: "6000",
    keepRecentMinimum: "2",
    knowledgeHydrationBudget: "1200",
    autoCompactionWeb: true,
    autoCompactionTelegram: true
  },
  balanced: {
    targetContextBudget: "24000",
    compactionTriggerThreshold: "8000",
    keepRecentMinimum: "4",
    knowledgeHydrationBudget: "2400",
    autoCompactionWeb: false,
    autoCompactionTelegram: true
  },
  rich: {
    targetContextBudget: "32000",
    compactionTriggerThreshold: "12000",
    keepRecentMinimum: "6",
    knowledgeHydrationBudget: "3600",
    autoCompactionWeb: false,
    autoCompactionTelegram: true
  }
};

/* ─── Helpers ─── */

function toNullable(value: string): string | null {
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function toVideoGenerateModelDraft(
  value: AdminPlanState["videoGenerateModelKey"] | null | undefined
): VideoGenerateModelDraft {
  return value === "sora-2" || value === "sora-2-pro" ? value : "";
}

function applyContextPolicyPreset(
  preset: ContextPolicyPresetWithDefaults
): Pick<
  PlanDraft,
  | "contextPolicyPreset"
  | "targetContextBudget"
  | "compactionTriggerThreshold"
  | "keepRecentMinimum"
  | "knowledgeHydrationBudget"
  | "sharedCompactionSummaryBudgetTokens"
  | "autoCompactionWeb"
  | "autoCompactionTelegram"
> {
  return {
    contextPolicyPreset: preset,
    sharedCompactionSummaryBudgetTokens: "",
    ...CONTEXT_POLICY_PRESET_DEFAULTS[preset]
  };
}

function fallbackContextPolicyPreset(
  preset: ContextPolicyPresetDraft
): ContextPolicyPresetWithDefaults {
  return preset === "lean" || preset === "rich" ? preset : "balanced";
}

function parsePositiveIntDraft(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMimeAllowlistDraft(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseStrictIntegerDraft(
  value: string,
  options: { label: string; min: number; allowBlank?: boolean }
): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (options.allowBlank) {
      return null;
    }
    throw new Error(`${options.label} is required.`);
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${options.label} must be a whole number.`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < options.min) {
    if (options.allowBlank) {
      throw new Error(`${options.label} must be blank or at least ${String(options.min)}.`);
    }
    throw new Error(`${options.label} must be at least ${String(options.min)}.`);
  }
  return parsed;
}

const NUMERIC_DRAFT_RULES: NumericDraftRule[] = [
  { field: "tokenBudgetLimit", label: "Token budget", min: 1, allowBlank: true },
  { field: "mediaStorageMb", label: "Media upload budget (MB)", min: 1, allowBlank: true },
  { field: "knowledgeStorageMb", label: "Knowledge storage (MB)", min: 1, allowBlank: true },
  { field: "retrievalDefaultMaxResults", label: "Default results", min: 1 },
  { field: "retrievalHardMaxResults", label: "Hard max results", min: 1 },
  { field: "retrievalLexicalCandidateLimit", label: "Lexical candidate pool", min: 1 },
  { field: "retrievalVectorCandidateLimit", label: "Vector candidate pool", min: 1 },
  { field: "retrievalKnowledgeFetchWindowRadius", label: "Doc fetch radius", min: 1 },
  { field: "retrievalChatFetchWindowRadius", label: "Chat fetch radius", min: 1 },
  { field: "retrievalFetchMaxChars", label: "Fetch max chars", min: 1 },
  { field: "retrievalHelperCandidateLimit", label: "Helper candidates", min: 1 },
  { field: "retrievalHelperMaxOutputTokens", label: "Helper max output tokens", min: 1 },
  { field: "sandboxMaxSingleFileMb", label: "Single changed file cap (MB)", min: 1 },
  { field: "sandboxMaxWorkspaceMb", label: "Workspace growth per job (MB)", min: 1 },
  { field: "sandboxMaxArtifactsPerJob", label: "Persisted changed files per job", min: 1 },
  { field: "sandboxMaxFilesPerJob", label: "New files per job", min: 1 },
  { field: "sandboxMaxDirsPerJob", label: "New directories per job", min: 1 },
  { field: "sandboxMaxProcessRuntimeMs", label: "Process timeout (ms)", min: 1 },
  { field: "sandboxMaxCpuMs", label: "CPU budget (ms)", min: 1 },
  { field: "sandboxMaxMemoryMb", label: "Memory cap (MB)", min: 1 },
  { field: "sandboxMaxConcurrentProcesses", label: "Concurrent processes", min: 1 },
  { field: "sandboxMaxStdoutKb", label: "Stdout cap (KB)", min: 1 },
  { field: "sandboxMaxStderrKb", label: "Stderr cap (KB)", min: 1 },
  { field: "sandboxJobsPerDay", label: "Jobs per day", min: 1, allowBlank: true },
  { field: "sandboxWebOutboundMb", label: "Web delivery bytes per turn (MB)", min: 1 },
  { field: "sandboxTelegramOutboundMb", label: "Telegram delivery bytes per turn (MB)", min: 1 },
  { field: "sandboxMaxArtifactSendCountPerTurn", label: "Delivered files per turn", min: 1 },
  { field: "targetContextBudget", label: "Target context budget", min: 1 },
  { field: "compactionTriggerThreshold", label: "Compaction trigger", min: 1 },
  { field: "keepRecentMinimum", label: "Keep recent turns", min: 1 },
  { field: "knowledgeHydrationBudget", label: "Knowledge budget", min: 0 },
  {
    field: "sharedCompactionSummaryBudgetTokens",
    label: "Shared summary budget",
    min: 1,
    allowBlank: true
  }
];

export function validatePlanDraft(draft: PlanDraft): DraftValidationErrors {
  const errors: DraftValidationErrors = {};
  for (const rule of NUMERIC_DRAFT_RULES) {
    try {
      parseStrictIntegerDraft(draft[rule.field], rule);
    } catch (error) {
      errors[rule.field] = error instanceof Error ? error.message : `${rule.label} is invalid.`;
    }
  }
  return errors;
}

function clearValidationErrors(
  errors: DraftValidationErrors,
  patch: Partial<PlanDraft>
): DraftValidationErrors {
  const next = { ...errors };
  for (const key of Object.keys(patch)) {
    if (key in next) {
      delete next[key as NumericDraftField];
    }
  }
  return next;
}

function deriveSharedCompactionSummaryBudgetTokens(targetContextBudget: number): number {
  const derived = Math.floor(targetContextBudget * DEFAULT_SHARED_COMPACTION_SUMMARY_BUDGET_RATIO);
  return Math.max(
    MIN_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS,
    Math.min(MAX_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS, derived)
  );
}

function resolveDraftTargetContextBudget(
  draft: Pick<PlanDraft, "contextPolicyPreset" | "targetContextBudget">
): number {
  const defaults =
    CONTEXT_POLICY_PRESET_DEFAULTS[fallbackContextPolicyPreset(draft.contextPolicyPreset)];
  return parsePositiveIntDraft(
    draft.targetContextBudget,
    Number.parseInt(defaults.targetContextBudget, 10)
  );
}

function describeContextPolicySummaryBudget(policy: AdminPlanState["contextPolicy"]): string {
  const derived = deriveSharedCompactionSummaryBudgetTokens(policy.targetContextBudget);
  return policy.sharedCompactionSummaryBudgetTokens === undefined
    ? `auto (${String(derived)})`
    : String(policy.sharedCompactionSummaryBudgetTokens);
}

function isDraftTrialFieldsInvalid(
  draft: Pick<PlanDraft, "trialEnabled" | "trialDurationDays">
): boolean {
  // Server rejects the whole plan with a generic 400 when trialEnabled=true but
  // trialDurationDays is null/<=0 (see parseTrialDuration in manage-admin-plans.service.ts).
  // We block Save locally so the operator sees "required" inline instead of a cryptic error
  // toast after the roundtrip.
  return (
    draft.trialEnabled === true &&
    (draft.trialDurationDays === null || draft.trialDurationDays <= 0)
  );
}

function emptyDraft(): PlanDraft {
  return {
    displayName: "",
    description: "",
    status: "active",
    defaultOnRegistration: false,
    trialEnabled: false,
    trialDurationDays: null,
    metadataCommercialTag: "",
    metadataNotes: "",
    toolCostDriving: false,
    toolUtility: true,
    toolCostDrivingQuotaGoverned: true,
    toolUtilityQuotaGoverned: true,
    channelWebChat: true,
    channelTelegram: true,
    channelWhatsapp: false,
    channelMax: false,
    tokenBudgetLimit: "",
    mediaStorageMb: "",
    knowledgeStorageMb: "",
    workspaceStorageMb: "",
    retrievalDefaultMaxResults: "5",
    retrievalHardMaxResults: "8",
    retrievalLexicalCandidateLimit: "60",
    retrievalVectorCandidateLimit: "240",
    retrievalKnowledgeFetchWindowRadius: "1",
    retrievalChatFetchWindowRadius: "2",
    retrievalFetchMaxChars: "6000",
    retrievalHelperEnabled: true,
    retrievalHelperCandidateLimit: "6",
    retrievalHelperMaxOutputTokens: "220",
    retrievalEmbeddingSearchEnabled: true,
    sandboxEnabled: false,
    sandboxMaxSingleFileMb: "10",
    sandboxMaxWorkspaceMb: "25",
    sandboxMaxArtifactsPerJob: "64",
    sandboxMaxFilesPerJob: "256",
    sandboxMaxDirsPerJob: "128",
    sandboxMaxProcessRuntimeMs: "15000",
    sandboxMaxCpuMs: "15000",
    sandboxMaxMemoryMb: "256",
    sandboxMaxConcurrentProcesses: "4",
    sandboxMaxStdoutKb: "128",
    sandboxMaxStderrKb: "128",
    sandboxNetworkAccessEnabled: false,
    sandboxArtifactMimeAllowlist:
      "text/plain, text/markdown, application/json, application/pdf, application/zip, image/png, image/jpeg, audio/mpeg, audio/ogg, video/mp4",
    sandboxWebOutboundMb: "25",
    sandboxTelegramOutboundMb: "50",
    sandboxJobsPerDay: "",
    sandboxMaxArtifactSendCountPerTurn: "4",
    ...applyContextPolicyPreset("balanced"),
    primaryModelKey: "",
    premiumModelKey: "",
    reasoningModelKey: "",
    retrievalModelKey: "",
    embeddingModelKey: "",
    videoGenerateModelKey: "",
    runtimeTierDefault: "free_shared_restricted",
    toolActivations: []
  };
}

export function planToDraft(plan: AdminPlanState): PlanDraft {
  return {
    displayName: plan.displayName,
    description: plan.description ?? "",
    status: plan.status,
    defaultOnRegistration: plan.defaultOnRegistration,
    trialEnabled: plan.trialEnabled,
    trialDurationDays: plan.trialDurationDays,
    metadataCommercialTag: plan.metadata.commercialTag ?? "",
    metadataNotes: plan.metadata.notes ?? "",
    toolCostDriving: plan.entitlements.toolClasses.costDrivingTools,
    toolUtility: plan.entitlements.toolClasses.utilityTools,
    toolCostDrivingQuotaGoverned: plan.entitlements.toolClasses.costDrivingQuotaGoverned,
    toolUtilityQuotaGoverned: plan.entitlements.toolClasses.utilityQuotaGoverned,
    channelWebChat: plan.entitlements.channelsAndSurfaces.webChat,
    channelTelegram: plan.entitlements.channelsAndSurfaces.telegram,
    channelWhatsapp: plan.entitlements.channelsAndSurfaces.whatsapp,
    channelMax: plan.entitlements.channelsAndSurfaces.max,
    tokenBudgetLimit: plan.quotaLimits?.tokenBudgetLimit?.toString() ?? "",
    mediaStorageMb:
      plan.quotaLimits?.mediaStorageBytesLimit != null
        ? String(Math.round(plan.quotaLimits.mediaStorageBytesLimit / 1048576))
        : "",
    knowledgeStorageMb:
      plan.quotaLimits?.knowledgeStorageBytesLimit != null
        ? String(Math.round(plan.quotaLimits.knowledgeStorageBytesLimit / 1048576))
        : "",
    workspaceStorageMb:
      plan.quotaLimits?.workspaceStorageBytesLimit != null
        ? String(Math.round(plan.quotaLimits.workspaceStorageBytesLimit / 1048576))
        : "",
    retrievalDefaultMaxResults: String(plan.retrievalPolicy.defaultMaxResults),
    retrievalHardMaxResults: String(plan.retrievalPolicy.maxMaxResults),
    retrievalLexicalCandidateLimit: String(plan.retrievalPolicy.lexicalCandidateLimit),
    retrievalVectorCandidateLimit: String(plan.retrievalPolicy.vectorCandidateLimit),
    retrievalKnowledgeFetchWindowRadius: String(plan.retrievalPolicy.knowledgeFetchWindowRadius),
    retrievalChatFetchWindowRadius: String(plan.retrievalPolicy.chatFetchWindowRadius),
    retrievalFetchMaxChars: String(plan.retrievalPolicy.fetchMaxChars),
    retrievalHelperEnabled: plan.retrievalPolicy.helperEnabled,
    retrievalHelperCandidateLimit: String(plan.retrievalPolicy.helperCandidateLimit),
    retrievalHelperMaxOutputTokens: String(plan.retrievalPolicy.helperMaxOutputTokens),
    retrievalEmbeddingSearchEnabled: plan.retrievalPolicy.embeddingSearchEnabled,
    sandboxEnabled: plan.sandboxPolicy.enabled,
    sandboxMaxSingleFileMb: String(
      Math.round(plan.sandboxPolicy.maxSingleFileWriteBytes / 1048576)
    ),
    sandboxMaxWorkspaceMb: String(Math.round(plan.sandboxPolicy.maxWorkspaceBytesPerJob / 1048576)),
    sandboxMaxArtifactsPerJob: String(plan.sandboxPolicy.maxPersistedArtifactsPerJob),
    sandboxMaxFilesPerJob: String(plan.sandboxPolicy.maxFileCountPerJob),
    sandboxMaxDirsPerJob: String(plan.sandboxPolicy.maxDirectoryCountPerJob),
    sandboxMaxProcessRuntimeMs: String(plan.sandboxPolicy.maxProcessRuntimeMs),
    sandboxMaxCpuMs: String(plan.sandboxPolicy.maxCpuMsPerJob),
    sandboxMaxMemoryMb: String(Math.round(plan.sandboxPolicy.maxMemoryBytesPerJob / 1048576)),
    sandboxMaxConcurrentProcesses: String(plan.sandboxPolicy.maxConcurrentProcesses),
    sandboxMaxStdoutKb: String(Math.round(plan.sandboxPolicy.maxStdoutBytes / 1024)),
    sandboxMaxStderrKb: String(Math.round(plan.sandboxPolicy.maxStderrBytes / 1024)),
    sandboxNetworkAccessEnabled: plan.sandboxPolicy.networkAccessEnabled,
    sandboxArtifactMimeAllowlist: plan.sandboxPolicy.artifactMimeAllowlist.join(", "),
    sandboxWebOutboundMb: String(Math.round(plan.sandboxPolicy.webMaxOutboundBytes / 1048576)),
    sandboxTelegramOutboundMb: String(
      Math.round(plan.sandboxPolicy.telegramMaxOutboundBytes / 1048576)
    ),
    sandboxJobsPerDay: plan.sandboxPolicy.sandboxJobsPerDay?.toString() ?? "",
    sandboxMaxArtifactSendCountPerTurn: String(plan.sandboxPolicy.maxArtifactSendCountPerTurn),
    contextPolicyPreset: plan.contextPolicy.preset,
    targetContextBudget: plan.contextPolicy.targetContextBudget.toString(),
    compactionTriggerThreshold: plan.contextPolicy.compactionTriggerThreshold.toString(),
    keepRecentMinimum: plan.contextPolicy.keepRecentMinimum.toString(),
    knowledgeHydrationBudget: plan.contextPolicy.knowledgeHydrationBudget.toString(),
    sharedCompactionSummaryBudgetTokens:
      plan.contextPolicy.sharedCompactionSummaryBudgetTokens?.toString() ?? "",
    autoCompactionWeb: plan.contextPolicy.autoCompactionWeb,
    autoCompactionTelegram: plan.contextPolicy.autoCompactionTelegram,
    primaryModelKey: plan.primaryModelKey ?? "",
    premiumModelKey: plan.premiumModelKey ?? "",
    reasoningModelKey: plan.reasoningModelKey ?? "",
    retrievalModelKey: plan.retrievalModelKey ?? "",
    embeddingModelKey: plan.embeddingModelKey ?? "",
    videoGenerateModelKey: toVideoGenerateModelDraft(plan.videoGenerateModelKey),
    runtimeTierDefault: plan.runtimeTierDefault ?? "free_shared_restricted",
    toolActivations: (plan.toolActivations ?? [])
      .filter((ta) => ta.visibleInPlanEditor)
      .map((ta) => ({
        toolCode: ta.toolCode,
        displayName: ta.displayName,
        toolClass: ta.toolClass,
        policyClass: ta.policyClass,
        active: ta.active,
        dailyCallLimit: ta.dailyCallLimit
      }))
  };
}

export function draftToPayload(draft: PlanDraft): AdminPlanUpdateRequest {
  const validationErrors = validatePlanDraft(draft);
  const firstValidationError = Object.values(validationErrors)[0];
  if (firstValidationError) {
    throw new Error(firstValidationError);
  }
  const tokenBudgetLimit = parseStrictIntegerDraft(draft.tokenBudgetLimit, {
    label: "Token budget",
    min: 1,
    allowBlank: true
  });
  const mediaStorageMb = parseStrictIntegerDraft(draft.mediaStorageMb, {
    label: "Media upload budget (MB)",
    min: 1,
    allowBlank: true
  });
  const knowledgeStorageMb = parseStrictIntegerDraft(draft.knowledgeStorageMb, {
    label: "Knowledge storage (MB)",
    min: 1,
    allowBlank: true
  });
  const workspaceStorageMb = parseStrictIntegerDraft(draft.workspaceStorageMb, {
    label: "Workspace disk (MB)",
    min: 1,
    allowBlank: true
  });
  const sharedCompactionSummaryBudgetTokens = parseStrictIntegerDraft(
    draft.sharedCompactionSummaryBudgetTokens,
    {
      label: "Shared summary budget",
      min: 1,
      allowBlank: true
    }
  );
  return {
    displayName: draft.displayName.trim(),
    description: toNullable(draft.description),
    status: draft.status,
    defaultOnRegistration: draft.defaultOnRegistration,
    trialEnabled: draft.trialEnabled,
    trialDurationDays: draft.trialEnabled ? draft.trialDurationDays : null,
    metadata: {
      commercialTag: toNullable(draft.metadataCommercialTag),
      notes: toNullable(draft.metadataNotes)
    },
    entitlements: {
      toolClasses: {
        costDrivingTools: draft.toolCostDriving,
        utilityTools: draft.toolUtility,
        costDrivingQuotaGoverned: draft.toolCostDrivingQuotaGoverned,
        utilityQuotaGoverned: draft.toolUtilityQuotaGoverned
      },
      channelsAndSurfaces: {
        webChat: draft.channelWebChat,
        telegram: draft.channelTelegram,
        whatsapp: draft.channelWhatsapp,
        max: draft.channelMax
      }
    },
    quotaLimits: {
      tokenBudgetLimit,
      mediaStorageBytesLimit: mediaStorageMb === null ? null : mediaStorageMb * 1048576,
      knowledgeStorageBytesLimit: knowledgeStorageMb === null ? null : knowledgeStorageMb * 1048576,
      workspaceStorageBytesLimit: workspaceStorageMb === null ? null : workspaceStorageMb * 1048576
    },
    retrievalPolicy: {
      defaultMaxResults: parseStrictIntegerDraft(draft.retrievalDefaultMaxResults, {
        label: "Default results",
        min: 1
      })!,
      maxMaxResults: parseStrictIntegerDraft(draft.retrievalHardMaxResults, {
        label: "Hard max results",
        min: 1
      })!,
      lexicalCandidateLimit: parseStrictIntegerDraft(draft.retrievalLexicalCandidateLimit, {
        label: "Lexical candidate pool",
        min: 1
      })!,
      vectorCandidateLimit: parseStrictIntegerDraft(draft.retrievalVectorCandidateLimit, {
        label: "Vector candidate pool",
        min: 1
      })!,
      knowledgeFetchWindowRadius: parseStrictIntegerDraft(
        draft.retrievalKnowledgeFetchWindowRadius,
        {
          label: "Doc fetch radius",
          min: 1
        }
      )!,
      chatFetchWindowRadius: parseStrictIntegerDraft(draft.retrievalChatFetchWindowRadius, {
        label: "Chat fetch radius",
        min: 1
      })!,
      fetchMaxChars: parseStrictIntegerDraft(draft.retrievalFetchMaxChars, {
        label: "Fetch max chars",
        min: 1
      })!,
      helperEnabled: draft.retrievalHelperEnabled,
      helperCandidateLimit: parseStrictIntegerDraft(draft.retrievalHelperCandidateLimit, {
        label: "Helper candidates",
        min: 1
      })!,
      helperMaxOutputTokens: parseStrictIntegerDraft(draft.retrievalHelperMaxOutputTokens, {
        label: "Helper max output tokens",
        min: 1
      })!,
      embeddingSearchEnabled: draft.retrievalEmbeddingSearchEnabled
    },
    sandboxPolicy: {
      enabled: draft.sandboxEnabled,
      maxSingleFileWriteBytes:
        parseStrictIntegerDraft(draft.sandboxMaxSingleFileMb, {
          label: "Single changed file cap (MB)",
          min: 1
        })! * 1048576,
      maxWorkspaceBytesPerJob:
        parseStrictIntegerDraft(draft.sandboxMaxWorkspaceMb, {
          label: "Workspace growth per job (MB)",
          min: 1
        })! * 1048576,
      maxPersistedArtifactsPerJob: parseStrictIntegerDraft(draft.sandboxMaxArtifactsPerJob, {
        label: "Persisted changed files per job",
        min: 1
      })!,
      maxFileCountPerJob: parseStrictIntegerDraft(draft.sandboxMaxFilesPerJob, {
        label: "New files per job",
        min: 1
      })!,
      maxDirectoryCountPerJob: parseStrictIntegerDraft(draft.sandboxMaxDirsPerJob, {
        label: "New directories per job",
        min: 1
      })!,
      maxProcessRuntimeMs: parseStrictIntegerDraft(draft.sandboxMaxProcessRuntimeMs, {
        label: "Process timeout (ms)",
        min: 1
      })!,
      maxCpuMsPerJob: parseStrictIntegerDraft(draft.sandboxMaxCpuMs, {
        label: "CPU budget (ms)",
        min: 1
      })!,
      maxMemoryBytesPerJob:
        parseStrictIntegerDraft(draft.sandboxMaxMemoryMb, {
          label: "Memory cap (MB)",
          min: 1
        })! * 1048576,
      maxConcurrentProcesses: parseStrictIntegerDraft(draft.sandboxMaxConcurrentProcesses, {
        label: "Concurrent processes",
        min: 1
      })!,
      maxStdoutBytes:
        parseStrictIntegerDraft(draft.sandboxMaxStdoutKb, {
          label: "Stdout cap (KB)",
          min: 1
        })! * 1024,
      maxStderrBytes:
        parseStrictIntegerDraft(draft.sandboxMaxStderrKb, {
          label: "Stderr cap (KB)",
          min: 1
        })! * 1024,
      networkAccessEnabled: draft.sandboxNetworkAccessEnabled,
      artifactMimeAllowlist: parseMimeAllowlistDraft(draft.sandboxArtifactMimeAllowlist),
      webMaxOutboundBytes:
        parseStrictIntegerDraft(draft.sandboxWebOutboundMb, {
          label: "Web delivery bytes per turn (MB)",
          min: 1
        })! * 1048576,
      telegramMaxOutboundBytes:
        parseStrictIntegerDraft(draft.sandboxTelegramOutboundMb, {
          label: "Telegram delivery bytes per turn (MB)",
          min: 1
        })! * 1048576,
      sandboxJobsPerDay:
        parseStrictIntegerDraft(draft.sandboxJobsPerDay, {
          label: "Jobs per day",
          min: 1,
          allowBlank: true
        }) ?? null,
      maxArtifactSendCountPerTurn: parseStrictIntegerDraft(
        draft.sandboxMaxArtifactSendCountPerTurn,
        {
          label: "Delivered files per turn",
          min: 1
        }
      )!
    },
    contextPolicy: {
      preset: draft.contextPolicyPreset,
      targetContextBudget: parseStrictIntegerDraft(draft.targetContextBudget, {
        label: "Target context budget",
        min: 1
      })!,
      compactionTriggerThreshold: parseStrictIntegerDraft(draft.compactionTriggerThreshold, {
        label: "Compaction trigger",
        min: 1
      })!,
      keepRecentMinimum: parseStrictIntegerDraft(draft.keepRecentMinimum, {
        label: "Keep recent turns",
        min: 1
      })!,
      knowledgeHydrationBudget: parseStrictIntegerDraft(draft.knowledgeHydrationBudget, {
        label: "Knowledge budget",
        min: 0
      })!,
      ...(sharedCompactionSummaryBudgetTokens === null
        ? {}
        : {
            sharedCompactionSummaryBudgetTokens
          }),
      autoCompactionWeb: draft.autoCompactionWeb,
      autoCompactionTelegram: draft.autoCompactionTelegram
    },
    primaryModelKey: toNullable(draft.primaryModelKey),
    premiumModelKey: toNullable(draft.premiumModelKey),
    reasoningModelKey: toNullable(draft.reasoningModelKey),
    retrievalModelKey: toNullable(draft.retrievalModelKey),
    embeddingModelKey: toNullable(draft.embeddingModelKey),
    videoGenerateModelKey: draft.videoGenerateModelKey === "" ? null : draft.videoGenerateModelKey,
    toolActivations: draft.toolActivations.map((ta) => ({
      toolCode: ta.toolCode,
      active: ta.active,
      dailyCallLimit: ta.dailyCallLimit
    }))
  };
}

function getPolicyClassLabel(
  policyClass: AdminPlanToolActivation["policyClass"] | ToolActivationDraft["policyClass"]
): string {
  switch (policyClass) {
    case "platform_managed":
      return "system";
    case "hidden_internal":
      return "internal";
    default:
      return "plan";
  }
}

function splitToolActivationsByPolicy<
  T extends { policyClass: AdminPlanToolActivation["policyClass"]; toolCode: string }
>(
  activations: T[]
): {
  planManaged: T[];
  platformManaged: T[];
  hiddenInternal: T[];
} {
  return {
    planManaged: activations.filter((ta) => ta.policyClass === "plan_managed"),
    platformManaged: activations.filter((ta) => ta.policyClass === "platform_managed"),
    hiddenInternal: activations.filter((ta) => ta.policyClass === "hidden_internal")
  };
}

/* ─── Tiny UI primitives ─── */

function Pill({
  children,
  variant = "default"
}: {
  children: ReactNode;
  variant?: "default" | "green" | "amber" | "dim";
}) {
  const cls = {
    default: "bg-accent/15 text-accent",
    green: "bg-emerald-500/15 text-emerald-400",
    amber: "bg-amber-500/15 text-amber-400",
    dim: "bg-white/5 text-text-muted"
  };
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-px text-[10px] font-semibold leading-tight",
        cls[variant]
      )}
    >
      {children}
    </span>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="text-[11px]">
      <span className="text-text-muted">{label}:</span>{" "}
      <span className="text-text">{children}</span>
    </span>
  );
}

function Sec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function HelpText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10px] leading-snug text-text-subtle/80", className)}>{children}</p>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) {
    return null;
  }
  return <HelpText className="mt-1 text-red-300">{message}</HelpText>;
}

function Panel({
  title,
  hint,
  children,
  className
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-accent/20 bg-surface-raised p-2.5", className)}>
      <div className="mb-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
          {title}
        </div>
        {hint ? <HelpText className="mt-1">{hint}</HelpText> : null}
      </div>
      {children}
    </div>
  );
}

function SubPanel({
  title,
  hint,
  children,
  className
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded border border-border/70 bg-surface px-2.5 py-2", className)}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">{title}</div>
      {hint ? <HelpText className="mt-1">{hint}</HelpText> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-1.5 text-[11px] text-text select-none",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 rounded border-border bg-surface-raised text-accent focus:ring-accent/50 focus:ring-1"
      />
      {label}
    </label>
  );
}

function Input({
  value,
  onValue,
  placeholder,
  invalid = false,
  className: extra,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onValue: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onValue(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full rounded border bg-surface-raised px-2 py-1 text-[11px] text-text placeholder:text-text-subtle focus:outline-none focus:ring-1",
        invalid ? "border-red-400/70 focus:ring-red-400/50" : "border-border focus:ring-accent/50",
        extra
      )}
      {...rest}
    />
  );
}

/* ─── Tool activations (read-only inline) ─── */

function ToolActivationsInline({ activations }: { activations: AdminPlanToolActivation[] }) {
  const visibleActivations = activations.filter((ta) => ta.policyClass !== "hidden_internal");
  if (visibleActivations.length === 0) {
    return <span className="text-[10px] text-text-subtle italic">none configured</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {visibleActivations.map((ta) => (
        <span key={ta.toolCode} className="text-[10px]">
          <span className={ta.active ? "text-emerald-400" : "text-text-muted line-through"}>
            {ta.displayName}
          </span>
          {ta.dailyCallLimit !== null && (
            <span className="ml-0.5 text-text-subtle">({ta.dailyCallLimit}/d)</span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ─── Tool activations (edit table) ─── */

export function ToolActivationsEdit({
  activations,
  onUpdate,
  videoGenerateModelKey,
  onVideoGenerateModelKeyChange
}: {
  activations: ToolActivationDraft[];
  onUpdate: (updated: ToolActivationDraft[]) => void;
  videoGenerateModelKey: VideoGenerateModelDraft;
  onVideoGenerateModelKeyChange: (value: VideoGenerateModelDraft) => void;
}) {
  if (activations.length === 0) {
    return (
      <p className="text-[10px] text-text-subtle italic">
        Will be generated from tool class defaults after first save.
      </p>
    );
  }

  function toggle(idx: number) {
    const next = activations.map((a, i) => (i === idx ? { ...a, active: !a.active } : a));
    onUpdate(next);
  }

  function setLimit(idx: number, val: string) {
    const next = activations.map((a, i) =>
      i === idx
        ? { ...a, dailyCallLimit: val === "" ? null : Math.max(0, Math.floor(Number(val))) }
        : a
    );
    onUpdate(next);
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {activations.map((ta, idx) => (
        <div
          key={ta.toolCode}
          className="rounded-md border border-border/80 bg-surface-raised px-3 py-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] font-semibold text-text">{ta.displayName}</span>
                <span className="font-mono text-[10px] text-text-subtle">{ta.toolCode}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Pill variant={ta.toolClass === "cost_driving" ? "amber" : "dim"}>
                  {ta.toolClass === "cost_driving" ? "cost" : "util"}
                </Pill>
                <Pill variant="dim">{getPolicyClassLabel(ta.policyClass)}</Pill>
              </div>
            </div>
            <label className="grid shrink-0 gap-1 text-[10px] font-medium text-text-subtle">
              <span className="text-right uppercase tracking-wider">On</span>
              <input
                type="checkbox"
                checked={ta.active}
                onChange={() => toggle(idx)}
                aria-label={`${ta.displayName} enabled`}
                className="ml-auto h-3 w-3 rounded border-border bg-surface text-accent focus:ring-accent/50 focus:ring-1"
              />
            </label>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              {ta.toolCode === "video_generate" ? (
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                    Model
                  </span>
                  <select
                    value={videoGenerateModelKey}
                    onChange={(e) =>
                      onVideoGenerateModelKeyChange(e.target.value as VideoGenerateModelDraft)
                    }
                    className="min-w-0 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text focus:outline-none focus:ring-1 focus:ring-accent/50"
                  >
                    {VIDEO_GENERATE_MODEL_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <HelpText>
                  Blank daily cap means this tool inherits the plan default behavior.
                </HelpText>
              )}
            </div>
            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                Daily cap
              </span>
              <input
                type="number"
                min={0}
                value={ta.dailyCallLimit ?? ""}
                onChange={(e) => setLimit(idx, e.target.value)}
                placeholder="inherit"
                className="w-full appearance-none rounded border border-border bg-surface px-2 py-1 text-[11px] text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolActivationReadOnlyGroup({
  title,
  emptyLabel,
  activations,
  showLimits = true
}: {
  title: string;
  emptyLabel: string;
  activations: AdminPlanToolActivation[];
  showLimits?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Sec label={title}>
        {activations.length === 0 ? (
          <span className="text-[10px] text-text-subtle italic">{emptyLabel}</span>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {activations.map((ta) => (
              <span key={ta.toolCode} className="text-[10px]">
                <span className={ta.active ? "text-emerald-400" : "text-text-muted line-through"}>
                  {ta.displayName}
                </span>
                <span className="ml-1 text-text-subtle">
                  ({getPolicyClassLabel(ta.policyClass)})
                </span>
                {showLimits && ta.dailyCallLimit !== null ? (
                  <span className="ml-0.5 text-text-subtle">({ta.dailyCallLimit}/d)</span>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </Sec>
    </div>
  );
}

/* ─── Compact plan form (edit / create) ─── */

function PlanForm({
  draft,
  onPatch,
  validationErrors,
  showCode,
  code,
  onCodeChange,
  availableModelKeys = []
}: {
  draft: PlanDraft;
  onPatch: (p: Partial<PlanDraft>) => void;
  validationErrors: DraftValidationErrors;
  showCode: boolean;
  code: string;
  onCodeChange: (v: string) => void;
  availableModelKeys?: { provider: string; model: string }[];
}) {
  const editableActivations = draft.toolActivations.filter(
    (ta) => ta.policyClass === "plan_managed"
  );
  return (
    <div className="space-y-2.5">
      {/* row 1: code + name + description */}
      <div className={cn("grid gap-2", showCode ? "grid-cols-[120px_1fr_1fr]" : "grid-cols-2")}>
        {showCode && (
          <div>
            <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
              Code
            </label>
            <Input value={code} onValue={onCodeChange} placeholder="plan_code" autoComplete="off" />
          </div>
        )}
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Name
          </label>
          <Input value={draft.displayName} onValue={(v) => onPatch({ displayName: v })} />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Description
          </label>
          <Input value={draft.description} onValue={(v) => onPatch({ description: v })} />
        </div>
      </div>

      {/* row 2: status + flags */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1 rounded border border-border bg-surface p-px">
          {(["active", "inactive"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPatch({ status: s })}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                draft.status === s
                  ? "bg-surface-raised text-text shadow-sm"
                  : "text-text-muted hover:text-text"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Check
          label="Default on reg"
          checked={draft.defaultOnRegistration}
          onChange={(v) => onPatch({ defaultOnRegistration: v })}
        />
        <Check
          label="Trial"
          checked={draft.trialEnabled}
          onChange={(v) => {
            // Auto-fill a sane default when the operator toggles Trial on and the number
            // field is still empty. Without this the server rejected the whole plan with a
            // generic 400 because the client sent { trialEnabled: true, trialDurationDays: null },
            // which looked to the user like "Trial plans cannot be saved at all".
            if (v && (draft.trialDurationDays === null || draft.trialDurationDays <= 0)) {
              onPatch({ trialEnabled: true, trialDurationDays: 14 });
              return;
            }
            onPatch({ trialEnabled: v });
          }}
        />
        {draft.trialEnabled && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={draft.trialDurationDays ?? ""}
              onChange={(e) =>
                onPatch({
                  trialDurationDays:
                    e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value)))
                })
              }
              className={cn(
                "w-14 rounded border bg-surface-raised px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:ring-1 focus:ring-accent/50",
                draft.trialDurationDays === null || draft.trialDurationDays <= 0
                  ? "border-red-500/60"
                  : "border-border"
              )}
            />
            <span className="text-[10px] text-text-muted">days</span>
            {(draft.trialDurationDays === null || draft.trialDurationDays <= 0) && (
              <span className="text-[10px] font-medium text-red-500/80">required</span>
            )}
          </div>
        )}
      </div>

      {/* row 3: metadata */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Commercial tag
          </label>
          <Input
            value={draft.metadataCommercialTag}
            onValue={(v) => onPatch({ metadataCommercialTag: v })}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Notes
          </label>
          <Input value={draft.metadataNotes} onValue={(v) => onPatch({ metadataNotes: v })} />
        </div>
      </div>

      {/* row 4: access + plan defaults */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(280px,0.92fr)_minmax(0,1.45fr)]">
        <Panel
          title="Access surface"
          hint="Broad plan access switches. Keep these simple, then tune individual tools lower on the page."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <SubPanel
              title="Tool classes"
              hint="Cost tools spend quota units. Utility tools are usually free helpers."
            >
              <div className="grid gap-1">
                <Check
                  label="Cost-driving"
                  checked={draft.toolCostDriving}
                  onChange={(v) => onPatch({ toolCostDriving: v })}
                />
                <Check
                  label="Utility"
                  checked={draft.toolUtility}
                  onChange={(v) => onPatch({ toolUtility: v })}
                />
                <Check
                  label="Cost quota"
                  checked={draft.toolCostDrivingQuotaGoverned}
                  onChange={(v) => onPatch({ toolCostDrivingQuotaGoverned: v })}
                />
                <Check
                  label="Util quota"
                  checked={draft.toolUtilityQuotaGoverned}
                  onChange={(v) => onPatch({ toolUtilityQuotaGoverned: v })}
                />
              </div>
            </SubPanel>
            <SubPanel
              title="Channels"
              hint="Messaging surfaces available to workspaces on this plan."
            >
              <div className="grid gap-1">
                <Check
                  label="Web Chat"
                  checked={draft.channelWebChat}
                  onChange={(v) => onPatch({ channelWebChat: v })}
                />
                <Check
                  label="Telegram"
                  checked={draft.channelTelegram}
                  onChange={(v) => onPatch({ channelTelegram: v })}
                />
                <Check
                  label="WhatsApp"
                  checked={draft.channelWhatsapp}
                  onChange={(v) => onPatch({ channelWhatsapp: v })}
                />
                <Check
                  label="Max"
                  checked={draft.channelMax}
                  onChange={(v) => onPatch({ channelMax: v })}
                />
              </div>
            </SubPanel>
          </div>
          <HelpText className="mt-2">
            Runtime routing default is server-managed on the active product path and is no longer
            edited here.
          </HelpText>
        </Panel>
        <Panel
          title="Plan limits and model defaults"
          hint="The plan tuning knobs admins usually touch: budgets, retrieval behavior, and model defaults."
        >
          <div className="grid gap-2">
            <SubPanel title="Quota limits">
              <div className="space-y-1.5">
                <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-text">
                  Token budget
                  <input
                    type="number"
                    min={0}
                    value={draft.tokenBudgetLimit}
                    onChange={(e) => onPatch({ tokenBudgetLimit: e.target.value })}
                    placeholder="default"
                    className={cn(
                      "w-28 appearance-none rounded border bg-bg px-2 py-1 text-right text-xs text-text placeholder:text-text-subtle/70 focus:outline-none focus:ring-1 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]",
                      validationErrors.tokenBudgetLimit
                        ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/50"
                        : "border-border focus:border-accent focus:ring-accent/50"
                    )}
                  />
                </label>
                <FieldError message={validationErrors.tokenBudgetLimit} />
                <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-text">
                  <span title="User upload budget — max MB users can upload through chat (images, voice, docs). Tracked by PersAI API.">
                    Media upload budget (MB)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={draft.mediaStorageMb}
                    onChange={(e) => onPatch({ mediaStorageMb: e.target.value })}
                    placeholder="default"
                    className={cn(
                      "w-28 appearance-none rounded border bg-bg px-2 py-1 text-right text-xs text-text placeholder:text-text-subtle/70 focus:outline-none focus:ring-1 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]",
                      validationErrors.mediaStorageMb
                        ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/50"
                        : "border-border focus:border-accent focus:ring-accent/50"
                    )}
                  />
                </label>
                <FieldError message={validationErrors.mediaStorageMb} />
                <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-text">
                  <span title="Assistant-owned knowledge storage budget — max MB for indexed knowledge sources. Tracked separately from chat uploads and sandbox files.">
                    Knowledge storage (MB)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={draft.knowledgeStorageMb}
                    onChange={(e) => onPatch({ knowledgeStorageMb: e.target.value })}
                    placeholder="default"
                    className={cn(
                      "w-28 appearance-none rounded border bg-bg px-2 py-1 text-right text-xs text-text placeholder:text-text-subtle/70 focus:outline-none focus:ring-1 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]",
                      validationErrors.knowledgeStorageMb
                        ? "border-red-400/70 focus:border-red-400 focus:ring-red-400/50"
                        : "border-border focus:border-accent focus:ring-accent/50"
                    )}
                  />
                </label>
                <FieldError message={validationErrors.knowledgeStorageMb} />
              </div>
            </SubPanel>

            <SubPanel title="Retrieval policy">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  {
                    key: "retrievalDefaultMaxResults" as const,
                    label: "Default results",
                    value: draft.retrievalDefaultMaxResults,
                    patch: (value: string) => onPatch({ retrievalDefaultMaxResults: value })
                  },
                  {
                    key: "retrievalHardMaxResults" as const,
                    label: "Hard max results",
                    value: draft.retrievalHardMaxResults,
                    patch: (value: string) => onPatch({ retrievalHardMaxResults: value })
                  },
                  {
                    key: "retrievalLexicalCandidateLimit" as const,
                    label: "Lexical candidate pool",
                    value: draft.retrievalLexicalCandidateLimit,
                    patch: (value: string) => onPatch({ retrievalLexicalCandidateLimit: value })
                  },
                  {
                    key: "retrievalVectorCandidateLimit" as const,
                    label: "Vector candidate pool",
                    value: draft.retrievalVectorCandidateLimit,
                    patch: (value: string) => onPatch({ retrievalVectorCandidateLimit: value })
                  },
                  {
                    key: "retrievalKnowledgeFetchWindowRadius" as const,
                    label: "Doc fetch radius",
                    value: draft.retrievalKnowledgeFetchWindowRadius,
                    patch: (value: string) =>
                      onPatch({ retrievalKnowledgeFetchWindowRadius: value })
                  },
                  {
                    key: "retrievalChatFetchWindowRadius" as const,
                    label: "Chat fetch radius",
                    value: draft.retrievalChatFetchWindowRadius,
                    patch: (value: string) => onPatch({ retrievalChatFetchWindowRadius: value })
                  },
                  {
                    key: "retrievalFetchMaxChars" as const,
                    label: "Fetch max chars",
                    value: draft.retrievalFetchMaxChars,
                    patch: (value: string) => onPatch({ retrievalFetchMaxChars: value })
                  },
                  {
                    key: "retrievalHelperCandidateLimit" as const,
                    label: "Helper candidates",
                    value: draft.retrievalHelperCandidateLimit,
                    patch: (value: string) => onPatch({ retrievalHelperCandidateLimit: value })
                  },
                  {
                    key: "retrievalHelperMaxOutputTokens" as const,
                    label: "Helper max output tokens",
                    value: draft.retrievalHelperMaxOutputTokens,
                    patch: (value: string) => onPatch({ retrievalHelperMaxOutputTokens: value })
                  }
                ].map((field) => (
                  <label
                    key={field.label}
                    className="flex items-center justify-between gap-2 text-[11px] font-medium text-text"
                  >
                    {field.label}
                    <Input
                      type="number"
                      min={1}
                      value={field.value}
                      onValue={field.patch}
                      invalid={Boolean(validationErrors[field.key])}
                      className="w-28 appearance-none bg-bg text-right text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                    />
                    <FieldError message={validationErrors[field.key]} />
                  </label>
                ))}
              </div>
              <div className="mt-2 grid gap-1.5">
                <label className="inline-flex items-center gap-2 text-[11px] text-text-subtle">
                  <input
                    type="checkbox"
                    checked={draft.retrievalHelperEnabled}
                    onChange={(e) => onPatch({ retrievalHelperEnabled: e.target.checked })}
                    className="rounded border-border"
                  />
                  Enable helper rerank
                </label>
                <label className="inline-flex items-center gap-2 text-[11px] text-text-subtle">
                  <input
                    type="checkbox"
                    checked={draft.retrievalEmbeddingSearchEnabled}
                    onChange={(e) => onPatch({ retrievalEmbeddingSearchEnabled: e.target.checked })}
                    className="rounded border-border"
                  />
                  Enable embedding search on query
                </label>
              </div>
            </SubPanel>

            <SubPanel title="AI model slots">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  {
                    label: "Normal reply",
                    value: draft.primaryModelKey,
                    patch: (value: string) => onPatch({ primaryModelKey: value }),
                    placeholder: "platform default"
                  },
                  {
                    label: "Premium reply",
                    value: draft.premiumModelKey,
                    patch: (value: string) => onPatch({ premiumModelKey: value }),
                    placeholder: "normal reply"
                  },
                  {
                    label: "Reasoning",
                    value: draft.reasoningModelKey,
                    patch: (value: string) => onPatch({ reasoningModelKey: value }),
                    placeholder: "premium reply"
                  },
                  {
                    label: "Retrieval helper",
                    value: draft.retrievalModelKey,
                    patch: (value: string) => onPatch({ retrievalModelKey: value }),
                    placeholder: "system/runtime default"
                  },
                  {
                    label: "Embedding index",
                    value: draft.embeddingModelKey,
                    patch: (value: string) => onPatch({ embeddingModelKey: value }),
                    placeholder: "retrieval helper / runtime default"
                  }
                ].map((slot) => (
                  <label key={slot.label} className="grid gap-1">
                    <span className="text-[11px] font-medium text-text">{slot.label}</span>
                    <select
                      value={slot.value}
                      onChange={(e) => slot.patch(e.target.value)}
                      className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
                    >
                      <option value="">{slot.placeholder}</option>
                      {availableModelKeys.length > 0
                        ? Object.entries(
                            availableModelKeys.reduce<Record<string, string[]>>(
                              (acc, { provider, model }) => {
                                (acc[provider] ??= []).push(model);
                                return acc;
                              },
                              {}
                            )
                          ).map(([provider, models]) => (
                            <optgroup key={provider} label={provider}>
                              {models.map((m) => (
                                <option key={`${slot.label}-${m}`} value={m}>
                                  {m}
                                </option>
                              ))}
                            </optgroup>
                          ))
                        : null}
                    </select>
                  </label>
                ))}
              </div>
            </SubPanel>
          </div>
        </Panel>
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Sec label="Sandbox policy">
          <div className="rounded border border-border bg-surface px-3 py-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Check
                label="Enable sandbox tools"
                checked={draft.sandboxEnabled}
                onChange={(value) =>
                  onPatch(
                    value
                      ? { sandboxEnabled: true }
                      : { sandboxEnabled: false, sandboxNetworkAccessEnabled: false }
                  )
                }
              />
              <Check
                label="Allow sandbox network"
                checked={draft.sandboxNetworkAccessEnabled}
                onChange={(value) => onPatch({ sandboxNetworkAccessEnabled: value })}
                disabled={!draft.sandboxEnabled}
              />
            </div>
            <HelpText className="mt-2">
              Keep network off unless the plan truly needs outbound sandbox access. Disabling
              sandbox also turns network off.
            </HelpText>

            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              <SubPanel title="Workspace and files">
                <div className="grid gap-2">
                  {[
                    {
                      key: "sandboxMaxSingleFileMb" as const,
                      label: "Single changed file cap (MB)",
                      hint: "Applies to every file the job writes or updates before it is persisted.",
                      value: draft.sandboxMaxSingleFileMb,
                      patch: (value: string) => onPatch({ sandboxMaxSingleFileMb: value })
                    },
                    {
                      key: "sandboxMaxWorkspaceMb" as const,
                      label: "Workspace growth per job (MB)",
                      hint: "Limits net added bytes for this job, not the total durable workspace size.",
                      value: draft.sandboxMaxWorkspaceMb,
                      patch: (value: string) => onPatch({ sandboxMaxWorkspaceMb: value })
                    },
                    {
                      key: "sandboxMaxArtifactsPerJob" as const,
                      label: "Persisted changed files per job",
                      hint: "Counts files that end the job as new or modified and need to be persisted.",
                      value: draft.sandboxMaxArtifactsPerJob,
                      patch: (value: string) => onPatch({ sandboxMaxArtifactsPerJob: value })
                    },
                    {
                      key: "sandboxMaxFilesPerJob" as const,
                      label: "New files per job",
                      hint: "Caps how many new filesystem entries the job may add.",
                      value: draft.sandboxMaxFilesPerJob,
                      patch: (value: string) => onPatch({ sandboxMaxFilesPerJob: value })
                    },
                    {
                      key: "sandboxMaxDirsPerJob" as const,
                      label: "New directories per job",
                      hint: "Caps newly created directories; existing durable folders do not count again.",
                      value: draft.sandboxMaxDirsPerJob,
                      patch: (value: string) => onPatch({ sandboxMaxDirsPerJob: value })
                    }
                  ].map((field) => (
                    <label
                      key={field.label}
                      className="space-y-1 text-[11px] font-medium text-text"
                    >
                      <span className="block">{field.label}</span>
                      <Input
                        type="number"
                        min={0}
                        value={field.value}
                        onValue={field.patch}
                        invalid={Boolean(validationErrors[field.key])}
                      />
                      <HelpText>{field.hint}</HelpText>
                      <FieldError message={validationErrors[field.key]} />
                    </label>
                  ))}
                </div>
              </SubPanel>

              <SubPanel title="Processes and output">
                <div className="grid gap-2">
                  {[
                    {
                      key: "sandboxMaxProcessRuntimeMs" as const,
                      label: "Process timeout (ms)",
                      hint: "Hard wall-clock timeout for a single sandbox job.",
                      value: draft.sandboxMaxProcessRuntimeMs,
                      patch: (value: string) => onPatch({ sandboxMaxProcessRuntimeMs: value })
                    },
                    {
                      key: "sandboxMaxCpuMs" as const,
                      label: "CPU budget (ms)",
                      hint: "Approximate total CPU time across spawned processes in one job.",
                      value: draft.sandboxMaxCpuMs,
                      patch: (value: string) => onPatch({ sandboxMaxCpuMs: value })
                    },
                    {
                      key: "sandboxMaxMemoryMb" as const,
                      label: "Memory cap (MB)",
                      hint: "Peak combined memory across the process tree.",
                      value: draft.sandboxMaxMemoryMb,
                      patch: (value: string) => onPatch({ sandboxMaxMemoryMb: value })
                    },
                    {
                      key: "sandboxMaxConcurrentProcesses" as const,
                      label: "Concurrent processes",
                      hint: "Stops shell or exec jobs from spawning too many processes at once.",
                      value: draft.sandboxMaxConcurrentProcesses,
                      patch: (value: string) => onPatch({ sandboxMaxConcurrentProcesses: value })
                    },
                    {
                      key: "sandboxMaxStdoutKb" as const,
                      label: "Stdout cap (KB)",
                      hint: "Prevents huge stdout dumps from clogging the runtime.",
                      value: draft.sandboxMaxStdoutKb,
                      patch: (value: string) => onPatch({ sandboxMaxStdoutKb: value })
                    },
                    {
                      key: "sandboxMaxStderrKb" as const,
                      label: "Stderr cap (KB)",
                      hint: "Prevents runaway stderr spam from the process tree.",
                      value: draft.sandboxMaxStderrKb,
                      patch: (value: string) => onPatch({ sandboxMaxStderrKb: value })
                    },
                    {
                      key: "sandboxJobsPerDay" as const,
                      label: "Jobs per day",
                      hint: "Plan quota. Leave blank to remove the daily sandbox-job cap.",
                      value: draft.sandboxJobsPerDay,
                      patch: (value: string) => onPatch({ sandboxJobsPerDay: value })
                    }
                  ].map((field) => (
                    <label
                      key={field.label}
                      className="space-y-1 text-[11px] font-medium text-text"
                    >
                      <span className="block">{field.label}</span>
                      <Input
                        type="number"
                        min={0}
                        value={field.value}
                        onValue={field.patch}
                        invalid={Boolean(validationErrors[field.key])}
                      />
                      <HelpText>{field.hint}</HelpText>
                      <FieldError message={validationErrors[field.key]} />
                    </label>
                  ))}
                </div>
              </SubPanel>

              <SubPanel
                title="Delivery"
                hint="Final delivery limits for files selected through the `files` tool."
              >
                <div className="grid gap-2">
                  {[
                    {
                      key: "sandboxWebOutboundMb" as const,
                      label: "Web delivery bytes per turn (MB)",
                      hint: "Total bytes the turn may deliver through `files.send` on web-like channels.",
                      value: draft.sandboxWebOutboundMb,
                      patch: (value: string) => onPatch({ sandboxWebOutboundMb: value })
                    },
                    {
                      key: "sandboxTelegramOutboundMb" as const,
                      label: "Telegram delivery bytes per turn (MB)",
                      hint: "Telegram has its own outbound delivery ceiling for `files.send`.",
                      value: draft.sandboxTelegramOutboundMb,
                      patch: (value: string) => onPatch({ sandboxTelegramOutboundMb: value })
                    },
                    {
                      key: "sandboxMaxArtifactSendCountPerTurn" as const,
                      label: "Delivered files per turn",
                      hint: "Caps how many files a single turn may deliver to the user.",
                      value: draft.sandboxMaxArtifactSendCountPerTurn,
                      patch: (value: string) =>
                        onPatch({ sandboxMaxArtifactSendCountPerTurn: value })
                    }
                  ].map((field) => (
                    <label
                      key={field.label}
                      className="space-y-1 text-[11px] font-medium text-text"
                    >
                      <span className="block">{field.label}</span>
                      <Input
                        type="number"
                        min={0}
                        value={field.value}
                        onValue={field.patch}
                        invalid={Boolean(validationErrors[field.key])}
                      />
                      <HelpText>{field.hint}</HelpText>
                      <FieldError message={validationErrors[field.key]} />
                    </label>
                  ))}
                  <label className="space-y-1 text-[11px] font-medium text-text">
                    <span className="block">Allowed delivery mime types</span>
                    <textarea
                      value={draft.sandboxArtifactMimeAllowlist}
                      onChange={(e) => onPatch({ sandboxArtifactMimeAllowlist: e.target.value })}
                      rows={4}
                      className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
                      placeholder="text/plain, application/json, image/png"
                    />
                    <HelpText>
                      Comma-separated allowlist for files that may be delivered through
                      `files.send`.
                    </HelpText>
                  </label>
                </div>
              </SubPanel>
            </div>
          </div>
        </Sec>

        {/* row 5: context policy */}
        <Sec label="Context policy">
          <div className="rounded border border-border bg-surface px-3 py-2">
            <div className="grid gap-2">
              <SubPanel
                title="Preset"
                hint="Presets tune prompt budget, compaction pressure, and auto behavior. Any manual override switches the draft to custom."
              >
                <select
                  value={draft.contextPolicyPreset}
                  onChange={(e) => {
                    const preset = e.target.value as ContextPolicyPresetDraft;
                    if (preset === "lean" || preset === "balanced" || preset === "rich") {
                      onPatch(applyContextPolicyPreset(preset));
                      return;
                    }
                    onPatch({ contextPolicyPreset: "custom" });
                  }}
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
                >
                  {CONTEXT_POLICY_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 grid gap-1">
                  <Check
                    label="Auto-compact on web"
                    checked={draft.autoCompactionWeb}
                    onChange={(value) =>
                      onPatch({
                        contextPolicyPreset: "custom",
                        autoCompactionWeb: value
                      })
                    }
                  />
                  <Check
                    label="Auto-compact on Telegram"
                    checked={draft.autoCompactionTelegram}
                    onChange={(value) =>
                      onPatch({
                        contextPolicyPreset: "custom",
                        autoCompactionTelegram: value
                      })
                    }
                  />
                </div>
              </SubPanel>

              <SubPanel title="Budgets and thresholds">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-[11px] font-medium text-text">
                    <span className="block">Target context budget</span>
                    <Input
                      type="number"
                      min={1}
                      value={draft.targetContextBudget}
                      onValue={(value) =>
                        onPatch({
                          contextPolicyPreset: "custom",
                          targetContextBudget: value
                        })
                      }
                      placeholder="24000"
                      invalid={Boolean(validationErrors.targetContextBudget)}
                    />
                    <FieldError message={validationErrors.targetContextBudget} />
                  </label>
                  <label className="space-y-1 text-[11px] font-medium text-text">
                    <span className="block">Compaction trigger</span>
                    <Input
                      type="number"
                      min={1}
                      value={draft.compactionTriggerThreshold}
                      onValue={(value) =>
                        onPatch({
                          contextPolicyPreset: "custom",
                          compactionTriggerThreshold: value
                        })
                      }
                      placeholder="8000"
                      invalid={Boolean(validationErrors.compactionTriggerThreshold)}
                    />
                    <FieldError message={validationErrors.compactionTriggerThreshold} />
                  </label>
                  <label className="space-y-1 text-[11px] font-medium text-text">
                    <span className="block">Keep recent turns</span>
                    <Input
                      type="number"
                      min={1}
                      value={draft.keepRecentMinimum}
                      onValue={(value) =>
                        onPatch({
                          contextPolicyPreset: "custom",
                          keepRecentMinimum: value
                        })
                      }
                      placeholder="4"
                      invalid={Boolean(validationErrors.keepRecentMinimum)}
                    />
                    <FieldError message={validationErrors.keepRecentMinimum} />
                  </label>
                  <label className="space-y-1 text-[11px] font-medium text-text">
                    <span className="block">Knowledge budget</span>
                    <Input
                      type="number"
                      min={0}
                      value={draft.knowledgeHydrationBudget}
                      onValue={(value) =>
                        onPatch({
                          contextPolicyPreset: "custom",
                          knowledgeHydrationBudget: value
                        })
                      }
                      placeholder="2400"
                      invalid={Boolean(validationErrors.knowledgeHydrationBudget)}
                    />
                    <FieldError message={validationErrors.knowledgeHydrationBudget} />
                  </label>
                  <label className="space-y-1 text-[11px] font-medium text-text sm:col-span-2">
                    <span className="block">Shared summary budget</span>
                    <Input
                      type="number"
                      min={1}
                      value={draft.sharedCompactionSummaryBudgetTokens}
                      onValue={(value) =>
                        onPatch({
                          contextPolicyPreset: "custom",
                          sharedCompactionSummaryBudgetTokens: value
                        })
                      }
                      placeholder={String(
                        deriveSharedCompactionSummaryBudgetTokens(
                          resolveDraftTargetContextBudget(draft)
                        )
                      )}
                      invalid={Boolean(validationErrors.sharedCompactionSummaryBudgetTokens)}
                    />
                    <FieldError message={validationErrors.sharedCompactionSummaryBudgetTokens} />
                    <HelpText>
                      Leave blank for auto (
                      {String(
                        deriveSharedCompactionSummaryBudgetTokens(
                          resolveDraftTargetContextBudget(draft)
                        )
                      )}{" "}
                      tokens, ~
                      {String(
                        deriveSharedCompactionSummaryBudgetTokens(
                          resolveDraftTargetContextBudget(draft)
                        ) * APPROX_SUMMARY_CHARS_PER_TOKEN
                      )}{" "}
                      chars).
                    </HelpText>
                  </label>
                </div>
                <HelpText className="mt-2">
                  `Target context budget` is the plan&apos;s target message budget. `Compaction
                  trigger` defines when runtime should start compressing older context. `Knowledge
                  budget` reserves room for durable memory and future retrieval inserts.
                </HelpText>
              </SubPanel>
            </div>
          </div>
        </Sec>
      </div>

      {/* row 6: tool activations */}
      <Sec label="Tool activations">
        <ToolActivationsEdit
          activations={editableActivations}
          onUpdate={(updated) => onPatch({ toolActivations: updated })}
          videoGenerateModelKey={draft.videoGenerateModelKey}
          onVideoGenerateModelKeyChange={(videoGenerateModelKey) =>
            onPatch({ videoGenerateModelKey })
          }
        />
        <HelpText className="mt-2">
          Only plan-managed tools are editable here. Platform-managed and internal tools stay
          read-only in summaries. `Limit/d` is a per-plan daily cap; leave it blank to inherit the
          default runtime behavior.
        </HelpText>
      </Sec>
    </div>
  );
}

/* ─── Compact read-only plan card ─── */

function PlanCardReadOnly({
  plan,
  onEdit,
  onDelete,
  disabled,
  deleting
}: {
  plan: AdminPlanState;
  onEdit: () => void;
  onDelete: (() => void) | null;
  disabled: boolean;
  deleting: boolean;
}) {
  const e = plan.entitlements;
  const [expanded, setExpanded] = useState(false);
  const { planManaged, platformManaged, hiddenInternal } = splitToolActivationsByPolicy(
    plan.toolActivations ?? []
  );

  const channels = [
    e.channelsAndSurfaces.webChat && "Web",
    e.channelsAndSurfaces.telegram && "TG",
    e.channelsAndSurfaces.whatsapp && "WA",
    e.channelsAndSurfaces.max && "Max"
  ].filter(Boolean);

  const toolClasses = [
    e.toolClasses.costDrivingTools && "Cost",
    e.toolClasses.utilityTools && "Util",
    e.toolClasses.costDrivingQuotaGoverned && "CostQ",
    e.toolClasses.utilityQuotaGoverned && "UtilQ"
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border bg-surface-raised">
      {/* header line */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-text-muted hover:text-text"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="text-xs font-semibold text-text">{plan.displayName}</span>
        <span className="font-mono text-[10px] text-text-muted">{plan.code}</span>
        <Pill variant={plan.status === "active" ? "default" : "dim"}>{plan.status}</Pill>
        {plan.defaultOnRegistration && <Pill variant="green">default</Pill>}
        {plan.trialEnabled && <Pill variant="amber">trial {plan.trialDurationDays}d</Pill>}
        <span className="flex-1" />
        <span className="text-[10px] text-text-subtle">
          {new Date(plan.updatedAt).toLocaleDateString()}
        </span>
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <Pencil className="h-2.5 w-2.5" /> Edit
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled || deleting}
            className="ml-1 inline-flex items-center gap-0.5 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/15 disabled:opacity-40"
          >
            {deleting ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Trash2 className="h-2.5 w-2.5" />
            )}
            Delete
          </button>
        ) : null}
      </div>

      {/* collapsed summary line */}
      {!expanded && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-border/50 px-3 py-1.5 text-[10px]">
          <KV label="Channels">{channels.join(", ")}</KV>
          <KV label="Tools">{toolClasses.join(", ")}</KV>
          <KV label="Context">{plan.contextPolicy.preset}</KV>
          <span className="text-text-subtle">|</span>
          <ToolActivationsInline activations={[...planManaged, ...platformManaged]} />
        </div>
      )}

      {/* expanded details */}
      {expanded && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <KV label="Description">{plan.description ?? "—"}</KV>
            {plan.metadata.commercialTag && <KV label="Tag">{plan.metadata.commercialTag}</KV>}
            {plan.metadata.notes && <KV label="Notes">{plan.metadata.notes}</KV>}
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 rounded border border-border bg-surface px-3 py-1.5">
            <Sec label="Tool classes">
              <div className="flex flex-wrap gap-1">
                {[
                  { l: "Cost-driving", on: e.toolClasses.costDrivingTools },
                  { l: "Utility", on: e.toolClasses.utilityTools },
                  { l: "Cost quota", on: e.toolClasses.costDrivingQuotaGoverned },
                  { l: "Util quota", on: e.toolClasses.utilityQuotaGoverned }
                ].map((c) => (
                  <Pill key={c.l} variant={c.on ? "default" : "dim"}>
                    {c.l}
                  </Pill>
                ))}
              </div>
            </Sec>
            <Sec label="Channels">
              <div className="flex flex-wrap gap-1">
                {[
                  { l: "Web", on: e.channelsAndSurfaces.webChat },
                  { l: "TG", on: e.channelsAndSurfaces.telegram },
                  { l: "WA", on: e.channelsAndSurfaces.whatsapp },
                  { l: "Max", on: e.channelsAndSurfaces.max }
                ].map((c) => (
                  <Pill key={c.l} variant={c.on ? "default" : "dim"}>
                    {c.l}
                  </Pill>
                ))}
              </div>
            </Sec>
            <div className="space-y-1">
              <Sec label="Quota limits">
                <div className="space-y-0.5 text-[10px] text-text-subtle">
                  <div>Token budget: {plan.quotaLimits?.tokenBudgetLimit ?? "default"}</div>
                  <div>
                    Media upload budget:{" "}
                    {plan.quotaLimits?.mediaStorageBytesLimit != null
                      ? `${String(Math.round(plan.quotaLimits.mediaStorageBytesLimit / 1048576))} MB`
                      : "default"}
                  </div>
                  <div>
                    Knowledge storage:{" "}
                    {plan.quotaLimits?.knowledgeStorageBytesLimit != null
                      ? `${String(Math.round(plan.quotaLimits.knowledgeStorageBytesLimit / 1048576))} MB`
                      : "default"}
                  </div>
                </div>
              </Sec>
              <Sec label="AI model slots">
                <div className="space-y-0.5 text-[10px] text-text-subtle">
                  <div>Normal: {plan.primaryModelKey ?? "platform default"}</div>
                  <div>Premium: {plan.premiumModelKey ?? "normal reply"}</div>
                  <div>Reasoning: {plan.reasoningModelKey ?? "premium reply"}</div>
                  <div>Retrieval: {plan.retrievalModelKey ?? "system/runtime default"}</div>
                  <div>
                    Embedding: {plan.embeddingModelKey ?? "retrieval helper / runtime default"}
                  </div>
                </div>
              </Sec>
              <Sec label="Retrieval policy">
                <div className="space-y-0.5 text-[10px] text-text-subtle">
                  <div>
                    Results: {plan.retrievalPolicy.defaultMaxResults} /{" "}
                    {plan.retrievalPolicy.maxMaxResults}
                  </div>
                  <div>
                    Candidate pools: {plan.retrievalPolicy.lexicalCandidateLimit} lexical,{" "}
                    {plan.retrievalPolicy.vectorCandidateLimit} vector
                  </div>
                  <div>
                    Fetch radius: {plan.retrievalPolicy.knowledgeFetchWindowRadius} doc,{" "}
                    {plan.retrievalPolicy.chatFetchWindowRadius} chat
                  </div>
                  <div>Fetch max chars: {plan.retrievalPolicy.fetchMaxChars}</div>
                  <div>
                    Helper: {plan.retrievalPolicy.helperEnabled ? "on" : "off"} /{" "}
                    {plan.retrievalPolicy.helperCandidateLimit} candidates /{" "}
                    {plan.retrievalPolicy.helperMaxOutputTokens} tokens
                  </div>
                  <div>
                    Embedding search: {plan.retrievalPolicy.embeddingSearchEnabled ? "on" : "off"}
                  </div>
                </div>
              </Sec>
              <Sec label="Video model">
                <span className="text-[10px] text-text-subtle">
                  {plan.videoGenerateModelKey ?? "sora-2 (default)"}
                </span>
              </Sec>
              <Sec label="Context policy">
                <div className="space-y-0.5 text-[10px] text-text-subtle">
                  <div>Preset: {plan.contextPolicy.preset}</div>
                  <div>Budget: {plan.contextPolicy.targetContextBudget}</div>
                  <div>Trigger: {plan.contextPolicy.compactionTriggerThreshold}</div>
                  <div>Keep recent: {plan.contextPolicy.keepRecentMinimum}</div>
                  <div>Knowledge: {plan.contextPolicy.knowledgeHydrationBudget}</div>
                  <div>
                    Shared summary: {describeContextPolicySummaryBudget(plan.contextPolicy)}
                  </div>
                  <div>
                    Auto web / TG: {plan.contextPolicy.autoCompactionWeb ? "on" : "off"} /{" "}
                    {plan.contextPolicy.autoCompactionTelegram ? "on" : "off"}
                  </div>
                </div>
              </Sec>
            </div>
          </div>
          <ToolActivationReadOnlyGroup
            title="Plan-managed tools"
            emptyLabel="No editable tools configured."
            activations={planManaged}
          />
          <ToolActivationReadOnlyGroup
            title="Platform-managed tools"
            emptyLabel="No platform-managed tools."
            activations={platformManaged}
            showLimits={false}
          />
          <ToolActivationReadOnlyGroup
            title="Hidden internal tools"
            emptyLabel="No hidden internal tools."
            activations={hiddenInternal}
            showLimits={false}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Page ─── */

export default function AdminPlansPage() {
  const { getToken } = useAuth();
  const [plans, setPlans] = useState<AdminPlanState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(
    null
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<PlanDraft>(() => emptyDraft());
  const [createValidationErrors, setCreateValidationErrors] = useState<DraftValidationErrors>({});
  const [createCode, setCreateCode] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PlanDraft | null>(null);
  const [editValidationErrors, setEditValidationErrors] = useState<DraftValidationErrors>({});
  const [availableModelKeys, setAvailableModelKeys] = useState<
    { provider: string; model: string }[]
  >([]);
  const [reapplying, setReapplying] = useState(false);
  const [reapplySummary, setReapplySummary] = useState<ForceReapplyAllSummary | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      setFeedback({ kind: "error", message: "Sign in required." });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const [plansData, runtimeData] = await Promise.all([
        getAdminPlans(token),
        getAdminRuntimeProviderSettings(token).catch(() => null)
      ]);
      setPlans(plansData);
      if (runtimeData?.availableModelsByProvider) {
        const keys: { provider: string; model: string }[] = [];
        for (const [provider, models] of Object.entries(
          runtimeData.availableModelsByProvider as unknown as Record<string, string[]>
        )) {
          for (const model of models) {
            keys.push({ provider, model });
          }
        }
        setAvailableModelKeys(keys);
      }
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load plans."
      });
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const patchCreate = useCallback((p: Partial<PlanDraft>) => {
    setCreateDraft((d) => ({ ...d, ...p }));
    setCreateValidationErrors((current) => clearValidationErrors(current, p));
  }, []);
  const patchEdit = useCallback((p: Partial<PlanDraft>) => {
    setEditDraft((d) => (d ? { ...d, ...p } : d));
    setEditValidationErrors((current) => clearValidationErrors(current, p));
  }, []);

  const handleForceReapplyAll = useCallback(async () => {
    if (
      !window.confirm(
        "This will re-materialize ALL assistants immediately. This may take a while. Continue?"
      )
    )
      return;
    const token = await getToken();
    if (!token) return;
    setReapplying(true);
    setReapplySummary(null);
    setFeedback(null);
    try {
      const summary = await postAdminForceReapplyAll(token);
      setReapplySummary(summary);
      setFeedback({
        kind: "success",
        message: `Force reapply complete: ${String(summary.succeeded)} succeeded, ${String(summary.failed)} failed, ${String(summary.skipped)} skipped.`
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Force reapply failed."
      });
    }
    setReapplying(false);
  }, [getToken]);

  const openCreate = useCallback(() => {
    setEditingCode(null);
    setEditDraft(null);
    const draft = emptyDraft();
    const templatePlan = plans.find(
      (p) => (p.toolActivations ?? []).filter((ta) => ta.visibleInPlanEditor).length > 0
    );
    if (templatePlan) {
      draft.toolActivations = (templatePlan.toolActivations ?? [])
        .filter((ta) => ta.visibleInPlanEditor)
        .map((ta) => ({
          toolCode: ta.toolCode,
          displayName: ta.displayName,
          toolClass: ta.toolClass,
          policyClass: ta.policyClass,
          active: false,
          dailyCallLimit: null
        }));
    }
    setCreateDraft(draft);
    setCreateValidationErrors({});
    setCreateCode("");
    setCreateOpen((o) => !o);
    setFeedback(null);
  }, [plans]);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateDraft(emptyDraft());
    setCreateValidationErrors({});
    setCreateCode("");
  }, []);

  const startEdit = useCallback((plan: AdminPlanState) => {
    setCreateOpen(false);
    setEditingCode(plan.code);
    setEditDraft(planToDraft(plan));
    setEditValidationErrors({});
    setFeedback(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCode(null);
    setEditDraft(null);
    setEditValidationErrors({});
  }, []);

  async function onCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const token = await getToken();
    if (!token) return;
    if (!createDraft.displayName.trim()) {
      setFeedback({ kind: "error", message: "Display name is required." });
      return;
    }
    if (!createCode.trim()) {
      setFeedback({ kind: "error", message: "Plan code is required." });
      return;
    }
    const errors = validatePlanDraft(createDraft);
    if (Object.keys(errors).length > 0) {
      setCreateValidationErrors(errors);
      setFeedback({ kind: "error", message: "Fix the highlighted plan values before saving." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const body: AdminPlanCreateRequest = {
        code: createCode.trim(),
        ...draftToPayload(createDraft)
      };
      await postAdminPlanCreate(token, body);
      setFeedback({ kind: "success", message: "Plan created." });
      closeCreate();
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Create failed."
      });
    }
    setSaving(false);
  }

  async function onEditSubmit(e: FormEvent) {
    e.preventDefault();
    const token = await getToken();
    if (!token || !editingCode || !editDraft) return;
    if (!editDraft.displayName.trim()) {
      setFeedback({ kind: "error", message: "Display name is required." });
      return;
    }
    const errors = validatePlanDraft(editDraft);
    if (Object.keys(errors).length > 0) {
      setEditValidationErrors(errors);
      setFeedback({ kind: "error", message: "Fix the highlighted plan values before saving." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await patchAdminPlan(token, editingCode, draftToPayload(editDraft));
      setFeedback({ kind: "success", message: "Plan updated." });
      cancelEdit();
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Update failed."
      });
    }
    setSaving(false);
  }

  async function onDeletePlan(plan: AdminPlanState) {
    const token = await getToken();
    if (!token) return;
    const confirmed = window.confirm(
      `Delete plan "${plan.displayName}" (${plan.code})?\n\nThis only succeeds when no users, subscriptions, or assistant plan bindings still reference it.`
    );
    if (!confirmed) {
      return;
    }
    setDeletingCode(plan.code);
    setFeedback(null);
    try {
      await deleteAdminPlan(token, plan.code);
      if (editingCode === plan.code) {
        cancelEdit();
      }
      setFeedback({ kind: "success", message: `Plan ${plan.code} deleted.` });
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Delete failed."
      });
    }
    setDeletingCode(null);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="text-text">
      {/* header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CreditCard className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold text-text">Plans</h1>
          <span className="text-[10px] text-text-muted">({plans.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleForceReapplyAll()}
            disabled={reapplying || saving}
            className="inline-flex items-center gap-1 rounded border border-orange-400/40 bg-orange-500/10 px-2 py-1 text-[10px] font-semibold text-orange-600 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
          >
            {reapplying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Force reapply all
          </button>
          <button
            type="button"
            onClick={openCreate}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition-colors",
              createOpen
                ? "border-border bg-surface-hover text-text"
                : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
            )}
          >
            {createOpen ? (
              <>
                <X className="h-3 w-3" /> Close
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" /> New plan
              </>
            )}
          </button>
        </div>
      </div>

      {/* feedback */}
      {feedback && (
        <div
          className={cn(
            "mb-3 flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px]",
            feedback.kind === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      {reapplySummary && (
        <div className="mb-3 rounded border border-orange-400/30 bg-orange-500/10 p-2.5 text-[11px] text-orange-300">
          <span className="font-semibold">Reapply summary:</span> {reapplySummary.totalAssistants}{" "}
          total, {reapplySummary.withPublishedVersion} with version, {reapplySummary.succeeded}{" "}
          succeeded, {reapplySummary.degraded} degraded, {reapplySummary.failed} failed,{" "}
          {reapplySummary.skipped} skipped
        </div>
      )}

      {/* create form */}
      {createOpen && (
        <form
          onSubmit={(ev) => void onCreateSubmit(ev)}
          className="mb-4 rounded-lg border border-accent/20 bg-surface-raised p-3"
        >
          <h2 className="mb-2 text-xs font-semibold text-text">New plan</h2>
          <PlanForm
            draft={createDraft}
            onPatch={patchCreate}
            validationErrors={createValidationErrors}
            showCode
            code={createCode}
            onCodeChange={setCreateCode}
            availableModelKeys={availableModelKeys}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={saving || isDraftTrialFieldsInvalid(createDraft)}
              className="rounded bg-accent px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
            >
              {saving ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Save"}
            </button>
            <button
              type="button"
              onClick={closeCreate}
              disabled={saving}
              className="rounded border border-border px-3 py-1 text-[11px] text-text-muted hover:text-text disabled:opacity-40"
            >
              Cancel
            </button>
            {isDraftTrialFieldsInvalid(createDraft) && (
              <span className="self-center text-[10px] font-medium text-red-500/80">
                Trial plan needs trialDurationDays &gt; 0
              </span>
            )}
          </div>
        </form>
      )}

      {/* plan list */}
      {plans.length === 0 ? (
        <p className="text-xs text-text-subtle">No plans configured.</p>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => {
            const isEditing = editingCode === plan.code && editDraft !== null;
            if (isEditing && editDraft) {
              return (
                <form
                  key={plan.code}
                  onSubmit={(ev) => void onEditSubmit(ev)}
                  className="rounded-lg border border-accent/20 bg-surface-raised p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold text-text">
                      Editing <span className="font-mono text-text-muted">{plan.code}</span>
                    </h2>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="text-text-muted hover:text-text"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <PlanForm
                    draft={editDraft}
                    onPatch={patchEdit}
                    validationErrors={editValidationErrors}
                    showCode={false}
                    code=""
                    onCodeChange={() => {}}
                    availableModelKeys={availableModelKeys}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="submit"
                      disabled={saving || isDraftTrialFieldsInvalid(editDraft)}
                      className="rounded bg-accent px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
                    >
                      {saving ? (
                        <Loader2 className="inline h-3 w-3 animate-spin" />
                      ) : (
                        "Save changes"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="rounded border border-border px-3 py-1 text-[11px] text-text-muted hover:text-text disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    {isDraftTrialFieldsInvalid(editDraft) && (
                      <span className="self-center text-[10px] font-medium text-red-500/80">
                        Trial plan needs trialDurationDays &gt; 0
                      </span>
                    )}
                  </div>
                </form>
              );
            }
            return (
              <PlanCardReadOnly
                key={plan.code}
                plan={plan}
                onEdit={() => startEdit(plan)}
                onDelete={plan.defaultOnRegistration ? null : () => void onDeletePlan(plan)}
                disabled={saving || createOpen || editingCode !== null}
                deleting={deletingCode === plan.code}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
