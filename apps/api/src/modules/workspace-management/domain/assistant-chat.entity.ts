export type AssistantChatSurface = "web" | "telegram";

export type AssistantChat = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AssistantChatSurface;
  surfaceThreadKey: string;
  title: string | null;
  deepModeEnabled: boolean;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
