export type AssistantMemoryRegistrySourceType = "web_chat" | "memory_write";

export type AssistantMemoryRegistryClass = "core" | "contextual";

export type AssistantMemoryRegistryKind = "fact" | "preference" | "open_loop";

export type AssistantMemoryRegistryDurability = "identity" | "episodic";

export type AssistantMemoryRegistryStability = "stable" | "time_bound";

export type AssistantMemoryRegistryItem = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string | null;
  relatedUserMessageId: string | null;
  relatedAssistantMessageId: string | null;
  summary: string;
  sourceType: AssistantMemoryRegistrySourceType;
  sourceLabel: string | null;
  memoryClass: AssistantMemoryRegistryClass;
  kind: AssistantMemoryRegistryKind | null;
  durability: AssistantMemoryRegistryDurability | null;
  stability: AssistantMemoryRegistryStability | null;
  confidence: number | null;
  lastUsedAt: Date | null;
  /**
   * ADR-074 Slice M3 — set when an `open_loop` durable memory is closed,
   * either implicitly via `memory_write` dedup-overwrite for the same kind
   * or explicitly via the `closeOpenLoop: true` opt-in flag. Resolved
   * open-loops stay in the registry for audit / re-open but are filtered
   * out of the cross-session carry-over block.
   */
  resolvedAt: Date | null;
  forgottenAt: Date | null;
  createdAt: Date;
};
