import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryKind
} from "./assistant-memory-registry-item.entity";

/**
 * ADR-074 M1 — hard cap on the number of always-on "core" durable memory
 * entries per assistant. The runtime injects all active core entries on every
 * turn (cache-stable), so this cap also bounds the per-turn token cost of the
 * `durable_memory_core` stable block. New core writes that would exceed the
 * cap demote the oldest active core entry to `contextual`.
 */
export const MEMORY_CORE_HARD_CAP = 15;

/**
 * ADR-074 M1 — translate a `memory_write` kind into its default storage class.
 *   - `fact` and `preference` shape the user's identity for the assistant and
 *     stay always-on (`core`). They power small things like "use the user's
 *     name" and "they prefer terse 3-bullet summaries" on every turn.
 *   - `open_loop` is naturally turn-relevant: the assistant should surface it
 *     when the user opens the matching thread, not on every unrelated turn.
 *
 * Web chat memories (`source_type = web_chat`) bypass this helper and land as
 * contextual via the call site, because they have no kind.
 */
export function classifyDurableMemoryWriteClass(
  kind: AssistantMemoryRegistryKind
): AssistantMemoryRegistryClass {
  switch (kind) {
    case "fact":
    case "preference":
      return "core";
    case "open_loop":
      return "contextual";
  }
}
