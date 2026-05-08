export type AssistantChatSurfaceState = "web" | "telegram";

export type AssistantChatMessageAuthorState = "user" | "assistant" | "system";

export interface AssistantWebChatState {
  id: string;
  assistantId: string;
  surface: AssistantChatSurfaceState;
  surfaceThreadKey: string;
  title: string | null;
  deepModeEnabled: boolean;
  skillDecisionState: {
    status: "inactive" | "active";
    activeSkillId: string | null;
    activeSkillName: string | null;
    topicSummary: string | null;
    confidence: "low" | "medium" | "high";
    checkedAtMessageIndex: number;
  } | null;
  skillCadenceState: {
    messageCountSinceCheck: number;
    backgroundCheckQueuedAtMessageIndex?: number | null;
    needsBootstrap: boolean;
    bootstrapReason?: "new_chat" | "skills_enabled_after_chat_started" | "migration_repair" | null;
  } | null;
  archivedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantWebChatMessageAttachmentState {
  id: string;
  fileRef: string | null;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  fileDeleted?: boolean;
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

export interface AssistantWebChatTurnRoutingState {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";
  source: "precheck" | "llm" | "fallback";
  retrievalPlan?: {
    useSkills: boolean;
    selectedSkillIds: string[];
    useUserKnowledge: boolean;
    useProductKnowledge: boolean;
    useWeb: boolean;
    ordinarySourcePriorityMode:
      | "personal_first"
      | "product_first"
      | "web_first"
      | "mixed_ambiguous"
      | "not_applicable";
    confidence: "low" | "medium" | "high";
    reasonCode: string;
  } | null;
  skillState?: {
    status: "inactive" | "active";
    activeSkillId: string | null;
    activeSkillName: string | null;
    topicSummary: string | null;
    confidence: "low" | "medium" | "high";
    checkedAtMessageIndex: number;
  } | null;
}

export interface AssistantWebChatTurnState {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistantMessage: AssistantWebChatMessageState;
  followUpAssistantMessage?: AssistantWebChatMessageState;
  activeMediaJobs?: AssistantWebChatActiveMediaJobState[];
  runtime: {
    respondedAt: string;
    degradedByQuotaFallback: boolean;
    quotaFallbackReason: "token_budget_limit_reached" | null;
    quotaFallbackModel: string | null;
    turnRouting?: AssistantWebChatTurnRoutingState | null;
  };
}

export interface AssistantWebChatTurnCurrentActivityState {
  type: "tool_use";
  toolName: string;
  toolCallId: string;
  phase: "start" | "end";
  isError: boolean;
  updatedAt: string;
}

export type AssistantWebChatActiveTurnStatus = "accepted" | "running";

export interface AssistantWebChatCompactActiveTurnState {
  clientTurnId: string;
  status: AssistantWebChatActiveTurnStatus;
  updatedAt: string;
  currentActivity: AssistantWebChatTurnCurrentActivityState | null;
  pendingUserMessageId: string | null;
  assistantMessageId: string | null;
}

export interface AssistantWebChatActiveTurnState extends AssistantWebChatCompactActiveTurnState {
  chat: AssistantWebChatState | null;
  userMessage: AssistantWebChatMessageState | null;
  assistantMessage: AssistantWebChatMessageState | null;
  canReattach: boolean;
}

export type AssistantWebChatActiveMediaJobKind = "image" | "audio" | "video";

export type AssistantWebChatActiveMediaJobStatus = "queued" | "running" | "completion_pending";

export type AssistantWebChatActiveMediaJobOperation =
  | "image_generate"
  | "image_edit"
  | "video_generate"
  | "audio_generate";

export interface AssistantWebChatActiveMediaJobState {
  id: string;
  kind: AssistantWebChatActiveMediaJobKind;
  operation: AssistantWebChatActiveMediaJobOperation;
  status: AssistantWebChatActiveMediaJobStatus;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
}

export interface AssistantWebChatCompactionState {
  available: boolean;
  suggested: boolean;
  suggestionReason: "token_threshold" | "history_threshold" | null;
  messageCount: number;
  assistantMessageCount: number;
  currentTokens: number | null;
  sessionKey: string | null;
  compactionCount: number;
  lastCompactedAt: string | null;
  reserveTokens: number;
  keepRecentTokens: number;
  autoCompactionEnabled: boolean;
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
  activeTurn: AssistantWebChatCompactActiveTurnState | null;
  activeMediaJobs?: AssistantWebChatActiveMediaJobState[];
}
