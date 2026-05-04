import assert from "node:assert/strict";
import { MaterializeWorkspacePaidActivationService } from "../src/modules/workspace-management/application/materialize-workspace-paid-activation.service";

async function run(): Promise<void> {
  const ensuredAssistantIds: string[] = [];
  const warmedBundleIds: string[] = [];
  const warmedGatewayIds: string[] = [];

  const assistants = {
    "assistant-1": {
      id: "assistant-1",
      userId: "user-1",
      workspaceId: "ws-1",
      draftDisplayName: null,
      draftInstructions: null,
      draftTraits: null,
      draftAvatarEmoji: null,
      draftAvatarUrl: null,
      draftAssistantGender: null,
      draftVoiceProfile: null,
      draftArchetypeKey: null,
      draftUpdatedAt: null,
      applyStatus: "succeeded" as const,
      applyTargetVersionId: null,
      applyAppliedVersionId: "pub-1",
      applyRequestedAt: null,
      applyStartedAt: null,
      applyFinishedAt: null,
      applyErrorCode: null,
      applyErrorMessage: null,
      configDirtyAt: new Date("2026-05-04T20:00:00.000Z"),
      createdAt: new Date("2026-05-04T19:00:00.000Z"),
      updatedAt: new Date("2026-05-04T20:00:00.000Z")
    },
    "assistant-2": {
      id: "assistant-2",
      userId: "user-2",
      workspaceId: "ws-1",
      draftDisplayName: null,
      draftInstructions: null,
      draftTraits: null,
      draftAvatarEmoji: null,
      draftAvatarUrl: null,
      draftAssistantGender: null,
      draftVoiceProfile: null,
      draftArchetypeKey: null,
      draftUpdatedAt: null,
      applyStatus: "succeeded" as const,
      applyTargetVersionId: null,
      applyAppliedVersionId: "pub-2",
      applyRequestedAt: null,
      applyStartedAt: null,
      applyFinishedAt: null,
      applyErrorCode: null,
      applyErrorMessage: null,
      configDirtyAt: new Date("2026-05-04T20:00:00.000Z"),
      createdAt: new Date("2026-05-04T19:00:00.000Z"),
      updatedAt: new Date("2026-05-04T20:00:00.000Z")
    }
  };

  const service = new MaterializeWorkspacePaidActivationService(
    {
      assistant: {
        async findMany(args: { where: { workspaceId: string } }) {
          assert.equal(args.where.workspaceId, "ws-1");
          return [{ id: "assistant-1" }, { id: "assistant-2" }, { id: "assistant-3" }];
        }
      }
    } as never,
    {
      async findById(id: string) {
        return assistants[id as keyof typeof assistants] ?? null;
      }
    } as never,
    {
      async findLatestByAssistantId(assistantId: string) {
        if (assistantId === "assistant-3") {
          return null;
        }
        return {
          id: assistantId === "assistant-1" ? "pub-1" : "pub-2",
          assistantId,
          version: 1,
          snapshotDocument: "{}",
          createdAt: new Date("2026-05-04T19:00:00.000Z")
        };
      }
    } as never,
    {
      async resolveFreshness(assistant: { id: string }) {
        ensuredAssistantIds.push(assistant.id);
        if (assistant.id === "assistant-2") {
          throw new Error("runtime warmup precondition failed");
        }
        return {
          currentGeneration: 5,
          latestPublishedVersion: { id: "pub-1" },
          materializedSpec: {
            id: "spec-1",
            assistantId: assistant.id,
            publishedVersionId: "pub-1",
            sourceAction: "publish",
            algorithmVersion: 1,
            materializedAtConfigGeneration: 5,
            layers: {
              layers: {
                governance: {
                  runtimeAssignment: {
                    effectiveTier: "paid_dedicated_standard"
                  }
                }
              }
            },
            runtimeBundle: {
              metadata: {
                workspaceId: "ws-1"
              }
            },
            assistantConfig: {},
            assistantWorkspace: {},
            layersDocument: "{}",
            runtimeBundleDocument: "{}",
            runtimeBundleHash: "bundle-hash-1",
            assistantConfigDocument: "{}",
            assistantWorkspaceDocument: "{}",
            contentHash: "content-hash-1",
            createdAt: new Date("2026-05-04T20:01:00.000Z")
          },
          refreshed: true,
          stale: true,
          specGeneration: 5
        };
      }
    } as never,
    {
      async execute(input: { materializedSpec: { id: string } }) {
        warmedBundleIds.push(input.materializedSpec.id);
        return "warmed";
      }
    } as never,
    {
      async execute(input: { materializedSpec: { id: string } }) {
        warmedGatewayIds.push(input.materializedSpec.id);
        return "warmed";
      }
    } as never
  );

  const result = await service.execute("ws-1");
  assert.deepEqual(result, {
    attemptedAssistants: 2,
    refreshedAssistants: 1,
    failedAssistants: 1
  });
  assert.deepEqual(ensuredAssistantIds, ["assistant-1", "assistant-2"]);
  assert.deepEqual(warmedBundleIds, ["spec-1"]);
  assert.deepEqual(warmedGatewayIds, ["spec-1"]);
}

void run();
