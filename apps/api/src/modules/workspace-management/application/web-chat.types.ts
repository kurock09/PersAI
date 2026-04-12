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
    quotaFallbackReason: "token_budget_limit_reached" | null;
    quotaFallbackModel: string | null;
  };
}

export interface AssistantWebChatCompactionState {
  available: boolean;
  suggested: boolean;
  suggestionReason: "token_threshold" | "history_threshold" | "latency_threshold" | null;
  messageCount: number;
  assistantMessageCount: number;
  currentTokens: number | null;
  sessionKey: string | null;
  compactionCount: number;
  lastCompactedAt: string | null;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface AssistantWebChatCompactionResult {
  compacted: boolean;
  reason: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
}

export interface AssistantWebChatListItemState {
  chat: AssistantWebChatState;
  messageCount: number;
  lastMessagePreview: string | null;
}
