import type {
  RuntimeUsageSnapshot,
  TextGenerationUsageAccountingEnvelope
} from "@persai/runtime-contract";

/**
 * Session `currentTokens` for the context meter + auto-compaction trigger.
 *
 * Must reflect durable prompt pressure at the first main-model step of the
 * user turn — not the final tool-loop step's `totalTokens`, which grows with
 * every tool result stuffed into the in-turn prompt and makes the meter jump
 * with tool-call count.
 */
export function resolveSessionContextPressureTokens(input: {
  usage: RuntimeUsageSnapshot | null;
  textUsageAccounting?: TextGenerationUsageAccountingEnvelope | null;
}): number | null {
  const mainTurn = input.textUsageAccounting?.entries.find(
    (entry) => entry.stepType === "main_turn"
  );
  if (mainTurn !== undefined) {
    return mainTurn.totalInputTokens;
  }

  if (input.usage !== null && typeof input.usage.inputTokens === "number") {
    return input.usage.inputTokens;
  }
  if (input.usage !== null && typeof input.usage.totalTokens === "number") {
    return input.usage.totalTokens;
  }
  return null;
}
