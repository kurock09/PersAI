import assert from "node:assert/strict";
import { EnsureAssistantMaterializedSpecCurrentService } from "../src/modules/workspace-management/application/ensure-assistant-materialized-spec-current.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type { AssistantPublishedVersion } from "../src/modules/workspace-management/domain/assistant-published-version.entity";
import type { AssistantMaterializedSpec } from "../src/modules/workspace-management/domain/assistant-materialized-spec.entity";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";
import type { AssistantPublishedVersionRepository } from "../src/modules/workspace-management/domain/assistant-published-version.repository";
import type { MaterializeAssistantPublishedVersionService } from "../src/modules/workspace-management/application/materialize-assistant-published-version.service";
import type { BumpConfigGenerationService } from "../src/modules/workspace-management/application/bump-config-generation.service";

function createAssistant(overrides?: Partial<Assistant>): Assistant {
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    displayName: "PersAI",
    locale: "en",
    timezone: "UTC",
    assistantGender: null,
    avatarEmoji: null,
    avatarUrl: null,
    personalityTraits: null,
    customInstructions: null,
    voiceProfileJson: null,
    previewVoiceProfileJson: null,
    promptConstructorConfigJson: null,
    replySafetyMode: null,
    taskPolicyJson: null,
    memoryPolicyJson: null,
    applyStatus: "succeeded",
    applyLastErrorCode: null,
    applyLastErrorMessage: null,
    applyAppliedVersionId: "version-1",
    configDirtyAt: null,
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    updatedAt: new Date("2026-04-18T10:00:00.000Z"),
    ...overrides
  };
}

function createPublishedVersion(): AssistantPublishedVersion {
  return {
    id: "version-1",
    assistantId: "assistant-1",
    version: 1,
    changeSummary: "published",
    publishedAt: new Date("2026-04-18T10:00:00.000Z")
  };
}

function createMaterializedSpec(
  overrides?: Partial<AssistantMaterializedSpec>
): AssistantMaterializedSpec {
  return {
    id: "spec-1",
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    sourceAction: "publish",
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    materializedAtConfigGeneration: 5,
    layers: null,
    runtimeBundle: null,
    assistantConfig: {},
    assistantWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: '{"metadata":{"assistantId":"assistant-1"}}',
    runtimeBundleHash: "bundle-hash-1",
    assistantConfigDocument: "{}",
    assistantWorkspaceDocument: "{}",
    contentHash: "content-hash-1",
    ...overrides
  };
}

export async function runEnsureAssistantMaterializedSpecCurrentServiceTest(): Promise<void> {
  const latestPublished = createPublishedVersion();
  let latestSpec = createMaterializedSpec();
  let materializeCalls = 0;

  const service = new EnsureAssistantMaterializedSpecCurrentService(
    {
      async findLatestByAssistantId() {
        return latestSpec;
      },
      async findByPublishedVersionId() {
        return latestSpec;
      }
    } as AssistantMaterializedSpecRepository,
    {
      async findLatestByAssistantId() {
        return latestPublished;
      }
    } as AssistantPublishedVersionRepository,
    {
      async execute() {
        materializeCalls += 1;
        latestSpec = createMaterializedSpec({
          id: `spec-${String(materializeCalls + 1)}`,
          createdAt: new Date("2026-04-18T10:10:00.000Z"),
          materializedAtConfigGeneration: 6,
          runtimeBundleHash: `bundle-hash-${String(materializeCalls + 1)}`,
          contentHash: `content-hash-${String(materializeCalls + 1)}`
        });
      }
    } as unknown as MaterializeAssistantPublishedVersionService,
    {
      async current() {
        return 6;
      }
    } as BumpConfigGenerationService
  );

  const staleAssistant = createAssistant();
  const staleResult = await service.resolveFreshness(staleAssistant, latestPublished);
  assert.equal(staleResult.refreshed, true);
  assert.equal(staleResult.materializedSpec?.materializedAtConfigGeneration, 6);
  assert.equal(materializeCalls, 1);

  const freshAssistant = createAssistant();
  const freshResult = await service.resolveFreshness(freshAssistant, latestPublished);
  assert.equal(freshResult.refreshed, false);
  assert.equal(freshResult.materializedSpec?.id, latestSpec.id);
  assert.equal(materializeCalls, 1);

  const dirtyAssistant = createAssistant({
    configDirtyAt: new Date("2026-04-18T10:20:00.000Z")
  });
  const dirtyResult = await service.resolveFreshness(dirtyAssistant, latestPublished);
  assert.equal(dirtyResult.refreshed, true);
  assert.equal(materializeCalls, 2);
  assert.equal(dirtyResult.materializedSpec?.publishedVersionId, latestPublished.id);
}

void runEnsureAssistantMaterializedSpecCurrentServiceTest();
