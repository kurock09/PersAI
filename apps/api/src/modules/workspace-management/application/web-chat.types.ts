export type AssistantChatSurfaceState = "web" | "telegram";

export type AssistantChatMessageAuthorState = "user" | "assistant" | "system";

export interface AssistantWebChatState {
  id: string;
  assistantId: string;
  surface: AssistantChatSurfaceState;
  surfaceThreadKey: string;
  title: string | null;
  archivedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantWebChatMessageAttachmentState {
  id: string;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  createdAt: string;
}

export interface AssistantWebChatMessageState {
  id: string;
  chatId: string;
  assistantId: string;
  author: AssistantChatMessageAuthorState;
  content: string;
  attachments: AssistantWebChatMessageAttachmentState[];
  createdAt: string;
}

export interface AssistantWebChatTurnState {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistantMessage: AssistantWebChatMessageState;
  runtime: {
    respondedAt: string;
    degradedByQuotaFallback: boolean;
    quotaFallbackReason: "token_budget_limit_reached" | "cost_driving_quota_limit_reached" | null;
    quotaFallbackModel: string | null;
  };
}

export interface AssistantWebChatListItemState {
  chat: AssistantWebChatState;
  messageCount: number;
  lastMessagePreview: string | null;
}
