import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PublishAssistantDraftService } from "../src/modules/workspace-management/application/publish-assistant-draft.service";

function createAssistant() {
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: "PersAI Bot",
    draftInstructions: "Be helpful.",
    draftTraits: { warmth: 80 },
    draftAvatarEmoji: null,
    draftAvatarUrl: "https://persai.dev/api/v1/assistant/avatar",
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftUpdatedAt: new Date("2026-04-20T00:00:00.000Z"),
    applyStatus: "succeeded" as const,
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    sandboxEgressMode: "restricted",
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z")
  };
}

describe("PublishAssistantDraftService", () => {
  test("syncs Telegram bot profile name and avatar on publish", async () => {
    const assistant = createAssistant();
    const publishedVersion = {
      id: "pub-1",
      assistantId: assistant.id,
      version: 3,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl,
      snapshotAssistantGender: assistant.draftAssistantGender,
      snapshotVoiceProfile: assistant.draftVoiceProfile,
      publishedByUserId: assistant.userId,
      createdAt: new Date("2026-04-20T00:00:01.000Z")
    };

    const patchedMetadata: Record<string, unknown>[] = [];
    const botProfileNames: string[] = [];
    const botProfilePhotos: Array<{ botToken: string; filename: string; size: number }> = [];
    let resolveActiveAssistantCalls = 0;

    const service = new PublishAssistantDraftService(
      {
        async markApplyPendingByAssistantId() {
          return assistant;
        },
        async findById() {
          return assistant;
        }
      } as never,
      {
        async create() {
          return publishedVersion;
        }
      } as never,
      {
        async findByAssistantId() {
          return null;
        }
      } as never,
      {
        async findLatestByAssistantId() {
          return null;
        }
      } as never,
      {
        async findByAssistantProviderSurface() {
          return {
            id: "binding-1",
            assistantId: assistant.id,
            providerKey: "telegram",
            surfaceType: "telegram_bot",
            bindingState: "active",
            tokenFingerprint: "fp",
            tokenLastFour: "1234",
            policy: null,
            config: null,
            metadata: {},
            connectedAt: new Date("2026-04-20T00:00:00.000Z"),
            disconnectedAt: null,
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            updatedAt: new Date("2026-04-20T00:00:00.000Z")
          };
        },
        async patchMetadata(
          _assistantId: string,
          _providerKey: string,
          _surfaceType: string,
          patch: Record<string, unknown>
        ) {
          patchedMetadata.push(patch);
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            assistantId: assistant.id,
            workspaceId: assistant.workspaceId,
            locale: "en" as const,
            botToken: "bot-token",
            botUserId: 1,
            botUsername: "persai_bot",
            inbound: true,
            outbound: true,
            groupReplyMode: "mention_reply" as const,
            parseMode: "markdown",
            defaultDeepModeEnabled: false,
            accessMode: "owner_only",
            ownerClaimStatus: "claimed",
            ownerClaimCode: null,
            ownerClaimCodeExpiresAt: null,
            ownerTelegramUserId: 11,
            ownerTelegramUsername: "alex",
            ownerTelegramChatId: "chat-1",
            runtimeHealth: "ok" as const,
            webhookSecret: null
          };
        }
      } as never,
      {
        async setBotProfileName(_botToken: string, name: string) {
          botProfileNames.push(name);
        },
        async setBotProfilePhoto(input: { botToken: string; buffer: Buffer; filename: string }) {
          botProfilePhotos.push({
            botToken: input.botToken,
            filename: input.filename,
            size: input.buffer.length
          });
        }
      } as never,
      {
        buildAssistantPrefix(assistantId: string) {
          return `assistant-media/assistants/${assistantId}/`;
        },
        async downloadObject(path: string) {
          assert.equal(path, "assistant-media/assistants/assistant-1/avatar/current");
          return {
            buffer: Buffer.from("avatar-bytes"),
            contentType: "image/png"
          };
        }
      } as never,
      {
        async findByKey() {
          return null;
        }
      } as never,
      {
        async execute() {
          resolveActiveAssistantCalls += 1;
          return { assistantId: assistant.id, assistant };
        }
      } as never
    );

    const result = await service.execute("user-1");

    assert.equal(resolveActiveAssistantCalls, 1);
    assert.equal(result.latestPublishedVersion?.id, "pub-1");
    assert.deepEqual(patchedMetadata, [
      {
        displayName: "PersAI Bot",
        avatarUrl: "https://persai.dev/api/v1/assistant/avatar"
      }
    ]);
    assert.deepEqual(botProfileNames, ["PersAI Bot"]);
    assert.deepEqual(botProfilePhotos, [
      {
        botToken: "bot-token",
        filename: "assistant-avatar.png",
        size: Buffer.from("avatar-bytes").length
      }
    ]);
  });

  test("syncs Telegram bot profile photo from preset avatars on publish", async () => {
    const assistant = {
      ...createAssistant(),
      draftAvatarUrl: "/avatar-presets/persai.png"
    };
    const publishedVersion = {
      id: "pub-1",
      assistantId: assistant.id,
      version: 3,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl,
      snapshotAssistantGender: assistant.draftAssistantGender,
      snapshotVoiceProfile: assistant.draftVoiceProfile,
      publishedByUserId: assistant.userId,
      createdAt: new Date("2026-04-20T00:00:01.000Z")
    };

    const patchedMetadata: Record<string, unknown>[] = [];
    const botProfilePhotos: Array<{ botToken: string; filename: string; size: number }> = [];

    const service = new PublishAssistantDraftService(
      {
        async markApplyPendingByAssistantId() {
          return assistant;
        },
        async findById() {
          return assistant;
        }
      } as never,
      {
        async create() {
          return publishedVersion;
        }
      } as never,
      {
        async findByAssistantId() {
          return null;
        }
      } as never,
      {
        async findLatestByAssistantId() {
          return null;
        }
      } as never,
      {
        async findByAssistantProviderSurface() {
          return {
            id: "binding-1",
            assistantId: assistant.id,
            providerKey: "telegram",
            surfaceType: "telegram_bot",
            bindingState: "active",
            tokenFingerprint: "fp",
            tokenLastFour: "1234",
            policy: null,
            config: null,
            metadata: {},
            connectedAt: new Date("2026-04-20T00:00:00.000Z"),
            disconnectedAt: null,
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            updatedAt: new Date("2026-04-20T00:00:00.000Z")
          };
        },
        async patchMetadata(
          _assistantId: string,
          _providerKey: string,
          _surfaceType: string,
          patch: Record<string, unknown>
        ) {
          patchedMetadata.push(patch);
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never,
      {
        async execute() {
          return undefined;
        }
      } as never,
      {
        async resolveByAssistantId() {
          return {
            assistantId: assistant.id,
            workspaceId: assistant.workspaceId,
            locale: "en" as const,
            botToken: "bot-token",
            botUserId: 1,
            botUsername: "persai_bot",
            inbound: true,
            outbound: true,
            groupReplyMode: "mention_reply" as const,
            parseMode: "markdown",
            defaultDeepModeEnabled: false,
            accessMode: "owner_only",
            ownerClaimStatus: "claimed",
            ownerClaimCode: null,
            ownerClaimCodeExpiresAt: null,
            ownerTelegramUserId: 11,
            ownerTelegramUsername: "alex",
            ownerTelegramChatId: "chat-1",
            runtimeHealth: "ok" as const,
            webhookSecret: null
          };
        }
      } as never,
      {
        async setBotProfileName() {
          return undefined;
        },
        async setBotProfilePhoto(input: { botToken: string; buffer: Buffer; filename: string }) {
          botProfilePhotos.push({
            botToken: input.botToken,
            filename: input.filename,
            size: input.buffer.length
          });
        }
      } as never,
      {
        buildAssistantPrefix(assistantId: string) {
          return `assistant-media/assistants/${assistantId}/`;
        },
        async downloadObject() {
          throw new Error("preset avatars should not read assistant object storage");
        }
      } as never,
      {
        async findByKey() {
          return null;
        }
      } as never,
      {
        async execute() {
          return { assistantId: assistant.id, assistant };
        }
      } as never
    );

    const result = await service.execute("user-1");

    assert.equal(result.latestPublishedVersion?.id, "pub-1");
    assert.deepEqual(patchedMetadata, [
      {
        displayName: "PersAI Bot",
        avatarUrl: "/avatar-presets/persai.png"
      }
    ]);
    assert.equal(botProfilePhotos.length, 1);
    assert.equal(botProfilePhotos[0]?.botToken, "bot-token");
    assert.equal(botProfilePhotos[0]?.filename, "assistant-avatar.png");
    assert.ok((botProfilePhotos[0]?.size ?? 0) > 0);
  });
});
