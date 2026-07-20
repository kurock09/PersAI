import type {
  TextGenerationUsageAccountingEnvelope,
  TextGenerationUsageAccountingV2,
  TextGenerationUsageAccountingV2Result
} from "@persai/runtime-contract";

export function buildTextGenerationUsageEnvelope(
  entries: readonly TextGenerationUsageAccountingV2[]
): TextGenerationUsageAccountingEnvelope {
  const sum = (selector: (entry: TextGenerationUsageAccountingV2) => number): number =>
    entries.reduce((total, entry) => total + selector(entry), 0);
  return {
    schemaVersion: 2,
    totalInputTokens: sum((entry) => entry.totalInputTokens),
    uncachedInputTokens: sum((entry) => entry.uncachedInputTokens),
    cacheWriteInputTokens: sum((entry) => entry.cacheWriteInputTokens),
    cacheReadInputTokens: sum((entry) => entry.cacheReadInputTokens),
    outputTokens: sum((entry) => entry.outputTokens),
    totalTokens: sum((entry) => entry.totalTokens),
    entries: [...entries]
  };
}

export function buildTextGenerationUsageEnvelopeFromResult(
  result: TextGenerationUsageAccountingV2Result
): TextGenerationUsageAccountingEnvelope {
  return buildTextGenerationUsageEnvelope(result.status === "accounted" ? [result.entry] : []);
}
