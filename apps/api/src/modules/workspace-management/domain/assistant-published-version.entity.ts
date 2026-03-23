export type AssistantPublishedVersion = {
  id: string;
  assistantId: string;
  version: number;
  snapshotDisplayName: string | null;
  snapshotInstructions: string | null;
  publishedByUserId: string;
  createdAt: Date;
};
