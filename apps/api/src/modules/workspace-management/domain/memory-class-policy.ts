import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryDurability,
  AssistantMemoryRegistryStability
} from "./assistant-memory-registry-item.entity";

/**
 * ADR-074 M1 — hard cap on the number of always-on "core" durable memory
 * entries per assistant. The runtime injects all active core entries on every
 * turn (cache-stable), so this cap also bounds the per-turn token cost of the
 * `durable_memory_core` stable block. New core writes that would exceed the
 * cap demote the oldest active core entry to `contextual`.
 */
export const MEMORY_CORE_HARD_CAP = 15;

export const MEMORY_WRITE_NOT_DURABLE_CODE = "not_durable";

export type DurableMemoryWriteRouteDecision =
  | {
      action: "write";
      memoryClass: AssistantMemoryRegistryClass;
      reason: null;
    }
  | {
      action: "skip";
      memoryClass: null;
      reason: typeof MEMORY_WRITE_NOT_DURABLE_CODE;
    };

export function routeDurableMemoryWrite(params: {
  durability: AssistantMemoryRegistryDurability | null;
  stability: AssistantMemoryRegistryStability | null;
  guardrailRejected?: boolean;
}): DurableMemoryWriteRouteDecision {
  if (params.guardrailRejected) {
    return {
      action: "skip",
      memoryClass: null,
      reason: MEMORY_WRITE_NOT_DURABLE_CODE
    };
  }

  if (params.durability === "identity" && params.stability === "stable") {
    return {
      action: "write",
      memoryClass: "core",
      reason: null
    };
  }

  // Legacy rows / in-flight callers may have null semantic fields. Treat them
  // conservatively as contextual so only explicit identity+stable writes land
  // in the always-on core block.
  return {
    action: "write",
    memoryClass: "contextual",
    reason: null
  };
}
