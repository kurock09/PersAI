import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { RuntimeConfig } from "@persai/config";
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
      optimizationPolicy: null
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
      toolQuotaPolicy: [],
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
