import assert from "node:assert/strict";
import {
  compileAssistantRuntimeBundle,
  hashAssistantRuntimeBundleDocument
} from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
import type {
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeToolPolicy,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
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
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000,
    RUNTIME_SANDBOX_TIMEOUT_MS: 30_000
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
    },
    {
      source: "chat",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "subscription",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "global",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    },
    {
      source: "document",
      searchAliasToolCode: null,
      fetchAliasToolCode: null,
      searchCredentialToolCode: null,
      fetchCredentialToolCode: null
    }
  ]
} satisfies RuntimeKnowledgeAccessConfig;

const WORKER_TOOLS_CONFIG = {
  tools: [
    {
      toolCode: "browser",
      family: "browser_interaction",
      outcomeKind: "structured_output",
      timeoutMs: 120000,
      confirmationRule: "required_for_mutations",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    }
  ]
} satisfies RuntimeWorkerToolsConfig;

const BROWSER_CONFIG = {
  toolCode: "browser",
  executionMode: "worker",
  credentialToolCode: "browser",
  providerIds: ["browserless"],
  defaultProviderId: "browserless",
  actions: ["snapshot", "act"],
  confirmationRequiredActions: ["act"]
} satisfies RuntimeBrowserConfig;

const BROWSER_CREDENTIAL_REF = {
  refKey: "persai:persai-runtime:tool/browser/api-key",
  secretRef: {
    source: "persai",
    provider: "persai-runtime",
    id: "tool/browser/api-key"
  },
  configured: false,
  providerId: "browserless"
} as const;

const BASE_TOOL_POLICIES = [
  {
    toolCode: "browser",
    displayName: "Browser",
    description: "Navigate and interact with web pages.",
    kind: "plan",
    executionMode: "worker",
    usageRule: "forbidden",
    enabled: false,
    visibleToModel: false,
    visibleInPlanEditor: true,
    dailyCallLimit: null
  },
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
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: null
        },
        yandex: {
          voice: "jane",
          role: null
        },
        openai: {
          voice: "marin"
        }
      }
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
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      workerTools: WORKER_TOOLS_CONFIG,
      browser: BROWSER_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
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
      toolCredentialRefs: {
        browser: BROWSER_CREDENTIAL_REF
      },
      toolPolicies: [...BASE_TOOL_POLICIES],
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
      preview: "",
      welcome: ""
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
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "ru-RU",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: null
        },
        yandex: {
          voice: "jane",
          role: null
        },
        openai: {
          voice: "marin"
        }
      }
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
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_CONFIG,
      workerTools: WORKER_TOOLS_CONFIG,
      browser: BROWSER_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
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
      toolCredentialRefs: {
        browser: BROWSER_CREDENTIAL_REF
      },
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
      preview: "",
      welcome: ""
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

function createWarmInputQuotaStatusRemap() {
  const input = createWarmInput(
    "bundle-quota-remap",
    "assistant-quota-remap",
    "version-quota-remap"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    governance: {
      toolAvailability: {
        tools: Array<{ code: string; effectiveActivation: string }>;
      } | null;
      toolPolicies: Array<Record<string, unknown>>;
    };
  };
  bundleDocument.governance.toolAvailability = {
    tools: [{ code: "persai_tool_quota_status", effectiveActivation: "active" }]
  };
  bundleDocument.governance.toolPolicies.push({
    toolCode: "quota_status",
    displayName: "Quota Status",
    description: "Read live quota usage.",
    kind: "system",
    executionMode: "inline",
    usageRule: "allowed",
    enabled: true,
    visibleToModel: true,
    visibleInPlanEditor: false,
    dailyCallLimit: null
  });
  return {
    ...input,
    bundle: {
      ...input.bundle,
      bundleHash: hashAssistantRuntimeBundleDocument(JSON.stringify(bundleDocument))
    },
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidPerTurnCap() {
  const input = createWarmInput(
    "bundle-invalid-per-turn-cap",
    "assistant-invalid-per-turn-cap",
    "version-invalid-per-turn-cap"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    governance: { toolPolicies: Array<Record<string, unknown>> };
  };
  const target = bundleDocument.governance.toolPolicies[0];
  if (!target) {
    throw new Error("expected at least one tool policy in the warm input fixture");
  }
  target.perTurnCap = 0;
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidToolBudgets() {
  const input = createWarmInput(
    "bundle-invalid-tool-budgets",
    "assistant-invalid-tool-budgets",
    "version-invalid-tool-budgets"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: Record<string, unknown>;
  };
  bundleDocument.runtime.toolBudgets = {
    loopLimitByMode: { normal: 0, premium: null, reasoning: null }
  };
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidThinkingBudgetByLevel() {
  const input = createWarmInput(
    "bundle-invalid-thinking-budget",
    "assistant-invalid-thinking-budget",
    "version-invalid-thinking-budget"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: Record<string, unknown>;
  };
  bundleDocument.runtime.thinkingBudgetByLevel = {
    byLevel: { light: null, medium: null, heavy: -1, deep: null }
  };
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
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

function createWarmInputInvalidWorkerToolsMissingCoverage() {
  const input = createWarmInput(
    "bundle-invalid-worker-tools-coverage",
    "assistant-invalid-worker-tools-coverage",
    "version-invalid-worker-tools-coverage"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: { workerTools: { tools: Array<Record<string, unknown>> } };
  };
  bundleDocument.runtime.workerTools.tools = [];
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidWorkerToolsNonWorkerReference() {
  const input = createWarmInput(
    "bundle-invalid-worker-tools-reference",
    "assistant-invalid-worker-tools-reference",
    "version-invalid-worker-tools-reference"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: { workerTools: { tools: Array<Record<string, unknown>> } };
  };
  bundleDocument.runtime.workerTools.tools = [
    {
      toolCode: "web_search",
      family: "browser_interaction",
      outcomeKind: "structured_output",
      timeoutMs: 120000,
      confirmationRule: "required_for_mutations",
      supportsProviderRouting: true,
      failureBehavior: "surface_error"
    }
  ];
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidBrowserConfigProvider() {
  const input = createWarmInput(
    "bundle-invalid-browser-provider",
    "assistant-invalid-browser-provider",
    "version-invalid-browser-provider"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    runtime: { browser: { providerIds: string[] } };
  };
  bundleDocument.runtime.browser.providerIds = ["browserless", "unknown"];
  return {
    ...input,
    bundleDocument: JSON.stringify(bundleDocument)
  };
}

function createWarmInputInvalidBrowserCredentialRef() {
  const input = createWarmInput(
    "bundle-invalid-browser-credential",
    "assistant-invalid-browser-credential",
    "version-invalid-browser-credential"
  );
  const bundleDocument = JSON.parse(input.bundleDocument) as {
    governance: {
      toolCredentialRefs: {
        browser: {
          refKey: string;
          secretRef: { source: string; provider: string; id: string };
        };
      };
    };
  };
  bundleDocument.governance.toolCredentialRefs.browser.refKey =
    "persai:persai-runtime:tool/web_search/api-key";
  bundleDocument.governance.toolCredentialRefs.browser.secretRef.id = "tool/web_search/api-key";
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
  registryService.validateWarmBundleInput(createWarmInputQuotaStatusRemap());

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
  assert.throws(
    () =>
      registryService.validateWarmBundleInput(createWarmInputInvalidWorkerToolsMissingCoverage()),
    /workerTools\.tools must include "browser"/
  );
  assert.throws(
    () =>
      registryService.validateWarmBundleInput(
        createWarmInputInvalidWorkerToolsNonWorkerReference()
      ),
    /cannot reference non-worker tool "web_search"/
  );
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidBrowserConfigProvider()),
    /runtime\.browser\.providerIds contains invalid provider/
  );
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidBrowserCredentialRef()),
    /toolCredentialRefs\["browser"\]\.refKey must be "persai:persai-runtime:tool\/browser\/api-key"/
  );
  // ADR-074 Slice L1 — warm-path rejects misconfigured perTurnCap on a tool
  // policy. Zero / negative / fractional / non-numeric all collapse to "use
  // code default" silently at runtime, but they are still a misconfiguration
  // upstream and must be caught at compile-time so admins notice.
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidPerTurnCap()),
    /perTurnCap must be null, omitted, or a strictly-positive integer/
  );
  // ADR-074 Slice L1 — warm-path rejects misconfigured per-mode loop limits.
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidToolBudgets()),
    /toolBudgets\.loopLimitByMode\.normal must be null or a strictly-positive integer/
  );
  // ADR-121 Slice 4 — warm-path rejects a negative thinking-budget leaf.
  assert.throws(
    () => registryService.validateWarmBundleInput(createWarmInputInvalidThinkingBudgetByLevel()),
    /thinkingBudgetByLevel\.byLevel\.heavy must be null or a non-negative integer/
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
