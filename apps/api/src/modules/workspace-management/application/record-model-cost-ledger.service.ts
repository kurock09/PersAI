import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  RUNTIME_BILLING_FACT_CAPABILITIES,
  type PersaiRuntimeModelRole,
  type RuntimeBillingFactCapability,
  type RuntimeBillingFactMetering,
  type RuntimeBillingFacts,
  type RuntimeUsageSnapshot,
  type RuntimeUsageAccounting,
  type RuntimeUsageAccountingEntry,
  type TextGenerationUsageAccountingEnvelope,
  type TextGenerationUsageAccountingV2
} from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import { ResolveToolPathPricingCatalogService } from "./resolve-tool-path-pricing-catalog.service";
import {
  findToolPathPricingRowForTimestamp,
  isToolPathCode,
  resolveToolPathKeyFromBillingFacts,
  resolveToolPathLedgerPurpose,
  toToolPathPricingProfileForLedger,
  type ToolPathLedgerPurpose
} from "./tool-path-pricing-catalog";
import {
  findRuntimeProviderCatalogProfileForTimestamp,
  type ManagedRuntimeProvider,
  type RuntimeProviderBillingMode,
  type RuntimeProviderFixedOperationModelProfile,
  type RuntimeProviderModelProfile,
  type RuntimeProviderTextCharsMeteredModelProfile,
  type RuntimeProviderTimeMeteredModelProfile,
  type RuntimeProviderTokenMeteredModelProfile,
  type RuntimeProviderTieredOperationModelProfile
} from "./runtime-provider-profile";
import { decodeTextGenerationUsageForApi } from "./text-generation-usage-accounting";

export type ModelCostLedgerSurface = "web" | "telegram" | "background";
export type ModelCostLedgerPurpose =
  | "chat_main_reply"
  | "router"
  | "background_task"
  | "retrieval_helper"
  | "tool_helper"
  | "chat_helper"
  | "document_generation"
  | "image_generation"
  | "image_edit"
  | "video_generation"
  | "stt"
  | "tts"
  | "ocr_or_document_parsing"
  | "knowledge_embedding"
  | ToolPathLedgerPurpose;

type RecordModelCostLedgerInput = {
  workspaceId: string | null;
  assistantId: string | null;
  userId: string | null;
  surface: ModelCostLedgerSurface;
  purpose: ModelCostLedgerPurpose;
  source: string;
  usageAccounting?: RuntimeUsageAccounting;
  textUsageAccounting?: TextGenerationUsageAccountingEnvelope;
  occurredAt: string;
  sourceEventId?: string | null;
  requestCorrelationId?: string | null;
};

type TokenUsageFacts = {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number | null;
  billableInputTokens: number;
};

type TokenPriceCatalogSnapshot = {
  provider: ManagedRuntimeProvider;
  model: string;
  capability: "chat";
  billingMode: "token_metered";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  currency: string;
  tokenPricing: {
    inputPer1M: number;
    cacheCreationInputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
  };
};

const CHAT_MAIN_REPLY_MODEL_ROLES = new Set<PersaiRuntimeModelRole>([
  "normal_reply",
  "premium_reply",
  "reasoning"
]);

const CHAT_MAIN_REPLY_STEP_TYPES = new Set(["main_turn", "tool_loop_followup"]);
const ROUTER_STEP_TYPES = new Set(["turn_routing", "skill_state_routing"]);

function normalizeManagedProvider(value: string | null): ManagedRuntimeProvider | null {
  return value === "openai" || value === "anthropic" || value === "deepseek" ? value : null;
}

function normalizeModelKey(value: string | null): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNonNegativeInteger(value: number | null | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function isChatMainReplyUsageEntry(entry: RuntimeUsageAccountingEntry): boolean {
  return (
    entry.modelRole !== null &&
    CHAT_MAIN_REPLY_MODEL_ROLES.has(entry.modelRole) &&
    CHAT_MAIN_REPLY_STEP_TYPES.has(entry.stepType)
  );
}

function isRouterUsageEntry(entry: RuntimeUsageAccountingEntry): boolean {
  return entry.modelRole === "system_tool" && ROUTER_STEP_TYPES.has(entry.stepType);
}

function resolveLedgerPurpose(
  entry: RuntimeUsageAccountingEntry,
  defaultPurpose: ModelCostLedgerPurpose
): ModelCostLedgerPurpose | null {
  if (isRouterUsageEntry(entry)) {
    return "router";
  }
  if (isChatMainReplyUsageEntry(entry)) {
    return defaultPurpose;
  }
  return null;
}

function extractTokenUsageFacts(entry: {
  inputTokens: number | null | undefined;
  cacheCreationInputTokens?: number | null | undefined;
  cachedInputTokens?: number | null | undefined;
  outputTokens: number | null | undefined;
  totalTokens: number | null | undefined;
}): TokenUsageFacts {
  const inputTokens = asNonNegativeInteger(entry.inputTokens);
  const cacheCreationInputTokens = asNonNegativeInteger(entry.cacheCreationInputTokens);
  const cachedInputTokens = asNonNegativeInteger(entry.cachedInputTokens);
  const outputTokens = asNonNegativeInteger(entry.outputTokens);
  const totalTokens =
    typeof entry.totalTokens === "number" &&
    Number.isInteger(entry.totalTokens) &&
    entry.totalTokens >= 0
      ? entry.totalTokens
      : null;
  return {
    inputTokens,
    cacheCreationInputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    billableInputTokens: inputTokens
  };
}

function resolveCacheCreationInputPricePer1M(
  profile: RuntimeProviderTokenMeteredModelProfile
): number {
  const rawConfigured = profile.providerPriceMetadata.tokenPricing.cacheCreationInputPer1M;
  return typeof rawConfigured === "number" && Number.isFinite(rawConfigured) && rawConfigured >= 0
    ? rawConfigured
    : 0;
}

function buildPriceCatalogSnapshot(input: {
  provider: ManagedRuntimeProvider;
  profile: RuntimeProviderTokenMeteredModelProfile;
}): TokenPriceCatalogSnapshot {
  return {
    provider: input.provider,
    model: input.profile.model,
    capability: "chat",
    billingMode: "token_metered",
    effectiveFrom: input.profile.effectiveFrom,
    effectiveTo: input.profile.effectiveTo,
    currency: input.profile.providerPriceMetadata.currency,
    tokenPricing: {
      inputPer1M: input.profile.providerPriceMetadata.tokenPricing.inputPer1M,
      cacheCreationInputPer1M: resolveCacheCreationInputPricePer1M(input.profile),
      cachedInputPer1M: input.profile.providerPriceMetadata.tokenPricing.cachedInputPer1M,
      outputPer1M: input.profile.providerPriceMetadata.tokenPricing.outputPer1M
    }
  };
}

function buildPriceCatalogVersion(snapshot: TokenPriceCatalogSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function buildBillingFactsPriceCatalogVersion(snapshot: BillingFactsPriceCatalogSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function buildDeterministicLedgerEventId(input: {
  workspaceId: string | null;
  assistantId: string | null;
  userId: string | null;
  surface: ModelCostLedgerSurface;
  purpose: ModelCostLedgerPurpose;
  source: string;
  sourceEventId: string | null;
  requestCorrelationId: string | null;
  entryOrdinal: number;
  provider: ManagedRuntimeProvider;
  model: string;
  stepType: string;
  modelRole: PersaiRuntimeModelRole | null;
  toolCode: string | null;
}): string {
  const hex = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function calculateTokenMeteredCostMicros(input: {
  usage: TokenUsageFacts;
  profile: RuntimeProviderTokenMeteredModelProfile;
}): bigint {
  const pricing = input.profile.providerPriceMetadata.tokenPricing;
  const cacheCreationInputPer1M = resolveCacheCreationInputPricePer1M(input.profile);
  const totalMicros = Math.round(
    input.usage.billableInputTokens * pricing.inputPer1M +
      input.usage.cacheCreationInputTokens * cacheCreationInputPer1M +
      input.usage.cachedInputTokens * pricing.cachedInputPer1M +
      input.usage.outputTokens * pricing.outputPer1M
  );
  return BigInt(Math.max(0, totalMicros));
}

type BillingFactsPriceCatalogSnapshot = {
  provider: string;
  model: string;
  capability: RuntimeBillingFactCapability;
  billingMode: RuntimeProviderBillingMode;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  currency: string;
  providerPriceMetadata: RuntimeProviderModelProfile["providerPriceMetadata"];
};

function isRuntimeBillingFactCapability(value: string): value is RuntimeBillingFactCapability {
  return (RUNTIME_BILLING_FACT_CAPABILITIES as readonly string[]).includes(value);
}

function normalizeRuntimeBillingFacts(value: unknown): RuntimeBillingFacts | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const providerKey = typeof row.providerKey === "string" ? row.providerKey.trim() : "";
  const modelKey = typeof row.modelKey === "string" ? row.modelKey.trim() : "";
  const capability =
    typeof row.capability === "string" && isRuntimeBillingFactCapability(row.capability)
      ? row.capability
      : null;
  const occurredAt = typeof row.occurredAt === "string" ? row.occurredAt.trim() : "";
  const metering = normalizeRuntimeBillingFactMetering(row.metering);
  if (
    providerKey.length === 0 ||
    modelKey.length === 0 ||
    capability === null ||
    metering === null
  ) {
    return null;
  }
  if (occurredAt.length === 0 || Number.isNaN(new Date(occurredAt).getTime())) {
    return null;
  }
  return {
    providerKey,
    modelKey,
    capability,
    occurredAt,
    metering
  };
}

function normalizeRuntimeBillingFactMetering(value: unknown): RuntimeBillingFactMetering | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (row.meteringKind === "time_metered") {
    const durationMs =
      typeof row.durationMs === "number" && Number.isFinite(row.durationMs) && row.durationMs >= 0
        ? row.durationMs
        : null;
    const durationSeconds =
      typeof row.durationSeconds === "number" &&
      Number.isFinite(row.durationSeconds) &&
      row.durationSeconds >= 0
        ? row.durationSeconds
        : durationMs === null
          ? null
          : Number((durationMs / 1000).toFixed(3));
    if (durationMs === null || durationSeconds === null) {
      return null;
    }
    return { meteringKind: "time_metered", durationMs, durationSeconds };
  }
  if (row.meteringKind === "text_chars_metered") {
    const textChars =
      typeof row.textChars === "number" && Number.isFinite(row.textChars) && row.textChars >= 0
        ? Math.floor(row.textChars)
        : null;
    if (textChars === null) {
      return null;
    }
    return { meteringKind: "text_chars_metered", textChars };
  }
  if (row.meteringKind === "token_metered") {
    const dimensions =
      row.dimensions === null || row.dimensions === undefined
        ? null
        : typeof row.dimensions === "object" && !Array.isArray(row.dimensions)
          ? (row.dimensions as Record<string, string | number | boolean | null>)
          : null;
    return {
      meteringKind: "token_metered",
      inputTokens:
        typeof row.inputTokens === "number" && Number.isFinite(row.inputTokens)
          ? row.inputTokens
          : null,
      cacheCreationInputTokens:
        typeof row.cacheCreationInputTokens === "number" &&
        Number.isFinite(row.cacheCreationInputTokens)
          ? row.cacheCreationInputTokens
          : null,
      cachedInputTokens:
        typeof row.cachedInputTokens === "number" && Number.isFinite(row.cachedInputTokens)
          ? row.cachedInputTokens
          : null,
      outputTokens:
        typeof row.outputTokens === "number" && Number.isFinite(row.outputTokens)
          ? row.outputTokens
          : null,
      totalTokens:
        typeof row.totalTokens === "number" && Number.isFinite(row.totalTokens)
          ? row.totalTokens
          : null,
      dimensions
    };
  }
  if (row.meteringKind === "operation_metered") {
    const operationCount =
      typeof row.operationCount === "number" &&
      Number.isFinite(row.operationCount) &&
      row.operationCount > 0
        ? Math.floor(row.operationCount)
        : null;
    if (operationCount === null) {
      return null;
    }
    const dimensions =
      row.dimensions === null || row.dimensions === undefined
        ? null
        : typeof row.dimensions === "object" && !Array.isArray(row.dimensions)
          ? (row.dimensions as Record<string, string | number | boolean | null>)
          : null;
    return { meteringKind: "operation_metered", operationCount, dimensions };
  }
  return null;
}

function resolvePurposeFromBillingFacts(facts: RuntimeBillingFacts): ModelCostLedgerPurpose | null {
  switch (facts.capability) {
    case "image": {
      const operation =
        facts.metering.meteringKind === "token_metered" ||
        facts.metering.meteringKind === "operation_metered"
          ? facts.metering.dimensions?.operation
          : null;
      return operation === "edit" ? "image_edit" : "image_generation";
    }
    case "video":
      return "video_generation";
    case "speech_to_text":
      return "stt";
    case "text_to_speech":
      return "tts";
    case "ocr_or_document_parsing":
      return "ocr_or_document_parsing";
    case "web_search":
    case "web_fetch":
    case "browser":
    case "document_render":
      return resolveToolPathLedgerPurpose(facts.capability);
    default:
      return null;
  }
}

function toolPathProfileSupportsBillingFacts(
  profile: ReturnType<typeof toToolPathPricingProfileForLedger>,
  facts: RuntimeBillingFacts
): boolean {
  switch (facts.metering.meteringKind) {
    case "operation_metered":
      return (
        profile.billingMode === "fixed_operation" || profile.billingMode === "tiered_operation"
      );
    case "time_metered":
      return profile.billingMode === "time_metered";
    default:
      return false;
  }
}

function buildToolPathPriceCatalogSnapshot(input: {
  facts: RuntimeBillingFacts;
  row: ReturnType<typeof findToolPathPricingRowForTimestamp>;
}): BillingFactsPriceCatalogSnapshot | null {
  if (input.row === null) {
    return null;
  }
  const profile = toToolPathPricingProfileForLedger(input.row);
  return {
    provider: input.facts.providerKey,
    model: input.row.pathKey,
    capability: input.facts.capability,
    billingMode: profile.billingMode,
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    currency: profile.providerPriceMetadata.currency,
    providerPriceMetadata: profile.providerPriceMetadata
  };
}

function profileSupportsBillingFacts(
  profile: RuntimeProviderModelProfile,
  facts: RuntimeBillingFacts
): boolean {
  if (isToolPathCode(facts.capability)) {
    return false;
  }
  if (!profile.capabilities.includes(facts.capability)) {
    return false;
  }
  switch (facts.metering.meteringKind) {
    case "token_metered":
      return profile.billingMode === "token_metered";
    case "time_metered":
      return profile.billingMode === "time_metered";
    case "text_chars_metered":
      return profile.billingMode === "text_chars_metered";
    case "operation_metered":
      return (
        profile.billingMode === "fixed_operation" || profile.billingMode === "tiered_operation"
      );
    default:
      return false;
  }
}

function buildBillingFactsPriceCatalogSnapshot(input: {
  facts: RuntimeBillingFacts;
  profile: RuntimeProviderModelProfile;
}): BillingFactsPriceCatalogSnapshot {
  return {
    provider: input.facts.providerKey,
    model: input.profile.model,
    capability: input.facts.capability,
    billingMode: input.profile.billingMode,
    effectiveFrom: input.profile.effectiveFrom,
    effectiveTo: input.profile.effectiveTo,
    currency: input.profile.providerPriceMetadata.currency,
    providerPriceMetadata: input.profile.providerPriceMetadata
  };
}

/**
 * ADR-108 — video VC settle correctness (2026-06-04): model-catalog
 * `time_metered` rows (Admin > Runtime, e.g. Kling `pricePerUnit: 0.14`
 * = $0.14/sec) store **plain USD per unit**. Tool-path catalog rows
 * (`tool_path_pricing_catalog`, Tavily/Browserless/etc.) keep the legacy
 * convention where `pricePerUnit` / `pricePerOperation` are already in
 * **USD micros** — do not multiply those paths by `MICROS_PER_USD`.
 */
const MICROS_PER_USD = 1_000_000;

type TimeMeteredPriceConvention = "model_catalog_plain_usd" | "tool_path_usd_micros";

function calculateTimeMeteredCostMicros(
  metering: Extract<RuntimeBillingFactMetering, { meteringKind: "time_metered" }>,
  profile: RuntimeProviderTimeMeteredModelProfile,
  convention: TimeMeteredPriceConvention
): bigint {
  const pricing = profile.providerPriceMetadata.timePricing;
  const billableUnits =
    pricing.unit === "minute" ? metering.durationSeconds / 60 : metering.durationSeconds;
  const usdScale = convention === "model_catalog_plain_usd" ? MICROS_PER_USD : 1;
  return BigInt(Math.max(0, Math.round(billableUnits * pricing.pricePerUnit * usdScale)));
}

function calculateTextCharsMeteredCostMicros(
  metering: Extract<RuntimeBillingFactMetering, { meteringKind: "text_chars_metered" }>,
  profile: RuntimeProviderTextCharsMeteredModelProfile
): bigint {
  // Catalog stores `pricePer1MChars` as plain USD per 1M chars (e.g. 15 = $15/1M).
  // `chars * (USD / 1_000_000 chars) * 1_000_000 micros/USD == chars * pricePer1MChars`.
  const pricePer1MChars = profile.providerPriceMetadata.textCharsPricing.pricePer1MChars;
  return BigInt(Math.max(0, Math.round(metering.textChars * pricePer1MChars)));
}

function calculateFixedOperationCostMicros(
  metering: Extract<RuntimeBillingFactMetering, { meteringKind: "operation_metered" }>,
  profile: RuntimeProviderFixedOperationModelProfile
): bigint {
  const pricePerOperation = profile.providerPriceMetadata.fixedOperationPricing.pricePerOperation;
  return BigInt(Math.max(0, Math.round(metering.operationCount * pricePerOperation)));
}

function resolveTieredOperationPrice(
  profile: RuntimeProviderTieredOperationModelProfile,
  dimensions: Record<string, string | number | boolean | null> | null | undefined
): number | null {
  const tiers = profile.providerPriceMetadata.tieredOperationPricing.tiers;
  if (tiers.length === 0) {
    return null;
  }
  if (dimensions !== null && dimensions !== undefined) {
    for (const tier of tiers) {
      if (tier.matchValue === null) {
        continue;
      }
      for (const value of Object.values(dimensions)) {
        if (value !== null && String(value) === tier.matchValue) {
          return tier.price;
        }
      }
    }
  }
  return tiers[0]?.price ?? null;
}

function calculateBillingFactsCostMicros(
  facts: RuntimeBillingFacts,
  profile: RuntimeProviderModelProfile,
  options?: { timeMeteredConvention?: TimeMeteredPriceConvention }
): bigint | null {
  const timeMeteredConvention = options?.timeMeteredConvention ?? "tool_path_usd_micros";
  switch (facts.metering.meteringKind) {
    case "token_metered":
      if (profile.billingMode !== "token_metered") {
        return null;
      }
      return calculateTokenMeteredCostMicros({
        usage: extractTokenUsageFacts(facts.metering),
        profile
      });
    case "time_metered":
      if (profile.billingMode !== "time_metered") {
        return null;
      }
      return calculateTimeMeteredCostMicros(facts.metering, profile, timeMeteredConvention);
    case "text_chars_metered":
      if (profile.billingMode !== "text_chars_metered") {
        return null;
      }
      return calculateTextCharsMeteredCostMicros(facts.metering, profile);
    case "operation_metered":
      if (profile.billingMode === "fixed_operation") {
        return calculateFixedOperationCostMicros(facts.metering, profile);
      }
      if (profile.billingMode === "tiered_operation") {
        const unitPrice = resolveTieredOperationPrice(profile, facts.metering.dimensions);
        if (unitPrice === null) {
          return null;
        }
        return BigInt(Math.max(0, Math.round(facts.metering.operationCount * unitPrice)));
      }
      return null;
    default:
      return null;
  }
}

function buildBillingFactsDeterministicLedgerEventId(input: {
  workspaceId: string;
  assistantId: string;
  userId: string;
  surface: ModelCostLedgerSurface;
  purpose: ModelCostLedgerPurpose;
  source: string;
  sourceEventId: string;
  provider: string;
  model: string;
  capability: RuntimeBillingFactCapability;
}): string {
  const hex = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

@Injectable()
export class RecordModelCostLedgerService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly resolveToolPathPricingCatalogService: ResolveToolPathPricingCatalogService
  ) {}

  async recordBackgroundTaskEvaluationEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    occurredAt: string;
    sourceEventId: string;
    requestCorrelationId?: string | null;
    usage: RuntimeUsageSnapshot | null;
  }): Promise<number> {
    return this.recordTokenMeteredUsageSnapshot({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: "background",
      purpose: "background_task",
      source: "background_task_evaluation",
      sourceEventId: input.sourceEventId,
      requestCorrelationId: input.requestCorrelationId ?? null,
      occurredAt: input.occurredAt,
      stepType: "background_task_evaluation",
      modelRole: "system_tool",
      usage: input.usage
    });
  }

  async recordRetrievalHelperEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface?: ModelCostLedgerSurface;
    occurredAt: string;
    sourceEventId: string;
    providerKey: string;
    modelKey: string;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens?: number | null;
  }): Promise<number> {
    return this.recordTokenMeteredUsageSnapshot({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: input.surface ?? "background",
      purpose: "retrieval_helper",
      source: "knowledge_retrieval_helper",
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
      stepType: "knowledge_retrieval_helper",
      modelRole: "system_tool",
      usage: {
        providerKey: input.providerKey,
        modelKey: input.modelKey,
        inputTokens: input.inputTokens,
        cachedInputTokens: 0,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens ?? null
      }
    });
  }

  async recordToolHelperEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface?: ModelCostLedgerSurface;
    occurredAt: string;
    sourceEventId: string;
    source: "upload_micro_description";
    usage: RuntimeUsageSnapshot | null;
  }): Promise<number> {
    return this.recordTokenMeteredUsageSnapshot({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: input.surface ?? "background",
      purpose: "tool_helper",
      source: input.source,
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
      stepType: input.source,
      modelRole: "system_tool",
      usage: input.usage
    });
  }

  async recordKnowledgeIndexingEmbeddingEvent(input: {
    workspaceId: string;
    assistantId: string | null;
    userId: string | null;
    occurredAt: string;
    sourceEventId: string;
    providerKey: string;
    modelKey: string;
    inputTokens: number;
    totalTokens: number | null;
  }): Promise<number> {
    if (input.userId === null) {
      return 0;
    }
    return this.recordTokenMeteredUsageSnapshot({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: "background",
      purpose: "knowledge_embedding",
      source: "knowledge_indexing_embedding",
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
      stepType: "knowledge_indexing_embedding",
      modelRole: "system_tool",
      usage: {
        providerKey: input.providerKey,
        modelKey: input.modelKey,
        inputTokens: input.inputTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: input.totalTokens
      }
    });
  }

  async recordCompletionFramingUsageEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface: ModelCostLedgerSurface;
    occurredAt: string;
    sourceEventId: string;
    source: "media_job_completion_framing" | "document_job_completion_framing";
    usage: RuntimeUsageSnapshot | null;
  }): Promise<number> {
    return this.recordTokenMeteredUsageSnapshot({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: input.surface,
      purpose: "chat_helper",
      source: input.source,
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
      stepType: "async_completion_framing",
      modelRole: "normal_reply",
      usage: input.usage
    });
  }

  /**
   * ADR-102 Slice 8 — record token-metered worker LLM usage for a document
   * generation job (outline + section + HTML + patch calls). Purpose is
   * `document_generation`, distinct from `document_render` (in-sandbox render
   * facts) and `chat_helper` (completion framing). Non-blocking: callers must
   * wrap in try/catch.
   */
  async recordDocumentGenerationUsageEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface: ModelCostLedgerSurface;
    source: string;
    sourceEventId: string;
    occurredAt: string;
    usage: RuntimeUsageSnapshot | null;
  }): Promise<number> {
    return this.recordTokenMeteredUsageSnapshot({
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      surface: input.surface,
      purpose: "document_generation",
      source: input.source,
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
      stepType: "document_worker_generation",
      modelRole: "tool_worker",
      usage: input.usage
    });
  }

  private async recordTokenMeteredUsageSnapshot(input: {
    workspaceId: string;
    assistantId: string | null;
    userId: string;
    surface: ModelCostLedgerSurface;
    purpose: ModelCostLedgerPurpose;
    source: string;
    sourceEventId: string;
    requestCorrelationId?: string | null;
    occurredAt: string;
    stepType: string;
    modelRole: PersaiRuntimeModelRole;
    usage: RuntimeUsageSnapshot | null;
  }): Promise<number> {
    if (input.usage === null) {
      return 0;
    }
    const catalogProvider = normalizeManagedProvider(input.usage.providerKey);
    const model = normalizeModelKey(input.usage.modelKey);
    if (catalogProvider === null || model === null) {
      return 0;
    }
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return 0;
    }
    const runtimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const profile = findRuntimeProviderCatalogProfileForTimestamp(
      runtimeProviderSettings.availableModelCatalogByProvider[catalogProvider],
      model,
      occurredAt
    );
    if (profile === null || profile.billingMode !== "token_metered") {
      return 0;
    }
    if (!profile.capabilities.includes("chat")) {
      return 0;
    }

    const usage = extractTokenUsageFacts(input.usage);
    const priceCatalogSnapshot = buildPriceCatalogSnapshot({ provider: catalogProvider, profile });
    const priceCatalogVersion = buildPriceCatalogVersion(priceCatalogSnapshot);
    const actualCostMicros = calculateTokenMeteredCostMicros({
      usage,
      profile
    });
    const ledgerProvider = input.usage.providerKey?.trim() || catalogProvider;
    const row: Prisma.ModelCostLedgerEventCreateManyInput = {
      id: buildDeterministicLedgerEventId({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        surface: input.surface,
        purpose: input.purpose,
        source: input.source,
        sourceEventId: input.sourceEventId,
        requestCorrelationId: input.requestCorrelationId ?? null,
        entryOrdinal: 0,
        provider: catalogProvider,
        model,
        stepType: input.stepType,
        modelRole: input.modelRole,
        toolCode: null
      }),
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      provider: ledgerProvider,
      model,
      capability: "chat",
      purpose: input.purpose,
      surface: input.surface,
      source: input.source,
      billingMode: profile.billingMode,
      rawUsage: {
        stepType: input.stepType,
        modelRole: input.modelRole,
        toolCode: null,
        inputTokens: usage.inputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        billableInputTokens: usage.billableInputTokens
      } as Prisma.InputJsonValue,
      actualCostMicros,
      currency: profile.providerPriceMetadata.currency,
      priceCatalogVersion,
      priceCatalogSnapshot: priceCatalogSnapshot as Prisma.InputJsonValue,
      sourceEventId: input.sourceEventId,
      requestCorrelationId: input.requestCorrelationId ?? null,
      occurredAt
    };
    const result = await this.prisma.modelCostLedgerEvent.createMany({
      data: [row],
      skipDuplicates: true
    });
    return result.count;
  }

  async recordChatMainReplyEvents(input: RecordModelCostLedgerInput): Promise<number> {
    const decoded = decodeTextGenerationUsageForApi({
      textUsageAccounting: input.textUsageAccounting,
      legacyUsageAccounting: input.usageAccounting
    });
    if (decoded.kind === "v2") {
      return this.recordV2ChatMainReplyEvents(input, decoded.usage.entries);
    }
    if (decoded.kind === "invalid" && input.textUsageAccounting !== undefined) {
      return 0;
    }
    const entries = input.usageAccounting?.entries ?? [];
    const eligibleEntries = entries
      .map((entry, index) => ({
        entry,
        index,
        purpose: resolveLedgerPurpose(entry, input.purpose)
      }))
      .filter(
        (
          candidate
        ): candidate is {
          entry: RuntimeUsageAccountingEntry;
          index: number;
          purpose: ModelCostLedgerPurpose;
        } => candidate.purpose !== null
      );
    if (eligibleEntries.length === 0) {
      return 0;
    }

    const runtimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return 0;
    }

    const rows: Prisma.ModelCostLedgerEventCreateManyInput[] = [];
    for (const { entry, index, purpose } of eligibleEntries) {
      const provider = normalizeManagedProvider(entry.providerKey);
      const model = normalizeModelKey(entry.modelKey);
      if (provider === null || model === null) {
        continue;
      }
      const profile = findRuntimeProviderCatalogProfileForTimestamp(
        runtimeProviderSettings.availableModelCatalogByProvider[provider],
        model,
        occurredAt
      );
      if (profile === null || profile.billingMode !== "token_metered") {
        continue;
      }
      if (!profile.capabilities.includes("chat")) {
        continue;
      }
      const usage = extractTokenUsageFacts(entry);
      const priceCatalogSnapshot = buildPriceCatalogSnapshot({ provider, profile });
      const priceCatalogVersion = buildPriceCatalogVersion(priceCatalogSnapshot);
      const actualCostMicros = calculateTokenMeteredCostMicros({ usage, profile });
      const sourceEventId = input.sourceEventId ?? null;
      const requestCorrelationId = input.requestCorrelationId ?? null;

      rows.push({
        id: buildDeterministicLedgerEventId({
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface,
          purpose,
          source: input.source,
          sourceEventId,
          requestCorrelationId,
          entryOrdinal: index,
          provider,
          model,
          stepType: entry.stepType,
          modelRole: entry.modelRole,
          toolCode: entry.toolCode ?? null
        }),
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        provider,
        model,
        capability: "chat",
        purpose,
        surface: input.surface,
        source: input.source,
        billingMode: profile.billingMode,
        rawUsage: {
          stepType: entry.stepType,
          modelRole: entry.modelRole,
          toolCode: entry.toolCode ?? null,
          inputTokens: usage.inputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          billableInputTokens: usage.billableInputTokens
        } as Prisma.InputJsonValue,
        actualCostMicros,
        currency: profile.providerPriceMetadata.currency,
        priceCatalogVersion,
        priceCatalogSnapshot: priceCatalogSnapshot as Prisma.InputJsonValue,
        sourceEventId,
        requestCorrelationId,
        occurredAt
      });
    }

    if (rows.length === 0) {
      return 0;
    }

    const result = await this.prisma.modelCostLedgerEvent.createMany({
      data: rows,
      skipDuplicates: true
    });
    return result.count;
  }

  private async recordV2ChatMainReplyEvents(
    input: RecordModelCostLedgerInput,
    entries: TextGenerationUsageAccountingV2[]
  ): Promise<number> {
    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return 0;
    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const rows: Prisma.ModelCostLedgerEventCreateManyInput[] = [];
    for (const [index, entry] of entries.entries()) {
      const purpose = resolveLedgerPurpose(
        entry as unknown as RuntimeUsageAccountingEntry,
        input.purpose
      );
      if (purpose === null) continue;
      const profile = findRuntimeProviderCatalogProfileForTimestamp(
        settings.availableModelCatalogByProvider[entry.providerKey],
        entry.modelKey,
        occurredAt
      );
      if (
        profile === null ||
        profile.billingMode !== "token_metered" ||
        !profile.capabilities.includes("chat")
      ) {
        continue;
      }
      const priceCatalogSnapshot = buildPriceCatalogSnapshot({
        provider: entry.providerKey,
        profile
      });
      const priceCatalogVersion = buildPriceCatalogVersion(priceCatalogSnapshot);
      const pricing = priceCatalogSnapshot.tokenPricing;
      const actualCachedInputCostMicros = Math.round(
        entry.uncachedInputTokens * pricing.inputPer1M +
          entry.cacheWriteInputTokens * pricing.cacheCreationInputPer1M +
          entry.cacheReadInputTokens * pricing.cachedInputPer1M
      );
      const noCacheInputCostMicros = Math.round(entry.totalInputTokens * pricing.inputPer1M);
      const outputCostMicros = Math.round(entry.outputTokens * pricing.outputPer1M);
      const actualCostMicros = BigInt(Math.max(0, actualCachedInputCostMicros + outputCostMicros));
      const sourceEventId = input.sourceEventId ?? null;
      const requestCorrelationId = input.requestCorrelationId ?? null;
      rows.push({
        id: buildDeterministicLedgerEventId({
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface,
          purpose,
          source: input.source,
          sourceEventId,
          requestCorrelationId,
          entryOrdinal: index,
          provider: entry.providerKey,
          model: entry.modelKey,
          stepType: entry.stepType,
          modelRole: entry.modelRole,
          toolCode: entry.toolCode ?? null
        }),
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        provider: entry.providerKey,
        model: entry.modelKey,
        capability: "chat",
        purpose,
        surface: input.surface,
        source: input.source,
        billingMode: profile.billingMode,
        rawUsage: {
          ...entry,
          actualCachedInputCostMicros,
          noCacheInputCostMicros,
          netCacheSavingsMicros: noCacheInputCostMicros - actualCachedInputCostMicros,
          netCacheSavingsPercent:
            noCacheInputCostMicros === 0
              ? null
              : (noCacheInputCostMicros - actualCachedInputCostMicros) / noCacheInputCostMicros,
          outputCostMicros
        } as Prisma.InputJsonValue,
        actualCostMicros,
        currency: profile.providerPriceMetadata.currency,
        priceCatalogVersion,
        priceCatalogSnapshot: priceCatalogSnapshot as Prisma.InputJsonValue,
        sourceEventId,
        requestCorrelationId,
        occurredAt
      });
    }
    if (rows.length === 0) return 0;
    return (await this.prisma.modelCostLedgerEvent.createMany({ data: rows, skipDuplicates: true }))
      .count;
  }

  async recordToolPathBillingFactsEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface: ModelCostLedgerSurface;
    source: string;
    sourceEventId: string;
    requestCorrelationId?: string | null;
    billingFacts: RuntimeBillingFacts | unknown;
  }): Promise<number> {
    const facts = normalizeRuntimeBillingFacts(input.billingFacts);
    if (facts === null || !isToolPathCode(facts.capability)) {
      return 0;
    }
    const purpose = resolveToolPathLedgerPurpose(facts.capability);
    const pathKey = resolveToolPathKeyFromBillingFacts(facts);
    if (pathKey === null) {
      return 0;
    }
    const occurredAt = new Date(facts.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return 0;
    }

    const catalog = await this.resolveToolPathPricingCatalogService.execute();
    const pricingRow = findToolPathPricingRowForTimestamp(catalog, pathKey, occurredAt);
    if (pricingRow === null) {
      return 0;
    }
    const profile = toToolPathPricingProfileForLedger(pricingRow);
    if (!toolPathProfileSupportsBillingFacts(profile, facts)) {
      return 0;
    }

    const actualCostMicros = calculateBillingFactsCostMicros(facts, profile, {
      timeMeteredConvention: "tool_path_usd_micros"
    });
    if (actualCostMicros === null) {
      return 0;
    }

    const priceCatalogSnapshot = buildToolPathPriceCatalogSnapshot({ facts, row: pricingRow });
    if (priceCatalogSnapshot === null) {
      return 0;
    }
    const priceCatalogVersion = buildBillingFactsPriceCatalogVersion(priceCatalogSnapshot);
    const row: Prisma.ModelCostLedgerEventCreateManyInput = {
      id: buildBillingFactsDeterministicLedgerEventId({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        surface: input.surface,
        purpose,
        source: input.source,
        sourceEventId: input.sourceEventId,
        provider: facts.providerKey,
        model: pricingRow.pathKey,
        capability: facts.capability
      }),
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      provider: facts.providerKey,
      model: pricingRow.pathKey,
      capability: facts.capability,
      purpose,
      surface: input.surface,
      source: input.source,
      billingMode: profile.billingMode,
      rawUsage: {
        billingFacts: facts,
        metering: facts.metering,
        toolPathKey: pricingRow.pathKey
      } as unknown as Prisma.InputJsonValue,
      actualCostMicros,
      currency: profile.providerPriceMetadata.currency,
      priceCatalogVersion,
      priceCatalogSnapshot: priceCatalogSnapshot as Prisma.InputJsonValue,
      sourceEventId: input.sourceEventId,
      requestCorrelationId: input.requestCorrelationId ?? null,
      occurredAt
    };

    const result = await this.prisma.modelCostLedgerEvent.createMany({
      data: [row],
      skipDuplicates: true
    });
    return result.count;
  }

  async recordPersistedBillingFactsEvent(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface: ModelCostLedgerSurface;
    source: string;
    sourceEventId: string;
    requestCorrelationId?: string | null;
    billingFacts: RuntimeBillingFacts | unknown;
  }): Promise<number> {
    const facts = normalizeRuntimeBillingFacts(input.billingFacts);
    if (facts === null) {
      return 0;
    }
    if (isToolPathCode(facts.capability)) {
      return this.recordToolPathBillingFactsEvent(input);
    }
    const purpose = resolvePurposeFromBillingFacts(facts);
    if (purpose === null) {
      return 0;
    }
    const occurredAt = new Date(facts.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return 0;
    }

    const runtimeProviderSettings =
      await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const catalog =
      runtimeProviderSettings.availableModelCatalogByProvider[
        facts.providerKey as keyof typeof runtimeProviderSettings.availableModelCatalogByProvider
      ];
    if (catalog === undefined) {
      return 0;
    }
    const profile = findRuntimeProviderCatalogProfileForTimestamp(
      catalog,
      facts.modelKey,
      occurredAt
    );
    if (profile === null || !profileSupportsBillingFacts(profile, facts)) {
      return 0;
    }

    const actualCostMicros = calculateBillingFactsCostMicros(facts, profile, {
      timeMeteredConvention: "model_catalog_plain_usd"
    });
    if (actualCostMicros === null) {
      return 0;
    }

    const priceCatalogSnapshot = buildBillingFactsPriceCatalogSnapshot({ facts, profile });
    const priceCatalogVersion = buildBillingFactsPriceCatalogVersion(priceCatalogSnapshot);
    const provider = facts.providerKey;
    const model = profile.model;
    const row: Prisma.ModelCostLedgerEventCreateManyInput = {
      id: buildBillingFactsDeterministicLedgerEventId({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        userId: input.userId,
        surface: input.surface,
        purpose,
        source: input.source,
        sourceEventId: input.sourceEventId,
        provider,
        model,
        capability: facts.capability
      }),
      workspaceId: input.workspaceId,
      assistantId: input.assistantId,
      userId: input.userId,
      provider,
      model,
      capability: facts.capability,
      purpose,
      surface: input.surface,
      source: input.source,
      billingMode: profile.billingMode,
      rawUsage: {
        billingFacts: facts,
        metering: facts.metering
      } as unknown as Prisma.InputJsonValue,
      actualCostMicros,
      currency: profile.providerPriceMetadata.currency,
      priceCatalogVersion,
      priceCatalogSnapshot: priceCatalogSnapshot as Prisma.InputJsonValue,
      sourceEventId: input.sourceEventId,
      requestCorrelationId: input.requestCorrelationId ?? null,
      occurredAt
    };

    const result = await this.prisma.modelCostLedgerEvent.createMany({
      data: [row],
      skipDuplicates: true
    });
    return result.count;
  }
}
