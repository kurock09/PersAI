import type {
  AssistantMemoryRegistryClass,
  AssistantMemoryRegistryDurability,
  AssistantMemoryRegistryStability
} from "./assistant-memory-registry-item.entity";
import type { PersaiRuntimeMemoryWriteLayer } from "@persai/runtime-contract";

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
      layer: PersaiRuntimeMemoryWriteLayer;
      memoryClass: AssistantMemoryRegistryClass;
      durability: AssistantMemoryRegistryDurability;
      stability: AssistantMemoryRegistryStability;
      reason: null;
    }
  | {
      action: "skip";
      memoryClass: null;
      reason: typeof MEMORY_WRITE_NOT_DURABLE_CODE;
    };

export function routeDurableMemoryWrite(params: {
  layer: PersaiRuntimeMemoryWriteLayer | null;
  guardrailRejected?: boolean;
}): DurableMemoryWriteRouteDecision {
  if (params.guardrailRejected) {
    return {
      action: "skip",
      memoryClass: null,
      reason: MEMORY_WRITE_NOT_DURABLE_CODE
    };
  }

  if (params.layer === "long") {
    return {
      action: "write",
      layer: params.layer,
      memoryClass: "core",
      durability: "identity",
      stability: "stable",
      reason: null
    };
  }

  if (params.layer === "short") {
    return {
      action: "write",
      layer: params.layer,
      memoryClass: "contextual",
      durability: "episodic",
      stability: "time_bound",
      reason: null
    };
  }

  return {
    action: "skip",
    memoryClass: null,
    reason: MEMORY_WRITE_NOT_DURABLE_CODE
  };
}
