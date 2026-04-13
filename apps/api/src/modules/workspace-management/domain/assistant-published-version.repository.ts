import type { AssistantPublishedVersion } from "./assistant-published-version.entity";
import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

export const ASSISTANT_PUBLISHED_VERSION_REPOSITORY = Symbol(
  "ASSISTANT_PUBLISHED_VERSION_REPOSITORY"
);

export interface CreateAssistantPublishedVersionInput {
  assistantId: string;
  publishedByUserId: string;
  snapshotDisplayName: string | null;
  snapshotInstructions: string | null;
  snapshotTraits?: Record<string, number> | null;
  snapshotAvatarEmoji?: string | null;
  snapshotAvatarUrl?: string | null;
  snapshotAssistantGender?: string | null;
  snapshotVoiceProfile?: RuntimeAssistantVoiceProfile | null;
}

export interface AssistantPublishedVersionRepository {
  findLatestByAssistantId(assistantId: string): Promise<AssistantPublishedVersion | null>;
  findByAssistantIdAndVersion(
    assistantId: string,
    version: number
  ): Promise<AssistantPublishedVersion | null>;
  create(input: CreateAssistantPublishedVersionInput): Promise<AssistantPublishedVersion>;
}
