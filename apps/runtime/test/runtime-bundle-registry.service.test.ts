import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeKnowledgeAccessConfig, RuntimeToolPolicy } from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import { RuntimeReadinessService } from "../src/modules/platform-core/application/runtime-readiness.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";

function createConfig(): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3012,
    LOG_LEVEL: "info",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 1,
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_BASE_URL: "http://provider-gateway.local",
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000
  };
}

class FakeProviderGatewayClientService {
  async getReadiness() {
    return {
      ready: true,
      providerCacheReady: true
    };
  }
}

const KNOWLEDGE_ACCESS_CONFIG = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: [
    {
      source: "web",
      searchAliasToolCode: "web_search",
      fetchAliasToolCode: "web_fetch",
      searchCredentialToolCode: "web_search",
      fetchCredentialToolCode: "web_fetch"
    },
    {
      source: "memory",
      searchAliasToolCode: "memory_search",
      fetchAliasToolCode: "memory_get",
      searchCredentialToolCode: "memory_search",
      fetchCredentialToolCode: null
    }
  ]
} satisfies RuntimeKnowledgeAccessConfig;

const KNOWLEDGE_TOOL_POLICIES = [
  {
    toolCode: "web_search",
    displayName: "Web Search",
    description: "Search the public web.",
    kind: "plan",
    executionMode: "inline",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
  {
    toolCode: "web_fetch",
    displayName: "Web Fetch",
    description: "Fetch structured web content.",
    kind: "plan",
    executionMode: "inline",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
  {
    toolCode: "memory_search",
    displayName: "Memory Search",
    description: "Search assistant memory.",
    kind: "plan",
    executionMode: "inline",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
  {
    toolCode: "memory_get",
    displayName: "Memory Get",
    description: "Fetch one assistant memory item.",
    kind: "plan",
    executionMode: "inline",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  }
] satisfies RuntimeToolPolicy[];

function createWarmInput(bundleId: string, assistantId: string, publishedVersionId: string) {
  const artifact = compileAssistantRuntimeBundle({
    metadata: {
      assistantId,
      workspaceId: `workspace-${assistantId}`,
      publishedVersionId,
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "PersAI",
      instructions: "Help the user.",
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null
    },
    userContext: {
      displayName: "Alex",
      birthday: null,
      gender: null,
      locale: "en",
      timezone: "UTC"
    },
    runtime: {
      runtimeAssignment: { tier: "free_shared_restricted" },
      runtimeProviderProfile: null,
      runtimeProviderRouting: null,
      optimizationPolicy: null,
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        suggestByMessageCount: false,
        telegramAutoSummarizeEnabled: true
      }
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      effectiveCapabilities: null,
      toolAvailability: null,
      memoryControl: null,
      tasksControl: null,
      toolCredentialRefs: {},
      toolPolicies: [...KNOWLEDGE_TOOL_POLICIES],
      quota: {
        planCode: "free",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings: null,
      telegram: {
        enabled: false,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mentions_only",
        parseMode: "plain_text",
        inbound: false,
        outbound: false,
        accessMode: "disabled",
        ownerClaimStatus: "unclaimed",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null
      }
    },
    promptDocuments: {
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      bootstrap: ""
    }
  });

  return {
    bundle: {
      bundleId,
      assistantId,
      workspaceId: artifact.bundle.metadata.workspaceId,
      publishedVersionId,
      bundleHash: artifact.hash,
      compiledAt: "2026-04-11T00:00:00.000Z"
    },
    bundleDocument: artifact.document,
    materializedSpecId: `spec-${publishedVersionId}`,
    runtimeTier: "free_shared_restricted" as const
  };
}

function createWarmInputMissingToolPolicy() {
  const artifact = compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-missing-policy",
      workspaceId: "workspace-assistant-missing-policy",
      publishedVersionId: "version-missing-policy",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "PersAI",
      instructions: "Help the user.",
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null
    },
    userContext: {
      displayName: "Alex",
      birthday: null,
      gender: null,
      locale: "en",
      timezone: "UTC"
    },
    runtime: {
      runtimeAssignment: { tier: "free_shared_restricted" },
      runtimeProviderProfile: null,
      runtimeProviderRouting: null,
      optimizationPolicy: null,
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        suggestByMessageCount: false,
        telegramAutoSummarizeEnabled: true
      }
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      effectiveCapabilities: null,
      toolAvailability: {
        tools: [{ code: "web_search", effectiveActivation: "active" }]
      },
      memoryControl: null,
      tasksControl: null,
      toolCredentialRefs: {},
      toolPolicies: [],
      quota: {
        planCode: "free",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings: null,
      telegram: {
        enabled: false,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mentions_only",
        parseMode: "plain_text",
        inbound: false,
        outbound: false,
        accessMode: "disabled",
        ownerClaimStatus: "unclaimed",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null
      }
    },
    promptDocuments: {
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      bootstrap: ""
    }
  });

  return {
    bundle: {
      bundleId: "bundle-missing-policy",
      assistantId: "assistant-missing-policy",
      workspaceId: "workspace-assistant-missing-policy",
      publishedVersionId: "version-missing-policy",
      bundleHash: artifact.hash,
      compiledAt: "2026-04-11T00:00:00.000Z"
    },
    bundleDocument: artifact.document,
    materializedSpecId: "spec-version-missing-policy",
    runtimeTier: "free_shared_restricted" as const
  };
}

function createWarmInputInvalidSharedCompaction() {
  const input = createWarmInput(
    "bundle-invalid-shared-compaction",
    "assistant-invalid-shared-compaction",
    "version-invalid-shared-compaction"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: { sharedCompaction: { webSuggestionLatencyMs: number } };
  };
  bundleDocument.runtime.sharedCompaction.webSuggestionLatencyMs = 0;
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidKnowledgeAccess() {
  const input = createWarmInput(
    "bundle-invalid-knowledge-access",
    "assistant-invalid-knowledge-access",
    "version-invalid-knowledge-access"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: { knowledgeAccess: { ragMode: string } };
  };
  bundleDocument.runtime.knowledgeAccess.ragMode = "separate_tool";
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

export async function runRuntimeBundleRegistryServiceTest(): Promise<void> {
  const observabilityService = new RuntimeObservabilityService();
  const registryService = new RuntimeBundleRegistryService(createConfig(), observabilityService);
  const readinessService = new RuntimeReadinessService(
    registryService,
    new FakeProviderGatewayClientService() as unknown as ProviderGatewayClientService
  );

  const beforeInit = await readinessService.getSnapshot();
  assert.equal(beforeInit.ready, false);
  assert.equal(beforeInit.bundleCacheReady, false);
  assert.equal(beforeInit.executionEnabled, true);

  registryService.onModuleInit();

  const afterInit = await readinessService.getSnapshot();
  assert.equal(afterInit.ready, true);
  assert.equal(afterInit.bundleCacheReady, true);
  assert.equal(afterInit.providerCacheReady, true);
  assert.equal(afterInit.bundleCacheEntries, 0);

  registryService.validateWarmBundleInput(createWarmInput("bundle-0", "assistant-0", "version-0"));

  const warmedOne = registryService.warmBundle(
    createWarmInput("bundle-1", "assistant-1", "version-1")
  );
  assert.equal(warmedOne.replaced, false);
  assert.equal(warmedOne.cacheEntries, 1);
  assert.deepEqual(warmedOne.evictedBundleIds, []);

  const warmedTwo = registryService.warmBundle(
    createWarmInput("bundle-2", "assistant-2", "version-2")
  );
  assert.equal(warmedTwo.replaced, false);
  assert.equal(warmedTwo.cacheEntries, 1);
  assert.deepEqual(warmedTwo.evictedBundleIds, ["bundle-1"]);

  const invalidated = registryService.invalidateBundles({ assistantId: "assistant-2" });
  assert.equal(invalidated.invalidatedCount, 1);
  assert.equal(invalidated.remainingEntries, 0);

  assert.throws(() => {
    registryService.warmBundle({
      ...createWarmInput("bundle-3", "assistant-3", "version-3"),
      bundle: {
        ...createWarmInput("bundle-3", "assistant-3", "version-3").bundle,
        bundleHash: "wrong-hash"
      }
    });
  });

  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputMissingToolPolicy()),
    /missing explicit policy metadata/
  );
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidSharedCompaction()),
    /sharedCompaction\.webSuggestionLatencyMs/
  );
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidKnowledgeAccess()),
    /knowledgeAccess\.ragMode/
  );

  const overriddenWarm = registryService.warmBundle(
    createWarmInput("bundle-4", "assistant-4", "version-4"),
    "2026-04-11T03:00:00.000Z"
  );
  assert.equal(overriddenWarm.warmedAt, "2026-04-11T03:00:00.000Z");

  const overriddenInvalidation = registryService.invalidateBundles(
    { assistantId: "assistant-4" },
    "2026-04-11T04:00:00.000Z"
  );
  assert.equal(overriddenInvalidation.invalidatedAt, "2026-04-11T04:00:00.000Z");

  const observability = observabilityService.getSnapshot();
  assert.equal(observability.warmRequests, 3);
  assert.equal(observability.evictedBundles, 1);
  assert.equal(observability.invalidateRequests, 2);
  assert.equal(observability.invalidatedBundles, 2);
}
