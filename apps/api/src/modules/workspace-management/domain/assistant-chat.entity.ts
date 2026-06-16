export type AssistantChatSurface = "web" | "telegram";
export type AssistantChatMode = "normal" | "smart" | "project";

export const ASSISTANT_CHAT_MODES = ["normal", "smart", "project"] as const;

export function isAssistantChatMode(value: unknown): value is AssistantChatMode {
  return typeof value === "string" && (ASSISTANT_CHAT_MODES as readonly string[]).includes(value);
}

export function chatModeToDeepModeEnabled(mode: AssistantChatMode): boolean {
  return mode !== "normal";
}

export function isElevatedAssistantChatMode(mode: AssistantChatMode): boolean {
  return mode === "smart" || mode === "project";
}

export function normalizeAssistantChatModeForPaidLightMode(
  mode: AssistantChatMode | undefined,
  paidLightModeActive: boolean
): AssistantChatMode | undefined {
  if (!paidLightModeActive || mode === undefined) {
    return mode;
  }
  return isElevatedAssistantChatMode(mode) ? "normal" : mode;
}

export type AssistantChatSkillDecisionState = {
  status: "inactive" | "active";
  activeSkillId: string | null;
  activeSkillName: string | null;
  activeScenarioKey: string | null;
  topicSummary: string | null;
};

export type AssistantChatSkillRetrievalDecisionMode =
  | "reuse_cached_refs"
  | "refresh_search_only"
  | "refresh_with_helper";

export type AssistantChatSkillRetrievalState = {
  activeSkillId: string;
  lastUserMessageId: string;
  lastUserQueryFingerprint: string;
  lastTopReferenceIds: string[];
  lastTopReferenceScores: number[];
  lastRetrievedAtMessageIndex: number;
  lastMode: AssistantChatSkillRetrievalDecisionMode;
  lastHelperApplied: boolean;
  lastHelperChangedOrder: boolean;
  reuseStreak: number;
  lastCandidateSetHash: string | null;
};

export type AssistantChat = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AssistantChatSurface;
  surfaceThreadKey: string;
  title: string | null;
  chatMode: AssistantChatMode;
  deepModeEnabled: boolean;
  skillDecisionState: AssistantChatSkillDecisionState | null;
  skillRetrievalState: AssistantChatSkillRetrievalState | null;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
