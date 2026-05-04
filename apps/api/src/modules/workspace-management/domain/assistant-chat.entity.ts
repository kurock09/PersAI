export type AssistantChatSurface = "web" | "telegram";

export type AssistantChatAutoSkillRoutingState = {
  status: "inactive" | "active";
  activeSkillId: string | null;
  activeSkillName: string | null;
  topicSummary: string | null;
  confidence: "low" | "medium" | "high";
  checkedAtMessageIndex: number;
  messageCountSinceCheck: number;
  backgroundCheckQueuedAtMessageIndex?: number | null;
};

export type AssistantChat = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AssistantChatSurface;
  surfaceThreadKey: string;
  title: string | null;
  deepModeEnabled: boolean;
  autoSkillRoutingState: AssistantChatAutoSkillRoutingState | null;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
