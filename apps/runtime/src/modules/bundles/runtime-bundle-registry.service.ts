import { BadRequestException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
import {
  PERSAI_RUNTIME_BROWSER_ACTIONS,
  PERSAI_RUNTIME_BROWSER_PROVIDER_IDS,
  PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS,
  PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES,
  PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES,
  PERSAI_RUNTIME_KNOWLEDGE_SOURCES,
  PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES,
  PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES,
  PERSAI_RUNTIME_TOOL_EXECUTION_MODES,
  PERSAI_RUNTIME_TOOL_KINDS,
  PERSAI_RUNTIME_TOOL_USAGE_RULES,
  PERSAI_RUNTIME_WORKER_CONFIRMATION_RULES,
  PERSAI_RUNTIME_WORKER_FAILURE_BEHAVIORS,
  PERSAI_RUNTIME_WORKER_OUTCOME_KINDS,
  PERSAI_RUNTIME_WORKER_TOOL_FAMILIES,
  type RuntimeContextHydrationConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";
import { RuntimeObservabilityService } from "../observability/runtime-observability.service";
import type {
  InvalidateRuntimeBundleRequest,
  InvalidateRuntimeBundleResponse,
  RuntimeBundleCacheEntry,
  RuntimeBundleRegistrySnapshot,
  WarmRuntimeBundleRequest,
  WarmRuntimeBundleResponse
} from "./bundle.types";

const TOOL_POLICY_PARITY_RUNTIME_CODE_BY_INVENTORY_CODE: Record<string, string> = {
  persai_tool_quota_status: "quota_status"
};

@Injectable()
export class RuntimeBundleRegistryService implements OnModuleInit {
  private readonly bundles = new Map<string, RuntimeBundleCacheEntry>();
  private initialized = false;
  private initializedAt: string | null = null;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly runtimeObservabilityService: RuntimeObservabilityService
  ) {}

  onModuleInit(): void {
    this.initialized = true;
    this.initializedAt = new Date().toISOString();
  }

  validateWarmBundleInput(input: WarmRuntimeBundleRequest): void {
    this.parseAndValidateWarmBundleInput(input);
  }

  warmBundle(
    input: WarmRuntimeBundleRequest,
    warmedAtOverride?: string
  ): WarmRuntimeBundleResponse {
    const parsedBundle = this.parseAndValidateWarmBundleInput(input);
    const warmedAt = warmedAtOverride ?? new Date().toISOString();

    const replaced = this.bundles.has(input.bundle.bundleId);
    if (replaced) {
      this.bundles.delete(input.bundle.bundleId);
    }

    this.bundles.set(input.bundle.bundleId, {
      bundle: input.bundle,
      bundleDocument: input.bundleDocument,
      parsedBundle,
      warmedAt
    });

    const evictedBundleIds = this.evictOldestBundles();
    this.runtimeObservabilityService.recordWarm({
      replaced,
      evictedCount: evictedBundleIds.length,
      warmedAt
    });

    return {
      bundle: input.bundle,
      warmedAt,
      replaced,
      cacheEntries: this.bundles.size,
      evictedBundleIds
    };
  }

  invalidateBundles(
    input: InvalidateRuntimeBundleRequest,
    invalidatedAtOverride?: string
  ): InvalidateRuntimeBundleResponse {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("request body must be an object");
    }

    this.assertNonEmpty(input.assistantId, "assistantId");

    const invalidatedAt = invalidatedAtOverride ?? new Date().toISOString();
    const keysToDelete: string[] = [];

    for (const [bundleId, entry] of this.bundles.entries()) {
      if (entry.bundle.assistantId !== input.assistantId) {
        continue;
      }
      if (
        input.publishedVersionId &&
        entry.bundle.publishedVersionId !== input.publishedVersionId
      ) {
        continue;
      }
      keysToDelete.push(bundleId);
    }

    for (const bundleId of keysToDelete) {
      this.bundles.delete(bundleId);
    }

    this.runtimeObservabilityService.recordInvalidation({
      invalidatedCount: keysToDelete.length,
      invalidatedAt
    });

    return {
      invalidatedAt,
      invalidatedCount: keysToDelete.length,
      remainingEntries: this.bundles.size
    };
  }

  getBundle(bundleId: string): RuntimeBundleCacheEntry | null {
    return this.bundles.get(bundleId) ?? null;
  }

  findBundleByAssistantVersion(params: {
    assistantId: string;
    publishedVersionId: string | null;
    bundleHash?: string | null;
  }): RuntimeBundleCacheEntry | null {
    if (params.publishedVersionId === null || params.publishedVersionId.trim().length === 0) {
      return null;
    }

    for (const entry of this.bundles.values()) {
      if (entry.bundle.assistantId !== params.assistantId) {
        continue;
      }
      if (entry.bundle.publishedVersionId !== params.publishedVersionId) {
        continue;
      }
      if (params.bundleHash !== undefined && params.bundleHash !== null) {
        if (entry.bundle.bundleHash !== params.bundleHash) {
          continue;
        }
      }
      return entry;
    }

    return null;
  }

  getSnapshot(): RuntimeBundleRegistrySnapshot {
    return {
      initialized: this.initialized,
      initializedAt: this.initializedAt,
      maxEntries: this.config.RUNTIME_BUNDLE_CACHE_MAX_ENTRIES,
      entries: this.bundles.size
    };
  }

  private parseAndValidateWarmBundleInput(input: WarmRuntimeBundleRequest): AssistantRuntimeBundle {
    if (!input.bundle || typeof input.bundle !== "object") {
      throw new BadRequestException("bundle must be an object");
    }

    this.assertNonEmpty(input.bundle.bundleId, "bundle.bundleId");
    this.assertNonEmpty(input.bundle.bundleHash, "bundle.bundleHash");
    this.assertNonEmpty(input.bundle.assistantId, "bundle.assistantId");
    this.assertNonEmpty(input.bundle.workspaceId, "bundle.workspaceId");
    this.assertNonEmpty(input.bundle.publishedVersionId, "bundle.publishedVersionId");
    this.assertNonEmpty(input.bundleDocument, "bundleDocument");

    const parsedBundle = this.parseBundleDocument(input.bundleDocument);
    const actualHash = hashAssistantRuntimeBundleDocument(input.bundleDocument);
    if (actualHash !== input.bundle.bundleHash) {
      throw new BadRequestException("bundleDocument hash does not match bundle.bundleHash");
    }
    if (parsedBundle.metadata.assistantId !== input.bundle.assistantId) {
      throw new BadRequestException(
        "bundleDocument metadata.assistantId does not match bundle.assistantId"
      );
    }
    if (parsedBundle.metadata.workspaceId !== input.bundle.workspaceId) {
      throw new BadRequestException(
        "bundleDocument metadata.workspaceId does not match bundle.workspaceId"
      );
    }
    if (parsedBundle.metadata.publishedVersionId !== input.bundle.publishedVersionId) {
      throw new BadRequestException(
        "bundleDocument metadata.publishedVersionId does not match bundle.publishedVersionId"
      );
    }
    return parsedBundle;
  }

  private evictOldestBundles(): string[] {
    const evictedBundleIds: string[] = [];

    while (this.bundles.size > this.config.RUNTIME_BUNDLE_CACHE_MAX_ENTRIES) {
      const oldestBundleId = this.bundles.keys().next().value;
      if (!oldestBundleId) {
        break;
      }
      this.bundles.delete(oldestBundleId);
      evictedBundleIds.push(oldestBundleId);
    }

    return evictedBundleIds;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private assertToolPolicyParity(bundle: AssistantRuntimeBundle): Map<string, RuntimeToolPolicy> {
    const governance = bundle.governance;
    if (!this.isRecord(governance)) {
      throw new BadRequestException("bundleDocument.governance must be an object");
    }

    const rawToolPolicies = governance.toolPolicies;
    if (!Array.isArray(rawToolPolicies)) {
      throw new BadRequestException("bundleDocument.governance.toolPolicies must be an array");
    }

    const toolPolicies = rawToolPolicies as RuntimeToolPolicy[];
    const policyByCode = new Map<string, RuntimeToolPolicy>();
    for (const policy of toolPolicies) {
      this.assertValidToolPolicy(policy);
      if (policyByCode.has(policy.toolCode)) {
        throw new BadRequestException(
          `bundleDocument.governance.toolPolicies has duplicate toolCode "${policy.toolCode}"`
        );
      }
      policyByCode.set(policy.toolCode, policy);
    }

    const rawToolAvailability = governance.toolAvailability;
    if (!this.isRecord(rawToolAvailability)) {
      return policyByCode;
    }
    const rawTools = rawToolAvailability.tools;
    if (!Array.isArray(rawTools)) {
      return policyByCode;
    }

    for (const tool of rawTools) {
      if (!this.isRecord(tool) || typeof tool.code !== "string" || tool.code.trim().length === 0) {
        continue;
      }
      const inventoryToolCode = tool.code;
      const runtimePolicyToolCode =
        TOOL_POLICY_PARITY_RUNTIME_CODE_BY_INVENTORY_CODE[inventoryToolCode] ?? inventoryToolCode;
      if (!policyByCode.has(runtimePolicyToolCode)) {
        throw new BadRequestException(
          `bundleDocument.governance.toolPolicies is missing explicit policy metadata for "${inventoryToolCode}"`
        );
      }
    }

    return policyByCode;
  }

  private assertValidToolPolicy(policy: RuntimeToolPolicy): void {
    this.assertNonEmpty(policy.toolCode, "bundleDocument.governance.toolPolicies[].toolCode");
    this.assertNonEmpty(policy.displayName, "bundleDocument.governance.toolPolicies[].displayName");

    if (
      policy.description !== null &&
      policy.description !== undefined &&
      typeof policy.description !== "string"
    ) {
      throw new BadRequestException(
        "bundleDocument.governance.toolPolicies[].description must be a string or null"
      );
    }

    if (!PERSAI_RUNTIME_TOOL_KINDS.includes(policy.kind)) {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].kind is invalid`
      );
    }
    if (!PERSAI_RUNTIME_TOOL_EXECUTION_MODES.includes(policy.executionMode)) {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].executionMode is invalid`
      );
    }
    if (!PERSAI_RUNTIME_TOOL_USAGE_RULES.includes(policy.usageRule)) {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].usageRule is invalid`
      );
    }
    if (typeof policy.enabled !== "boolean") {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].enabled must be boolean`
      );
    }
    if (typeof policy.visibleToModel !== "boolean") {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].visibleToModel must be boolean`
      );
    }
    if (typeof policy.visibleInPlanEditor !== "boolean") {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].visibleInPlanEditor must be boolean`
      );
    }
    if (
      policy.dailyCallLimit !== null &&
      (!Number.isInteger(policy.dailyCallLimit) || policy.dailyCallLimit < 0)
    ) {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"].dailyCallLimit must be null or a non-negative integer`
      );
    }
    // ADR-074 Slice L1 — perTurnCap is optional. If present it must be a
    // strictly-positive integer. The runtime budget policy already silently
    // ignores non-positive overrides (so a misconfigured 0 cannot disable
    // the loop), but we want a hard parse-time error so the bundle compile
    // pipeline cannot accidentally publish a meaningless cap.
    if (policy.perTurnCap !== null && policy.perTurnCap !== undefined) {
      if (!Number.isInteger(policy.perTurnCap) || policy.perTurnCap <= 0) {
        throw new BadRequestException(
          `bundleDocument.governance.toolPolicies["${policy.toolCode}"].perTurnCap must be null, omitted, or a strictly-positive integer`
        );
      }
    }
    if (policy.maxFilePreviewBytes !== null && policy.maxFilePreviewBytes !== undefined) {
      if (!Number.isInteger(policy.maxFilePreviewBytes) || policy.maxFilePreviewBytes <= 0) {
        throw new BadRequestException(
          `bundleDocument.governance.toolPolicies["${policy.toolCode}"].maxFilePreviewBytes must be null, omitted, or a strictly-positive integer`
        );
      }
    }
    if (policy.maxFilePreviewEdgePx !== null && policy.maxFilePreviewEdgePx !== undefined) {
      if (!Number.isInteger(policy.maxFilePreviewEdgePx) || policy.maxFilePreviewEdgePx <= 0) {
        throw new BadRequestException(
          `bundleDocument.governance.toolPolicies["${policy.toolCode}"].maxFilePreviewEdgePx must be null, omitted, or a strictly-positive integer`
        );
      }
    }
    if (policy.kind === "internal" && policy.visibleToModel) {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"] cannot be internal and model-visible`
      );
    }
  }

  private assertContextHydrationConfig(
    bundle: AssistantRuntimeBundle
  ): RuntimeContextHydrationConfig {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      throw new BadRequestException("bundleDocument.runtime must be an object");
    }

    const contextHydration = runtime.contextHydration;
    if (!this.isRecord(contextHydration)) {
      throw new BadRequestException("bundleDocument.runtime.contextHydration must be an object");
    }
    if (
      typeof contextHydration.preset !== "string" ||
      !PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS.includes(
        contextHydration.preset as (typeof PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS)[number]
      )
    ) {
      throw new BadRequestException("bundleDocument.runtime.contextHydration.preset is invalid");
    }
    if (
      !Number.isInteger(contextHydration.targetContextBudget) ||
      contextHydration.targetContextBudget <= 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.targetContextBudget must be a positive integer"
      );
    }
    if (
      !Number.isInteger(contextHydration.compactionTriggerThreshold) ||
      contextHydration.compactionTriggerThreshold <= 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.compactionTriggerThreshold must be a positive integer"
      );
    }
    if (
      !Number.isInteger(contextHydration.keepRecentMinimum) ||
      contextHydration.keepRecentMinimum <= 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.keepRecentMinimum must be a positive integer"
      );
    }
    if (
      !Number.isInteger(contextHydration.knowledgeHydrationBudget) ||
      contextHydration.knowledgeHydrationBudget < 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.knowledgeHydrationBudget must be a non-negative integer"
      );
    }
    if (typeof contextHydration.autoCompactionWeb !== "boolean") {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.autoCompactionWeb must be boolean"
      );
    }
    if (typeof contextHydration.autoCompactionTelegram !== "boolean") {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.autoCompactionTelegram must be boolean"
      );
    }
    if (
      contextHydration.sharedCompactionSummaryBudgetTokens !== undefined &&
      (!Number.isInteger(contextHydration.sharedCompactionSummaryBudgetTokens) ||
        contextHydration.sharedCompactionSummaryBudgetTokens <= 0)
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.sharedCompactionSummaryBudgetTokens must be a positive integer when provided"
      );
    }
    if (contextHydration.compactionTriggerThreshold > contextHydration.targetContextBudget) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.compactionTriggerThreshold must be less than or equal to targetContextBudget"
      );
    }
    if (contextHydration.knowledgeHydrationBudget > contextHydration.targetContextBudget) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.knowledgeHydrationBudget must be less than or equal to targetContextBudget"
      );
    }
    if (
      contextHydration.sharedCompactionSummaryBudgetTokens !== undefined &&
      contextHydration.sharedCompactionSummaryBudgetTokens > contextHydration.targetContextBudget
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.contextHydration.sharedCompactionSummaryBudgetTokens must be less than or equal to targetContextBudget"
      );
    }

    return contextHydration as RuntimeContextHydrationConfig;
  }

  private assertSharedCompactionConfig(
    bundle: AssistantRuntimeBundle,
    contextHydration: RuntimeContextHydrationConfig
  ): void {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      throw new BadRequestException("bundleDocument.runtime must be an object");
    }

    const sharedCompaction = runtime.sharedCompaction;
    if (!this.isRecord(sharedCompaction)) {
      throw new BadRequestException("bundleDocument.runtime.sharedCompaction must be an object");
    }

    const [expectedSummarizeToolCode, expectedCompactToolCode] =
      PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES;

    if (sharedCompaction.summarizeToolCode !== expectedSummarizeToolCode) {
      throw new BadRequestException(
        `bundleDocument.runtime.sharedCompaction.summarizeToolCode must be "${expectedSummarizeToolCode}"`
      );
    }
    if (sharedCompaction.compactToolCode !== expectedCompactToolCode) {
      throw new BadRequestException(
        `bundleDocument.runtime.sharedCompaction.compactToolCode must be "${expectedCompactToolCode}"`
      );
    }
    if (
      !Number.isInteger(sharedCompaction.webSuggestionLatencyMs) ||
      sharedCompaction.webSuggestionLatencyMs <= 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.webSuggestionLatencyMs must be a positive integer"
      );
    }
    if (!Number.isInteger(sharedCompaction.reserveTokens) || sharedCompaction.reserveTokens < 0) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.reserveTokens must be a non-negative integer"
      );
    }
    if (
      !Number.isInteger(sharedCompaction.keepRecentTokens) ||
      sharedCompaction.keepRecentTokens < 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.keepRecentTokens must be a non-negative integer"
      );
    }
    if (
      !Number.isInteger(sharedCompaction.recentTurnsPreserve) ||
      sharedCompaction.recentTurnsPreserve < 0
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.recentTurnsPreserve must be a non-negative integer"
      );
    }
    if (typeof sharedCompaction.telegramAutoSummarizeEnabled !== "boolean") {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.telegramAutoSummarizeEnabled must be boolean"
      );
    }
    if (sharedCompaction.reserveTokens !== contextHydration.targetContextBudget) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.reserveTokens must match runtime.contextHydration.targetContextBudget"
      );
    }
    const expectedKeepRecentTokens = Math.max(
      0,
      contextHydration.targetContextBudget - contextHydration.compactionTriggerThreshold
    );
    if (sharedCompaction.keepRecentTokens !== expectedKeepRecentTokens) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.keepRecentTokens must match the derived runtime.contextHydration threshold"
      );
    }
    if (sharedCompaction.recentTurnsPreserve !== contextHydration.keepRecentMinimum) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.recentTurnsPreserve must match runtime.contextHydration.keepRecentMinimum"
      );
    }
    if (sharedCompaction.telegramAutoSummarizeEnabled !== contextHydration.autoCompactionTelegram) {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.telegramAutoSummarizeEnabled must match runtime.contextHydration.autoCompactionTelegram"
      );
    }
  }

  private assertKnowledgeAccessConfig(
    bundle: AssistantRuntimeBundle,
    toolPolicyByCode: Map<string, RuntimeToolPolicy>
  ): void {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      throw new BadRequestException("bundleDocument.runtime must be an object");
    }

    const knowledgeAccess = runtime.knowledgeAccess;
    if (!this.isRecord(knowledgeAccess)) {
      throw new BadRequestException("bundleDocument.runtime.knowledgeAccess must be an object");
    }

    const [expectedSearchToolCode, expectedFetchToolCode] = PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES;
    if (knowledgeAccess.searchToolCode !== expectedSearchToolCode) {
      throw new BadRequestException(
        `bundleDocument.runtime.knowledgeAccess.searchToolCode must be "${expectedSearchToolCode}"`
      );
    }
    if (knowledgeAccess.fetchToolCode !== expectedFetchToolCode) {
      throw new BadRequestException(
        `bundleDocument.runtime.knowledgeAccess.fetchToolCode must be "${expectedFetchToolCode}"`
      );
    }

    const executionModes = knowledgeAccess.executionModes;
    if (!Array.isArray(executionModes) || executionModes.length === 0) {
      throw new BadRequestException(
        "bundleDocument.runtime.knowledgeAccess.executionModes must be a non-empty array"
      );
    }
    const seenExecutionModes = new Set<string>();
    for (const mode of executionModes) {
      if (
        typeof mode !== "string" ||
        !PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES.includes(
          mode as (typeof PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES)[number]
        )
      ) {
        throw new BadRequestException(
          "bundleDocument.runtime.knowledgeAccess.executionModes contains an invalid mode"
        );
      }
      if (seenExecutionModes.has(mode)) {
        throw new BadRequestException(
          `bundleDocument.runtime.knowledgeAccess.executionModes has duplicate mode "${mode}"`
        );
      }
      seenExecutionModes.add(mode);
    }
    for (const mode of PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES) {
      if (!seenExecutionModes.has(mode)) {
        throw new BadRequestException(
          `bundleDocument.runtime.knowledgeAccess.executionModes must include "${mode}"`
        );
      }
    }

    if (
      typeof knowledgeAccess.ragMode !== "string" ||
      !PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES.includes(
        knowledgeAccess.ragMode as (typeof PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES)[number]
      )
    ) {
      throw new BadRequestException("bundleDocument.runtime.knowledgeAccess.ragMode is invalid");
    }

    const sources = knowledgeAccess.sources;
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new BadRequestException(
        "bundleDocument.runtime.knowledgeAccess.sources must be a non-empty array"
      );
    }

    const sourceConfigBySource = new Map<string, Record<string, unknown>>();
    for (const sourceConfig of sources) {
      if (!this.isRecord(sourceConfig)) {
        throw new BadRequestException(
          "bundleDocument.runtime.knowledgeAccess.sources[] must be an object"
        );
      }
      if (
        typeof sourceConfig.source !== "string" ||
        !PERSAI_RUNTIME_KNOWLEDGE_SOURCES.includes(
          sourceConfig.source as (typeof PERSAI_RUNTIME_KNOWLEDGE_SOURCES)[number]
        )
      ) {
        throw new BadRequestException(
          "bundleDocument.runtime.knowledgeAccess.sources[].source is invalid"
        );
      }
      if (sourceConfigBySource.has(sourceConfig.source)) {
        throw new BadRequestException(
          `bundleDocument.runtime.knowledgeAccess.sources has duplicate source "${sourceConfig.source}"`
        );
      }

      this.assertNullableNonEmptyString(
        sourceConfig.searchAliasToolCode,
        `bundleDocument.runtime.knowledgeAccess.sources["${sourceConfig.source}"].searchAliasToolCode`
      );
      this.assertNullableNonEmptyString(
        sourceConfig.fetchAliasToolCode,
        `bundleDocument.runtime.knowledgeAccess.sources["${sourceConfig.source}"].fetchAliasToolCode`
      );
      this.assertNullableNonEmptyString(
        sourceConfig.searchCredentialToolCode,
        `bundleDocument.runtime.knowledgeAccess.sources["${sourceConfig.source}"].searchCredentialToolCode`
      );
      this.assertNullableNonEmptyString(
        sourceConfig.fetchCredentialToolCode,
        `bundleDocument.runtime.knowledgeAccess.sources["${sourceConfig.source}"].fetchCredentialToolCode`
      );

      for (const toolCode of [
        sourceConfig.searchAliasToolCode,
        sourceConfig.fetchAliasToolCode,
        sourceConfig.searchCredentialToolCode,
        sourceConfig.fetchCredentialToolCode
      ]) {
        if (toolCode === "browser") {
          throw new BadRequestException(
            "bundleDocument.runtime.knowledgeAccess must not map the browser tool into the knowledge layer"
          );
        }
      }

      sourceConfigBySource.set(sourceConfig.source, sourceConfig);
    }

    this.assertKnowledgeSourceMapping(sourceConfigBySource, toolPolicyByCode, "web", {
      searchAliasToolCode: "web_search",
      fetchAliasToolCode: "web_fetch",
      searchCredentialToolCode: "web_search",
      fetchCredentialToolCode: "web_fetch"
    });
    this.assertKnowledgeSourceMapping(sourceConfigBySource, toolPolicyByCode, "memory", {
      searchAliasToolCode: "memory_search",
      fetchAliasToolCode: "memory_get",
      searchCredentialToolCode: "memory_search",
      fetchCredentialToolCode: null
    });
    this.assertKnowledgeSourceMapping(sourceConfigBySource, toolPolicyByCode, "chat", {
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    });
    this.assertKnowledgeSourceMapping(sourceConfigBySource, toolPolicyByCode, "subscription", {
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    });
    this.assertKnowledgeSourceMapping(sourceConfigBySource, toolPolicyByCode, "global", {
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    });
    this.assertKnowledgeSourceMapping(sourceConfigBySource, toolPolicyByCode, "document", {
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    });
  }

  private assertKnowledgeSourceMapping(
    sourceConfigBySource: Map<string, Record<string, unknown>>,
    toolPolicyByCode: Map<string, RuntimeToolPolicy>,
    source: "web" | "memory" | "chat" | "subscription" | "global" | "document",
    expected: {
      searchAliasToolCode: string | null;
      fetchAliasToolCode: string | null;
      searchCredentialToolCode: string | null;
      fetchCredentialToolCode: string | null;
    }
  ): void {
    const sourceConfig = sourceConfigBySource.get(source);
    if (!sourceConfig) {
      throw new BadRequestException(
        `bundleDocument.runtime.knowledgeAccess.sources must include "${source}"`
      );
    }

    for (const [field, expectedValue] of Object.entries(expected)) {
      if (sourceConfig[field] !== expectedValue) {
        throw new BadRequestException(
          `bundleDocument.runtime.knowledgeAccess.sources["${source}"].${field} is invalid`
        );
      }
      if (typeof expectedValue === "string") {
        this.assertKnowledgeToolPolicyReference(toolPolicyByCode, expectedValue, source, field);
      }
    }
  }

  private assertKnowledgeToolPolicyReference(
    toolPolicyByCode: Map<string, RuntimeToolPolicy>,
    toolCode: string,
    source: string,
    field: string
  ): void {
    const policy = toolPolicyByCode.get(toolCode);
    if (!policy) {
      throw new BadRequestException(
        `bundleDocument.runtime.knowledgeAccess.sources["${source}"].${field} references unknown tool "${toolCode}"`
      );
    }
    if (policy.kind === "internal") {
      throw new BadRequestException(
        `bundleDocument.runtime.knowledgeAccess.sources["${source}"].${field} cannot reference internal tool "${toolCode}"`
      );
    }
  }

  private assertWorkerToolsConfig(
    bundle: AssistantRuntimeBundle,
    toolPolicyByCode: Map<string, RuntimeToolPolicy>
  ): void {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      throw new BadRequestException("bundleDocument.runtime must be an object");
    }

    const workerTools = runtime.workerTools;
    if (!this.isRecord(workerTools)) {
      throw new BadRequestException("bundleDocument.runtime.workerTools must be an object");
    }

    const rawTools = workerTools.tools;
    if (!Array.isArray(rawTools)) {
      throw new BadRequestException("bundleDocument.runtime.workerTools.tools must be an array");
    }

    const workerPolicies = [...toolPolicyByCode.values()].filter(
      (policy) => policy.executionMode === "worker"
    );
    const coveredWorkerTools = new Set<string>();

    for (const entry of rawTools) {
      if (!this.isRecord(entry)) {
        throw new BadRequestException(
          "bundleDocument.runtime.workerTools.tools[] must be an object"
        );
      }

      this.assertNonEmpty(entry.toolCode, "bundleDocument.runtime.workerTools.tools[].toolCode");
      const toolCode = entry.toolCode as string;
      if (coveredWorkerTools.has(toolCode)) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools has duplicate toolCode "${toolCode}"`
        );
      }
      if (
        typeof entry.family !== "string" ||
        !PERSAI_RUNTIME_WORKER_TOOL_FAMILIES.includes(
          entry.family as (typeof PERSAI_RUNTIME_WORKER_TOOL_FAMILIES)[number]
        )
      ) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"].family is invalid`
        );
      }
      if (
        typeof entry.outcomeKind !== "string" ||
        !PERSAI_RUNTIME_WORKER_OUTCOME_KINDS.includes(
          entry.outcomeKind as (typeof PERSAI_RUNTIME_WORKER_OUTCOME_KINDS)[number]
        )
      ) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"].outcomeKind is invalid`
        );
      }
      if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"].timeoutMs must be a positive integer`
        );
      }
      if (
        typeof entry.confirmationRule !== "string" ||
        !PERSAI_RUNTIME_WORKER_CONFIRMATION_RULES.includes(
          entry.confirmationRule as (typeof PERSAI_RUNTIME_WORKER_CONFIRMATION_RULES)[number]
        )
      ) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"].confirmationRule is invalid`
        );
      }
      if (typeof entry.supportsProviderRouting !== "boolean") {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"].supportsProviderRouting must be boolean`
        );
      }
      if (
        typeof entry.failureBehavior !== "string" ||
        !PERSAI_RUNTIME_WORKER_FAILURE_BEHAVIORS.includes(
          entry.failureBehavior as (typeof PERSAI_RUNTIME_WORKER_FAILURE_BEHAVIORS)[number]
        )
      ) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"].failureBehavior is invalid`
        );
      }

      const policy = toolPolicyByCode.get(toolCode);
      if (!policy) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"] references unknown tool "${toolCode}"`
        );
      }
      if (policy.executionMode !== "worker") {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools["${toolCode}"] cannot reference non-worker tool "${toolCode}"`
        );
      }

      coveredWorkerTools.add(toolCode);
    }

    for (const policy of workerPolicies) {
      if (!coveredWorkerTools.has(policy.toolCode)) {
        throw new BadRequestException(
          `bundleDocument.runtime.workerTools.tools must include "${policy.toolCode}"`
        );
      }
    }
  }

  private assertBrowserConfig(
    bundle: AssistantRuntimeBundle,
    toolPolicyByCode: Map<string, RuntimeToolPolicy>
  ): void {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      throw new BadRequestException("bundleDocument.runtime must be an object");
    }

    const browser = runtime.browser;
    if (!this.isRecord(browser)) {
      throw new BadRequestException("bundleDocument.runtime.browser must be an object");
    }

    if (browser.toolCode !== "browser") {
      throw new BadRequestException('bundleDocument.runtime.browser.toolCode must be "browser"');
    }
    if (browser.executionMode !== "worker") {
      throw new BadRequestException(
        'bundleDocument.runtime.browser.executionMode must be "worker"'
      );
    }
    if (browser.credentialToolCode !== "browser") {
      throw new BadRequestException(
        'bundleDocument.runtime.browser.credentialToolCode must be "browser"'
      );
    }

    if (!Array.isArray(browser.providerIds) || browser.providerIds.length === 0) {
      throw new BadRequestException(
        "bundleDocument.runtime.browser.providerIds must be a non-empty array"
      );
    }

    const seenProviderIds = new Set<string>();
    for (const providerId of browser.providerIds) {
      if (
        typeof providerId !== "string" ||
        !PERSAI_RUNTIME_BROWSER_PROVIDER_IDS.includes(
          providerId as (typeof PERSAI_RUNTIME_BROWSER_PROVIDER_IDS)[number]
        )
      ) {
        throw new BadRequestException(
          `bundleDocument.runtime.browser.providerIds contains invalid provider "${String(providerId)}"`
        );
      }
      if (seenProviderIds.has(providerId)) {
        throw new BadRequestException(
          `bundleDocument.runtime.browser.providerIds has duplicate provider "${providerId}"`
        );
      }
      seenProviderIds.add(providerId);
    }

    if (
      typeof browser.defaultProviderId !== "string" ||
      !seenProviderIds.has(browser.defaultProviderId)
    ) {
      throw new BadRequestException(
        "bundleDocument.runtime.browser.defaultProviderId must reference runtime.browser.providerIds"
      );
    }

    if (!Array.isArray(browser.actions) || browser.actions.length === 0) {
      throw new BadRequestException(
        "bundleDocument.runtime.browser.actions must be a non-empty array"
      );
    }

    const seenActions = new Set<string>();
    for (const action of browser.actions) {
      if (
        typeof action !== "string" ||
        !PERSAI_RUNTIME_BROWSER_ACTIONS.includes(
          action as (typeof PERSAI_RUNTIME_BROWSER_ACTIONS)[number]
        )
      ) {
        throw new BadRequestException(
          `bundleDocument.runtime.browser.actions contains invalid action "${String(action)}"`
        );
      }
      if (seenActions.has(action)) {
        throw new BadRequestException(
          `bundleDocument.runtime.browser.actions has duplicate action "${action}"`
        );
      }
      seenActions.add(action);
    }

    if (!Array.isArray(browser.confirmationRequiredActions)) {
      throw new BadRequestException(
        "bundleDocument.runtime.browser.confirmationRequiredActions must be an array"
      );
    }
    for (const action of browser.confirmationRequiredActions) {
      if (typeof action !== "string" || !seenActions.has(action)) {
        throw new BadRequestException(
          `bundleDocument.runtime.browser.confirmationRequiredActions contains invalid action "${String(action)}"`
        );
      }
    }

    const policy = toolPolicyByCode.get(browser.toolCode);
    if (!policy) {
      throw new BadRequestException(
        'bundleDocument.runtime.browser.toolCode references unknown tool "browser"'
      );
    }
    if (policy.executionMode !== "worker") {
      throw new BadRequestException(
        'bundleDocument.runtime.browser.toolCode must reference a worker tool "browser"'
      );
    }

    const browserCredentialRef = bundle.governance.toolCredentialRefs[browser.credentialToolCode];
    if (!browserCredentialRef) {
      throw new BadRequestException(
        'bundleDocument.governance.toolCredentialRefs must include "browser"'
      );
    }
    if (browserCredentialRef.refKey !== "persai:persai-runtime:tool/browser/api-key") {
      throw new BadRequestException(
        'bundleDocument.governance.toolCredentialRefs["browser"].refKey must be "persai:persai-runtime:tool/browser/api-key"'
      );
    }
    if (
      browserCredentialRef.secretRef.source !== "persai" ||
      browserCredentialRef.secretRef.provider !== "persai-runtime" ||
      browserCredentialRef.secretRef.id !== "tool/browser/api-key"
    ) {
      throw new BadRequestException(
        'bundleDocument.governance.toolCredentialRefs["browser"].secretRef must target "tool/browser/api-key"'
      );
    }
    if (
      browserCredentialRef.providerId !== null &&
      browserCredentialRef.providerId !== undefined &&
      !seenProviderIds.has(browserCredentialRef.providerId)
    ) {
      throw new BadRequestException(
        'bundleDocument.governance.toolCredentialRefs["browser"].providerId must match runtime.browser.providerIds'
      );
    }
  }

  private parseBundleDocument(document: string): AssistantRuntimeBundle {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new BadRequestException("bundleDocument must be valid JSON");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new BadRequestException("bundleDocument must decode to an object");
    }

    const metadata = (parsed as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      throw new BadRequestException("bundleDocument.metadata must be an object");
    }

    const bundle = parsed as AssistantRuntimeBundle;
    const toolPolicyByCode = this.assertToolPolicyParity(bundle);
    const contextHydration = this.assertContextHydrationConfig(bundle);
    this.assertSharedCompactionConfig(bundle, contextHydration);
    this.assertKnowledgeAccessConfig(bundle, toolPolicyByCode);
    this.assertWorkerToolsConfig(bundle, toolPolicyByCode);
    this.assertBrowserConfig(bundle, toolPolicyByCode);
    this.assertToolBudgetsConfig(bundle);
    this.assertThinkingBudgetByLevelConfig(bundle);
    return bundle;
  }

  /**
   * ADR-074 Slice L1 — `runtime.toolBudgets` is an optional per-assistant
   * override of the tool-loop iteration limit per execution mode. The
   * runtime budget policy is defensive (silently ignores non-positive
   * leaves), but we hard-fail at parse time on type errors so a
   * misconfigured bundle compile pipeline cannot publish meaningless data
   * that obscures the loaded values when an operator inspects the bundle.
   */
  private assertToolBudgetsConfig(bundle: AssistantRuntimeBundle): void {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      return;
    }
    const toolBudgets = (runtime as Record<string, unknown>).toolBudgets;
    if (toolBudgets === undefined || toolBudgets === null) {
      return;
    }
    if (!this.isRecord(toolBudgets)) {
      throw new BadRequestException(
        "bundleDocument.runtime.toolBudgets must be null, omitted, or an object"
      );
    }
    const loop = (toolBudgets as Record<string, unknown>).loopLimitByMode;
    if (loop === null || loop === undefined) {
      return;
    }
    if (!this.isRecord(loop)) {
      throw new BadRequestException(
        "bundleDocument.runtime.toolBudgets.loopLimitByMode must be null or an object"
      );
    }
    for (const mode of ["normal", "premium", "reasoning"] as const) {
      const value = (loop as Record<string, unknown>)[mode];
      if (value === null || value === undefined) {
        continue;
      }
      if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new BadRequestException(
          `bundleDocument.runtime.toolBudgets.loopLimitByMode.${mode} must be null or a strictly-positive integer`
        );
      }
    }
  }

  /**
   * ADR-121 Slice 4 — `runtime.thinkingBudgetByLevel` is an optional
   * per-plan override of the thinking-token budget per routing level. The
   * runtime resolver is defensive (silently ignores out-of-range leaves),
   * but we hard-fail at parse time on type errors so a misconfigured bundle
   * compile pipeline cannot publish meaningless data.
   */
  private assertThinkingBudgetByLevelConfig(bundle: AssistantRuntimeBundle): void {
    const runtime = bundle.runtime;
    if (!this.isRecord(runtime)) {
      return;
    }
    const thinkingBudgetByLevel = (runtime as Record<string, unknown>).thinkingBudgetByLevel;
    if (thinkingBudgetByLevel === undefined || thinkingBudgetByLevel === null) {
      return;
    }
    if (!this.isRecord(thinkingBudgetByLevel)) {
      throw new BadRequestException(
        "bundleDocument.runtime.thinkingBudgetByLevel must be null, omitted, or an object"
      );
    }
    const byLevel = (thinkingBudgetByLevel as Record<string, unknown>).byLevel;
    if (byLevel === null || byLevel === undefined) {
      return;
    }
    if (!this.isRecord(byLevel)) {
      throw new BadRequestException(
        "bundleDocument.runtime.thinkingBudgetByLevel.byLevel must be null or an object"
      );
    }
    for (const level of ["light", "medium", "heavy", "deep"] as const) {
      const value = (byLevel as Record<string, unknown>)[level];
      if (value === null || value === undefined) {
        continue;
      }
      if (!Number.isInteger(value) || (value as number) < 0) {
        throw new BadRequestException(
          `bundleDocument.runtime.thinkingBudgetByLevel.byLevel.${level} must be null or a non-negative integer`
        );
      }
    }
  }

  private assertNonEmpty(value: unknown, field: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
  }

  private assertNullableNonEmptyString(value: unknown, field: string): void {
    if (value === null) {
      return;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be null or a non-empty string`);
    }
  }
}
