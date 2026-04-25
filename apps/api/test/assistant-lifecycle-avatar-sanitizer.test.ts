import assert from "node:assert/strict";
import {
  toAssistantLifecycleState,
  toAssistantPublishedVersionState
} from "../src/modules/workspace-management/application/assistant-lifecycle.mapper";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

  const baseAssistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    draftDisplayName: "Sage",
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null as string | null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftArchetypeKey: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded" as const,
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z")
  };

  const legacyState = toAssistantLifecycleState(
    {
      ...baseAssistant,
      draftAvatarUrl: "https://api.legacy.example.com/api/v1/assistant/avatar"
    } as never,
    null,
    null,
    null
  );
  assert.equal(legacyState.draft.avatarUrl, null);

  const newState = toAssistantLifecycleState(
    {
      ...baseAssistant,
      draftAvatarUrl: "/api/avatar/abcdef0123456789.png"
    } as never,
    null,
    null,
    null
  );
  assert.equal(newState.draft.avatarUrl, "/api/avatar/abcdef0123456789.png");

  const publishedLegacy = toAssistantPublishedVersionState({
    id: "v-1",
    version: 1,
    publishedByUserId: "user-1",
    snapshotDisplayName: "Sage",
    snapshotInstructions: null,
    snapshotTraits: null,
    snapshotAvatarEmoji: null,
    snapshotAvatarUrl: "https://legacy.example.com/avatar",
    snapshotAssistantGender: null,
    snapshotVoiceProfile: null,
    snapshotArchetypeKey: null,
    createdAt: new Date("2026-01-01T00:00:00Z")
  } as never);
  assert.equal(publishedLegacy.snapshot.avatarUrl, null);

  const publishedNew = toAssistantPublishedVersionState({
    id: "v-1",
    version: 1,
    publishedByUserId: "user-1",
    snapshotDisplayName: "Sage",
    snapshotInstructions: null,
    snapshotTraits: null,
    snapshotAvatarEmoji: null,
    snapshotAvatarUrl: "/api/avatar/0123456789abcdef.jpg",
    snapshotAssistantGender: null,
    snapshotVoiceProfile: null,
    snapshotArchetypeKey: null,
    createdAt: new Date("2026-01-01T00:00:00Z")
  } as never);
  assert.equal(publishedNew.snapshot.avatarUrl, "/api/avatar/0123456789abcdef.jpg");
}

void run();
