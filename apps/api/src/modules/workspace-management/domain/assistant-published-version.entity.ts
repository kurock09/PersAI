export type AssistantPublishedVersion = {
  id: string;
  assistantId: string;
  version: number;
  snapshotDisplayName: string | null;
  snapshotInstructions: string | null;
  snapshotTraits: Record<string, number> | null;
  snapshotAvatarEmoji: string | null;
  snapshotAvatarUrl: string | null;
  publishedByUserId: string;
  createdAt: Date;
};
