import assert from "node:assert/strict";
import { ApplyAssistantPublishedVersionService } from "../src/modules/workspace-management/application/apply-assistant-published-version.service";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import type { SyncNativeRuntimeBundleService } from "../src/modules/workspace-management/application/sync-native-runtime-bundle.service";
import type { SyncProviderGatewayWarmupService } from "../src/modules/workspace-management/application/sync-provider-gateway-warmup.service";
import type { MaterializeAssistantPublishedVersionService } from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type { AssistantMaterializedSpec } from "../src/modules/workspace-management/domain/assistant-materialized-spec.entity";
import type { AssistantPublishedVersion } from "../src/modules/workspace-management/domain/assistant-published-version.entity";

const assistant: Assistant = {
  id: "assistant-1",
  userId: "user-1",
  workspaceId: "workspace-1",
  draftDisplayName: "Mira",
  draftInstructions: "Help warmly.",
  draftTraits: null,
  draftAvatarEmoji: null,
  draftAvatarUrl: null,
  draftAssistantGender: null,
  draftUpdatedAt: new Date("2026-04-11T10:00:00.000Z"),
  applyStatus: "pending",
  applyTargetVersionId: "version-1",
  applyAppliedVersionId: null,
  applyRequestedAt: new Date("2026-04-11T10:00:00.000Z"),
  applyStartedAt: null,
  applyFinishedAt: null,
  applyErrorCode: null,
  applyErrorMessage: null,
  configDirtyAt: null,
  createdAt: new Date("2026-04-11T10:00:00.000Z"),
  updatedAt: new Date("2026-04-11T10:00:00.000Z")
};

const publishedVersion: AssistantPublishedVersion = {
  id: "version-1",
  assistantId: "assistant-1",
  version: 1,
  snapshotDisplayName: "Mira",
  snapshotInstructions: "Help warmly.",
  snapshotTraits: null,
  snapshotAvatarEmoji: null,
  snapshotAvatarUrl: null,
  snapshotAssistantGender: null,
  publishedByUserId: "user-1",
  createdAt: new Date("2026-04-11T10:00:00.000Z")
};

const materializedSpec: AssistantMaterializedSpec = {
  id: "spec-1",
  assistantId: "assistant-1",
  publishedVersionId: "version-1",
  sourceAction: "publish",
  algorithmVersion: 1,
  materializedAtConfigGeneration: 1,
  layers: {
    layers: {
      governance: {
        runtimeProviderProfile: {
          availableModelsByProvider: {
            openai: ["gpt-5.4"],
            anthropic: ["claude-sonnet-4-5"]
          },
          availableModelCatalogByProvider: {
            openai: {
              models: [
                {
                  model: "gpt-5.4",
                  capabilities: ["chat"],
                  inputTokenWeight: 1,
                  cachedInputTokenWeight: 1,
                  outputTokenWeight: 1,
                  displayLabel: null,
                  notes: null,
                  providerPriceMetadata: null
                }
              ]
            },
            anthropic: {
              models: [
                {
                  model: "claude-sonnet-4-5",
                  capabilities: ["chat"],
                  inputTokenWeight: 1,
                  cachedInputTokenWeight: 1,
                  outputTokenWeight: 1,
                  displayLabel: null,
                  notes: null,
                  providerPriceMetadata: null
                }
              ]
            }
          }
        },
        runtimeAssignment: {
          effectiveTier: "paid_shared_restricted",
          planDefaultTier: "paid_shared_restricted",
          runtimeTierOverride: null,
          source: "plan_default"
        }
      }
    }
  },
  runtimeBundle: {
    metadata: {
      workspaceId: "workspace-1"
    }
  },
  assistantConfig: { bootstrap: true },
  assistantWorkspace: { workspace: true },
  layersDocument: "{}",
  runtimeBundleDocument: '{"metadata":{"workspaceId":"workspace-1"}}',
  runtimeBundleHash: "bundle-hash-1",
  assistantConfigDocument: "{}",
  assistantWorkspaceDocument: "{}",
  contentHash: "content-hash-1",
  createdAt: new Date("2026-04-11T10:01:00.000Z")
};

async function runSuccessCase(): Promise<void> {
  let syncedInput: { materializedSpec: AssistantMaterializedSpec; runtimeTier: string } | null =
    null;
  let warmedProviderGatewayInput: { materializedSpec: AssistantMaterializedSpec } | null = null;
  let markApplySucceededArgs: [string, string] | null = null;
  let markApplyDegradedArgs: [string, string, string, string] | null = null;
  const auditEvents: unknown[] = [];

  const assistantRepository = {
    markApplyInProgress: async () => assistant,
    markApplySucceeded: async (userId: string, appliedVersionId: string) => {
      markApplySucceededArgs = [userId, appliedVersionId];
      return assistant;
    },
    markApplyDegraded: async (
      userId: string,
      targetVersionId: string,
      errorCode: string,
      errorMessage: string
    ) => {
      markApplyDegradedArgs = [userId, targetVersionId, errorCode, errorMessage];
      return assistant;
    },
    markApplyFailed: async () => assistant
  } as Pick<
    AssistantRepository,
    "markApplyInProgress" | "markApplySucceeded" | "markApplyDegraded" | "markApplyFailed"
  > as AssistantRepository;

  const materializedSpecRepository = {
    findByPublishedVersionId: async () => materializedSpec
  } as Pick<
    AssistantMaterializedSpecRepository,
    "findByPublishedVersionId"
  > as AssistantMaterializedSpecRepository;

  const appendAudit = {
    execute: async (event: unknown) => {
      auditEvents.push(event);
    }
  } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService;

  const materializeService = {
    execute: async () => undefined
  } as Pick<
    MaterializeAssistantPublishedVersionService,
    "execute"
  > as MaterializeAssistantPublishedVersionService;

  const syncNativeRuntimeBundleService = {
    execute: async (input: {
      materializedSpec: AssistantMaterializedSpec;
      runtimeTier: string;
    }) => {
      syncedInput = input;
      return "warmed" as const;
    }
  } as Pick<SyncNativeRuntimeBundleService, "execute"> as SyncNativeRuntimeBundleService;

  const syncProviderGatewayWarmupService = {
    execute: async (input: { materializedSpec: AssistantMaterializedSpec }) => {
      warmedProviderGatewayInput = input;
      return "warmed" as const;
    }
  } as Pick<SyncProviderGatewayWarmupService, "execute"> as SyncProviderGatewayWarmupService;

  const service = new ApplyAssistantPublishedVersionService(
    assistantRepository,
    materializedSpecRepository,
    appendAudit,
    materializeService,
    syncNativeRuntimeBundleService,
    syncProviderGatewayWarmupService
  );

  await service.execute("user-1", publishedVersion, true);

  assert.deepEqual(syncedInput, {
    materializedSpec,
    runtimeTier: "paid_shared_restricted"
  });
  assert.deepEqual(warmedProviderGatewayInput, {
    materializedSpec
  });
  assert.deepEqual(markApplySucceededArgs, ["user-1", "version-1"]);
  assert.equal(markApplyDegradedArgs, null);
  assert.equal(auditEvents.length, 2);
  assert.deepEqual((auditEvents[1] as { details: unknown }).details, {
    publishedVersionId: "version-1",
    reapply: true,
    contentHash: "content-hash-1",
    nativeRuntimeBundleSync: "warmed",
    providerGatewayWarmup: "warmed"
  });
}

async function runDegradedWarmCase(): Promise<void> {
  let markApplySucceededCalled = false;
  let markApplyDegradedArgs: [string, string, string, string] | null = null;
  const auditEvents: unknown[] = [];

  const assistantRepository = {
    markApplyInProgress: async () => assistant,
    markApplySucceeded: async () => {
      markApplySucceededCalled = true;
      return assistant;
    },
    markApplyDegraded: async (
      userId: string,
      targetVersionId: string,
      errorCode: string,
      errorMessage: string
    ) => {
      markApplyDegradedArgs = [userId, targetVersionId, errorCode, errorMessage];
      return assistant;
    },
    markApplyFailed: async () => assistant
  } as Pick<
    AssistantRepository,
    "markApplyInProgress" | "markApplySucceeded" | "markApplyDegraded" | "markApplyFailed"
  > as AssistantRepository;

  const materializedSpecRepository = {
    findByPublishedVersionId: async () => materializedSpec
  } as Pick<
    AssistantMaterializedSpecRepository,
    "findByPublishedVersionId"
  > as AssistantMaterializedSpecRepository;

  const appendAudit = {
    execute: async (event: unknown) => {
      auditEvents.push(event);
    }
  } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService;

  const materializeService = {
    execute: async () => undefined
  } as Pick<
    MaterializeAssistantPublishedVersionService,
    "execute"
  > as MaterializeAssistantPublishedVersionService;

  const syncNativeRuntimeBundleService = {
    execute: async () => {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime bundle sync failed with HTTP 503."
      );
    }
  } as Pick<SyncNativeRuntimeBundleService, "execute"> as SyncNativeRuntimeBundleService;

  const syncProviderGatewayWarmupService = {
    execute: async () => "skipped_unconfigured" as const
  } as Pick<SyncProviderGatewayWarmupService, "execute"> as SyncProviderGatewayWarmupService;

  const service = new ApplyAssistantPublishedVersionService(
    assistantRepository,
    materializedSpecRepository,
    appendAudit,
    materializeService,
    syncNativeRuntimeBundleService,
    syncProviderGatewayWarmupService
  );

  await service.execute("user-1", publishedVersion, false);

  assert.equal(markApplySucceededCalled, false);
  assert.deepEqual(markApplyDegradedArgs, [
    "user-1",
    "version-1",
    "runtime_degraded",
    "Native runtime bundle sync failed with HTTP 503."
  ]);
  assert.equal(auditEvents.length, 2);
  assert.equal(
    (auditEvents[1] as { eventCode: string }).eventCode,
    "assistant.runtime.apply_degraded"
  );
}

async function runProviderGatewayDegradedCase(): Promise<void> {
  let markApplySucceededCalled = false;
  let markApplyDegradedArgs: [string, string, string, string] | null = null;
  const auditEvents: unknown[] = [];

  const assistantRepository = {
    markApplyInProgress: async () => assistant,
    markApplySucceeded: async () => {
      markApplySucceededCalled = true;
      return assistant;
    },
    markApplyDegraded: async (
      userId: string,
      targetVersionId: string,
      errorCode: string,
      errorMessage: string
    ) => {
      markApplyDegradedArgs = [userId, targetVersionId, errorCode, errorMessage];
      return assistant;
    },
    markApplyFailed: async () => assistant
  } as Pick<
    AssistantRepository,
    "markApplyInProgress" | "markApplySucceeded" | "markApplyDegraded" | "markApplyFailed"
  > as AssistantRepository;

  const materializedSpecRepository = {
    findByPublishedVersionId: async () => materializedSpec
  } as Pick<
    AssistantMaterializedSpecRepository,
    "findByPublishedVersionId"
  > as AssistantMaterializedSpecRepository;

  const appendAudit = {
    execute: async (event: unknown) => {
      auditEvents.push(event);
    }
  } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService;

  const materializeService = {
    execute: async () => undefined
  } as Pick<
    MaterializeAssistantPublishedVersionService,
    "execute"
  > as MaterializeAssistantPublishedVersionService;

  const syncNativeRuntimeBundleService = {
    execute: async () => "warmed" as const
  } as Pick<SyncNativeRuntimeBundleService, "execute"> as SyncNativeRuntimeBundleService;

  const syncProviderGatewayWarmupService = {
    execute: async () => {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Provider gateway warmup failed with HTTP 503."
      );
    }
  } as Pick<SyncProviderGatewayWarmupService, "execute"> as SyncProviderGatewayWarmupService;

  const service = new ApplyAssistantPublishedVersionService(
    assistantRepository,
    materializedSpecRepository,
    appendAudit,
    materializeService,
    syncNativeRuntimeBundleService,
    syncProviderGatewayWarmupService
  );

  await service.execute("user-1", publishedVersion, false);

  assert.equal(markApplySucceededCalled, false);
  assert.deepEqual(markApplyDegradedArgs, [
    "user-1",
    "version-1",
    "runtime_degraded",
    "Provider gateway warmup failed with HTTP 503."
  ]);
  assert.equal(auditEvents.length, 2);
  assert.equal(
    (auditEvents[1] as { eventCode: string }).eventCode,
    "assistant.runtime.apply_degraded"
  );
}

async function run(): Promise<void> {
  await runSuccessCase();
  await runDegradedWarmCase();
  await runProviderGatewayDegradedCase();
}

void run();
