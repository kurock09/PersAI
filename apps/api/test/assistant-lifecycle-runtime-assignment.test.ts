import assert from "node:assert/strict";
import { toAssistantLifecycleState } from "../src/modules/workspace-management/application/assistant-lifecycle.mapper";
import type { AssistantGovernance } from "../src/modules/workspace-management/domain/assistant-governance.entity";
import type { AssistantMaterializedSpec } from "../src/modules/workspace-management/domain/assistant-materialized-spec.entity";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";

async function run(): Promise<void> {
  const assistant: Assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: "Mira",
    draftInstructions: "Be warm.",
    draftTraits: { warmth: 90 },
    draftAvatarEmoji: "🙂",
    draftAvatarUrl: null,
    draftAssistantGender: "female",
    draftUpdatedAt: new Date("2026-04-04T10:00:00.000Z"),
    applyStatus: "succeeded",
    applyTargetVersionId: "pub-1",
    applyAppliedVersionId: "pub-1",
    applyRequestedAt: new Date("2026-04-04T10:01:00.000Z"),
    applyStartedAt: new Date("2026-04-04T10:02:00.000Z"),
    applyFinishedAt: new Date("2026-04-04T10:03:00.000Z"),
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    createdAt: new Date("2026-04-04T09:00:00.000Z"),
    updatedAt: new Date("2026-04-04T10:03:00.000Z")
  };

  const governance: AssistantGovernance = {
    id: "gov-1",
    assistantId: assistant.id,
    capabilityEnvelope: null,
    secretRefs: null,
    policyEnvelope: {
      runtimeAssignment: {
        schema: "persai.runtimeAssignmentPolicy.v1",
        runtimeTierOverride: "paid_isolated"
      }
    },
    memoryControl: null,
    tasksControl: null,
    quotaPlanCode: "starter_trial",
    quotaHook: null,
    auditHook: null,
    createdAt: new Date("2026-04-04T09:00:00.000Z"),
    updatedAt: new Date("2026-04-04T10:03:00.000Z")
  };

  const materialization: AssistantMaterializedSpec = {
    id: "spec-1",
    assistantId: assistant.id,
    publishedVersionId: "pub-1",
    sourceAction: "publish",
    algorithmVersion: 1,
    materializedAtConfigGeneration: 7,
    layers: {
      schema: "persai.materialization.v1",
      layers: {
        governance: {
          runtimeAssignment: {
            schema: "persai.runtimeAssignment.v1",
            planDefaultTier: "paid_shared_restricted",
            runtimeTierOverride: "paid_isolated",
            effectiveTier: "paid_isolated",
            source: "assistant_override"
          }
        }
      }
    },
    runtimeBundle: null,
    assistantConfig: {},
    assistantWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: null,
    runtimeBundleHash: null,
    assistantConfigDocument: "{}",
    assistantWorkspaceDocument: "{}",
    contentHash: "hash-1",
    createdAt: new Date("2026-04-04T10:03:00.000Z")
  };

  const state = toAssistantLifecycleState(assistant, null, governance, materialization);

  assert.equal(state.governance.runtimeTierOverride, "paid_isolated");
  assert.deepEqual(state.materialization.runtimeAssignment, {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier: "paid_shared_restricted",
    runtimeTierOverride: "paid_isolated",
    effectiveTier: "paid_isolated",
    source: "assistant_override"
  });
}

void run();
