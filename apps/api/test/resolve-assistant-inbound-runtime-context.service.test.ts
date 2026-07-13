import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ResolveAssistantInboundRuntimeContextService } from "../src/modules/workspace-management/application/resolve-assistant-inbound-runtime-context.service";

function createAssistant(id: string) {
  return {
    id,
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded" as const,
    applyTargetVersionId: "pub-1",
    applyAppliedVersionId: "pub-1",
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    sandboxEgressMode: "restricted",
    createdAt: new Date("2026-05-26T12:00:00.000Z"),
    updatedAt: new Date("2026-05-26T12:00:00.000Z")
  };
}

describe("ResolveAssistantInboundRuntimeContextService", () => {
  test("resolves runtime context from the active assistant instead of legacy user-only lookup", async () => {
    const activeAssistant = createAssistant("assistant-2");
    let latestPublishedLookupAssistantId: string | null = null;
    const service = new ResolveAssistantInboundRuntimeContextService(
      {
        findById: async () => activeAssistant
      } as never,
      {
        findLatestByAssistantId: async (assistantId: string) => {
          latestPublishedLookupAssistantId = assistantId;
          return { id: "pub-1" };
        }
      } as never,
      {
        resolveFreshness: async () => ({
          activationBlock: null,
          materializedSpec: {
            layers: null,
            runtimeBundle: {
              promptConstructor: {
                onboarding: {
                  welcomeTurnPrompt: "Welcome from assistant B"
                }
              }
            }
          }
        })
      } as never,
      {
        execute: async ({ userId }: { userId: string }) => {
          assert.equal(userId, "user-1");
          return {
            assistantId: activeAssistant.id,
            assistant: activeAssistant
          };
        }
      } as never
    );

    const resolved = await service.resolveByUserId("user-1");

    assert.equal(latestPublishedLookupAssistantId, "assistant-2");
    assert.equal(resolved.assistantId, "assistant-2");
    assert.equal(resolved.assistant.id, "assistant-2");
    assert.equal(resolved.publishedVersionId, "pub-1");
    assert.equal(resolved.welcomeFirstTurnPrompt, "Welcome from assistant B");
  });
});
