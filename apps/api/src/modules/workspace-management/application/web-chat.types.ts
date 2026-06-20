export type AssistantChatSurfaceState = "web" | "telegram";
export type AssistantChatModeState = "normal" | "smart" | "project";

export type AssistantChatMessageAuthorState = "user" | "assistant" | "system";

export interface AssistantWebChatState {
  id: string;
  assistantId: string;
  surface: AssistantChatSurfaceState;
  surfaceThreadKey: string;
  title: string | null;
  chatMode: AssistantChatModeState;
  deepModeEnabled: boolean;
  skillDecisionState: {
    status: "inactive" | "active";
    activeSkillId: string | null;
    activeSkillName: string | null;
    activeScenarioKey: string | null;
    activeScenarioDisplayName: string | null;
    topicSummary: string | null;
  } | null;
  archivedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantWebChatMessageAttachmentDocumentLink {
  docId: string;
  versionId: string;
  versionNumber: number | null;
  descriptorMode: string | null;
  documentType: string | null;
  documentStatus: string | null;
  versionStatus: string | null;
  isCurrentOutput: boolean;
}

export interface AssistantWebChatMessageAttachmentState {
  id: string;
  fileRef: string | null;
  thumbnailFileRef?: string | null;
  posterFileRef?: string | null;
  derivativesStatus?: "pending" | "ready" | "failed" | null;
  attachmentType: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  fileDeleted?: boolean;
  /** Provider-hosted download URL when the file is too large to persist inline. */
  externalDownloadUrl?: string | null;
  documentLink?: AssistantWebChatMessageAttachmentDocumentLink | null;
  createdAt: string;
}

export interface AssistantWebChatPlatformNoticeState {
  kind: "safety_inbound_warn" | "safety_inbound_restricted";
  reasonCode: string;
}

export interface AssistantWebChatMessageState {
  id: string;
  chatId: string;
  assistantId: string;
  author: AssistantChatMessageAuthorState;
  content: string;
  attachments: AssistantWebChatMessageAttachmentState[];
  createdAt: string;
  platformNotice?: AssistantWebChatPlatformNoticeState;
  /** The texts the model wrote before each tool call across the tool loop. Absent/empty when no tools ran. */
  workingNotes?: string[];
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
    activeScenarioKey: string | null;
    activeScenarioDisplayName: string | null;
    topicSummary: string | null;
  } | null;
}

export interface AssistantWebChatEngagementSummary {
  skillDisplayName: string;
  scenarioDisplayName: string | null;
}

export function deriveEngagementSummary(
  skillDecisionState: AssistantWebChatState["skillDecisionState"]
): AssistantWebChatEngagementSummary | null {
  if (
    skillDecisionState === null ||
    skillDecisionState === undefined ||
    skillDecisionState.status !== "active" ||
    skillDecisionState.activeSkillName === null
  ) {
    return null;
  }
  return {
    skillDisplayName: skillDecisionState.activeSkillName,
    scenarioDisplayName: skillDecisionState.activeScenarioDisplayName ?? null
  };
}

export interface AssistantWebChatTurnState {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistantMessage: AssistantWebChatMessageState;
  followUpAssistantMessage?: AssistantWebChatMessageState;
  activeMediaJobs?: AssistantWebChatActiveMediaJobState[];
  activeDocumentJobs?: AssistantWebChatActiveDocumentJobState[];
  engagementSummary?: AssistantWebChatEngagementSummary | null;
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

export type AssistantWebChatActiveMediaJobDisplayKind = "cinematic" | "talking_avatar";

export interface AssistantWebChatActiveMediaJobState {
  id: string;
  kind: AssistantWebChatActiveMediaJobKind;
  operation: AssistantWebChatActiveMediaJobOperation;
  /**
   * ADR-109 Slice 10b — display variant for an active media job. When
   * `"talking_avatar"`, the web client renders a time-based stage rotation in
   * place of the static "Generating video" chip; otherwise (cinematic, or
   * undefined/null on legacy rows) the cinematic chip is rendered byte-
   * identical to pre-Slice-10b behavior. Set by the mapper from
   * `requestJson.directToolExecution.request.mode`; defaults to `"cinematic"`.
   */
  displayKind?: AssistantWebChatActiveMediaJobDisplayKind | null;
  status: AssistantWebChatActiveMediaJobStatus;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
}

export type AssistantWebChatActiveDocumentJobStatus =
  | "queued"
  | "running"
  | "provider_processing"
  | "fetching_output"
  | "ready_for_delivery";

export interface AssistantWebChatActiveDocumentJobState {
  id: string;
  documentType: "pdf_document" | "presentation";
  descriptorMode:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  status: AssistantWebChatActiveDocumentJobStatus;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
}

export interface AssistantWebChatCompactionState {
  available: boolean;
  suggested: boolean;
  suggestionReason: "token_threshold" | "history_threshold" | null;
  exhaustedAtPlanLimit: boolean;
  recentAutoCompactionStreak: number;
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
  activeDocumentJobs?: AssistantWebChatActiveDocumentJobState[];
}
