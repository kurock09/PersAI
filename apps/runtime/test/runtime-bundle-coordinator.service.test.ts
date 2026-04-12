import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
import type {
  RuntimeBundleRef,
  RuntimeKnowledgeAccessConfig,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import { RuntimeBundleCoordinatorService } from "../src/modules/bundles/runtime-bundle-coordinator.service";
import { RuntimeBundleRegistryService } from "../src/modules/bundles/runtime-bundle-registry.service";
import { RuntimeObservabilityService } from "../src/modules/observability/runtime-observability.service";
import type { RuntimeStateRedisService } from "../src/modules/runtime-state/infrastructure/coordination/runtime-state-redis.service";
import type { RuntimeStatePostgresService } from "../src/modules/runtime-state/infrastructure/persistence/runtime-state-postgres.service";

type CapturedUpsertBundleStateInput = {
  assistantId: string;
  workspaceId: string;
  materializedSpecId: string;
  publishedVersionId: string;
  runtimeTier: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
  bundleHash: string;
  lastWarmedAt?: Date | null;
  invalidatedAt?: Date | null;
};

type CapturedInvalidateBundleStatesInput = {
  assistantId: string;
  publishedVersionId?: string;
  invalidatedAt: Date;
};

type CapturedInvalidateBundleMarkersInput = {
  assistantId: string;
  publishedVersionId?: string;
};

type CapturedMarkBundleStateWarmedCall = {
  publishedVersionId: string;
  warmedAt: Date;
};

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

function createConfig(): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3012,
    LOG_LEVEL: "info",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 4,
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000
  };
}

function createWarmInput() {
  const artifact = compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
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
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: artifact.hash,
      compiledAt: "2026-04-11T00:00:00.000Z"
    },
    bundleDocument: artifact.document,
    materializedSpecId: "spec-1",
    runtimeTier: "free_shared_restricted" as const
  };
}

export async function runRuntimeBundleCoordinatorServiceTest(): Promise<void> {
  let upsertBundleStateInput: CapturedUpsertBundleStateInput | null = null;
  let invalidateBundleStatesInput: CapturedInvalidateBundleStatesInput | null = null;
  let markBundleStateWarmedCall: CapturedMarkBundleStateWarmedCall | null = null;
  let markedWarmBundle: RuntimeBundleRef | null = null;
  let invalidateBundleMarkersInput: CapturedInvalidateBundleMarkersInput | null = null;

  const registryService = new RuntimeBundleRegistryService(
    createConfig(),
    new RuntimeObservabilityService()
  );
  registryService.onModuleInit();

  const postgres = {
    upsertBundleState: async (input: CapturedUpsertBundleStateInput) => {
      upsertBundleStateInput = input;
      return input;
    },
    markBundleStateWarmed: async (publishedVersionId: string, warmedAt: Date) => {
      markBundleStateWarmedCall = { publishedVersionId, warmedAt };
      return {
        publishedVersionId,
        lastWarmedAt: warmedAt
      };
    },
    invalidateBundleStates: async (input: CapturedInvalidateBundleStatesInput) => {
      invalidateBundleStatesInput = input;
      return { count: 1 };
    }
  } as unknown as RuntimeStatePostgresService;

  const redis = {
    markBundleWarm: async (bundle: RuntimeBundleRef) => {
      markedWarmBundle = bundle;
    },
    invalidateBundleMarkers: async (input: CapturedInvalidateBundleMarkersInput) => {
      invalidateBundleMarkersInput = input;
      return 1;
    }
  } as unknown as RuntimeStateRedisService;

  const service = new RuntimeBundleCoordinatorService(registryService, postgres, redis);
  const warmInput = createWarmInput();

  const warmed = await service.warmBundle(warmInput);
  assert.equal(warmed.bundle.bundleId, "bundle-1");
  assert.equal(registryService.getSnapshot().entries, 1);
  assert.deepEqual(markedWarmBundle, warmInput.bundle);
  if (upsertBundleStateInput === null) {
    throw new Error("Expected bundle-state upsert call.");
  }
  const recordedWarmState = upsertBundleStateInput as CapturedUpsertBundleStateInput;
  assert.equal(recordedWarmState.materializedSpecId, "spec-1");
  assert.equal(recordedWarmState.runtimeTier, "free_shared_restricted");
  assert.equal(recordedWarmState.bundleHash, warmInput.bundle.bundleHash);
  assert.equal(recordedWarmState.invalidatedAt, undefined);
  assert.equal(recordedWarmState.lastWarmedAt, undefined);
  assert.deepEqual(markBundleStateWarmedCall, {
    publishedVersionId: "version-1",
    warmedAt: new Date(warmed.warmedAt)
  });

  const invalidated = await service.invalidateBundles({
    assistantId: "assistant-1",
    publishedVersionId: "version-1"
  });
  assert.equal(invalidated.invalidatedCount, 1);
  assert.equal(registryService.getSnapshot().entries, 0);
  assert.deepEqual(invalidateBundleMarkersInput, {
    assistantId: "assistant-1",
    publishedVersionId: "version-1"
  });
  if (invalidateBundleStatesInput === null) {
    throw new Error("Expected bundle-state invalidation call.");
  }
  const recordedInvalidation = invalidateBundleStatesInput as CapturedInvalidateBundleStatesInput;
  assert.equal(recordedInvalidation.assistantId, "assistant-1");
  assert.equal(recordedInvalidation.publishedVersionId, "version-1");
  assert.equal(recordedInvalidation.invalidatedAt.toISOString(), invalidated.invalidatedAt);

  await assert.rejects(
    service.warmBundle({
      ...warmInput,
      materializedSpecId: " "
    }),
    /materializedSpecId/
  );

  let failedRedisWarmCalls = 0;
  const failingRegistry = new RuntimeBundleRegistryService(
    createConfig(),
    new RuntimeObservabilityService()
  );
  failingRegistry.onModuleInit();
  const failingService = new RuntimeBundleCoordinatorService(
    failingRegistry,
    {
      upsertBundleState: async () => ({ ok: true }),
      markBundleStateWarmed: async () => ({ ok: true }),
      invalidateBundleStates: async () => ({ count: 1 })
    } as unknown as RuntimeStatePostgresService,
    {
      markBundleWarm: async () => {
        failedRedisWarmCalls += 1;
        throw new Error("redis unavailable");
      },
      invalidateBundleMarkers: async () => 0
    } as unknown as RuntimeStateRedisService
  );

  await assert.rejects(failingService.warmBundle(createWarmInput()), /redis unavailable/);
  assert.equal(failedRedisWarmCalls, 1);
  assert.equal(failingRegistry.getSnapshot().entries, 0);
}
