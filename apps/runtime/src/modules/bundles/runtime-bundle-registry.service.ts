import { BadRequestException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
import {
  PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES,
  PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES,
  PERSAI_RUNTIME_KNOWLEDGE_SOURCES,
  PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES,
  PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES,
  PERSAI_RUNTIME_TOOL_EXECUTION_MODES,
  PERSAI_RUNTIME_TOOL_KINDS,
  PERSAI_RUNTIME_TOOL_USAGE_RULES,
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
      if (!policyByCode.has(tool.code)) {
        throw new BadRequestException(
          `bundleDocument.governance.toolPolicies is missing explicit policy metadata for "${tool.code}"`
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
    if (policy.kind === "internal" && policy.visibleToModel) {
      throw new BadRequestException(
        `bundleDocument.governance.toolPolicies["${policy.toolCode}"] cannot be internal and model-visible`
      );
    }
  }

  private assertSharedCompactionConfig(bundle: AssistantRuntimeBundle): void {
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
    if (typeof sharedCompaction.suggestByMessageCount !== "boolean") {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.suggestByMessageCount must be boolean"
      );
    }
    if (typeof sharedCompaction.telegramAutoSummarizeEnabled !== "boolean") {
      throw new BadRequestException(
        "bundleDocument.runtime.sharedCompaction.telegramAutoSummarizeEnabled must be boolean"
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
  }

  private assertKnowledgeSourceMapping(
    sourceConfigBySource: Map<string, Record<string, unknown>>,
    toolPolicyByCode: Map<string, RuntimeToolPolicy>,
    source: "web" | "memory",
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
    this.assertSharedCompactionConfig(bundle);
    this.assertKnowledgeAccessConfig(bundle, toolPolicyByCode);
    return bundle;
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
