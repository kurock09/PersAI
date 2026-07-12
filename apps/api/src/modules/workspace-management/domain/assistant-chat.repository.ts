import type { AssistantChatMessage } from "./assistant-chat-message.entity";
import type {
  AssistantChat,
  AssistantChatMode,
  AssistantChatSkillDecisionState,
  AssistantChatSkillRetrievalState,
  AssistantChatSurface
} from "./assistant-chat.entity";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";

export const ASSISTANT_CHAT_REPOSITORY = Symbol("ASSISTANT_CHAT_REPOSITORY");

export type CreateAssistantChatInput = {
  assistantId: string;
  userId: string;
  workspaceId: string;
  surface: AssistantChatSurface;
  surfaceThreadKey: string;
  title: string | null;
  chatMode?: AssistantChatMode;
  deepModeEnabled?: boolean;
};

export type GetOrCreateWebChatUnderCapInput = CreateAssistantChatInput & {
  activeWebChatsLimit: number | null;
};

export type GetOrCreateWebChatUnderCapResult =
  | { outcome: "existing"; chat: AssistantChat }
  | { outcome: "created"; chat: AssistantChat }
  | { outcome: "cap_reached"; activeCount: number; limit: number };

export type RestoreArchivedWebChatUnderCapResult =
  | { outcome: "restored"; chat: AssistantChat }
  | { outcome: "not_found" }
  | { outcome: "cap_reached"; activeCount: number; limit: number };

export type CreateAssistantChatMessageInput = {
  chatId: string;
  assistantId: string;
  author: AssistantChatMessage["author"];
  content: string;
  /** ADR-100 Piece 1 — optional JSONB metadata written to the message row. */
  metadata?: Record<string, unknown>;
  toolExchanges?: readonly ProviderGatewayToolExchange[];
};

export type AssistantChatListMetadata = {
  messageCount: number;
  lastMessagePreview: string | null;
};

export type UpdateAssistantChatInput = {
  title?: string | null;
  chatMode?: AssistantChatMode;
  deepModeEnabled?: boolean;
  skillDecisionState?: AssistantChatSkillDecisionState | null;
  skillRetrievalState?: AssistantChatSkillRetrievalState | null;
};

export interface AssistantChatRepository {
  createChat(input: CreateAssistantChatInput): Promise<AssistantChat>;
  findOrCreateChatBySurfaceThread(input: CreateAssistantChatInput): Promise<AssistantChat>;
  getOrCreateWebChatBySurfaceThreadUnderCap(
    input: GetOrCreateWebChatUnderCapInput
  ): Promise<GetOrCreateWebChatUnderCapResult>;
  findChatById(chatId: string): Promise<AssistantChat | null>;
  findChatBySurfaceThread(
    assistantId: string,
    surface: AssistantChatSurface,
    surfaceThreadKey: string
  ): Promise<AssistantChat | null>;
  countActiveChatsByAssistantIdAndSurface(
    assistantId: string,
    surface: AssistantChatSurface
  ): Promise<number>;
  listChatsByAssistantId(assistantId: string): Promise<AssistantChat[]>;
  resetElevatedWebChatModesForAssistant(assistantId: string): Promise<number>;
  getChatListMetadata(chatId: string): Promise<AssistantChatListMetadata>;
  updateChat(chatId: string, input: UpdateAssistantChatInput): Promise<AssistantChat | null>;
  archiveChat(chatId: string): Promise<AssistantChat | null>;
  restoreArchivedWebChatUnderCap(input: {
    chatId: string;
    assistantId: string;
    activeWebChatsLimit: number | null;
  }): Promise<RestoreArchivedWebChatUnderCapResult>;
  hardDeleteChat(
    chatId: string,
    assistantId: string,
    options?: { workspaceId?: string }
  ): Promise<boolean>;
  createMessage(input: CreateAssistantChatMessageInput): Promise<AssistantChatMessage>;
  updateMessageContent(
    messageId: string,
    assistantId: string,
    content: string
  ): Promise<AssistantChatMessage | null>;
  deleteMessage(messageId: string, assistantId: string): Promise<boolean>;
  listMessagesByChatId(chatId: string): Promise<AssistantChatMessage[]>;
  findLatestAssistantMessageToolContext(
    chatId: string,
    assistantId: string
  ): Promise<{
    metadata: Record<string, unknown> | null;
    toolExchanges: ProviderGatewayToolExchange[] | null;
  } | null>;
  findMessageToolContextById(
    messageId: string,
    assistantId: string
  ): Promise<{
    metadata: Record<string, unknown> | null;
    toolExchanges: ProviderGatewayToolExchange[] | null;
  } | null>;
  findMessageByIdForAssistant(
    messageId: string,
    assistantId: string
  ): Promise<AssistantChatMessage | null>;
  /**
   * ADR-074 Slice M3.2 — read the per-thread cooldown bookkeeping cell.
   * Returns `null` when the thread has never fired the cross-session
   * carry-over block (cooldown does not apply yet).
   */
  findLastCrossSessionCarryOverAt(chatId: string): Promise<Date | null>;
  /**
   * ADR-074 Slice M3.2 — bump the per-thread cooldown bookkeeping cell to
   * `firedAt` IFF the new value is strictly greater than the current value
   * (idempotent against stale fire-and-forget retries). Returns `true` if
   * the column was advanced, `false` otherwise (chat missing, or the stored
   * value is already >= `firedAt`).
   */
  setLastCrossSessionCarryOverAt(chatId: string, firedAt: Date): Promise<boolean>;
}
