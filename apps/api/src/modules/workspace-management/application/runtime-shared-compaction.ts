import {
  DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
  type RuntimeContextHydrationConfig,
  type RuntimeSharedCompactionConfig
} from "@persai/runtime-contract";
import { deriveSharedCompactionBudgetsFromContextHydration } from "./context-hydration-policy";

export function buildRuntimeSharedCompactionConfig(
  contextHydration: RuntimeContextHydrationConfig
): RuntimeSharedCompactionConfig {
  const derived = deriveSharedCompactionBudgetsFromContextHydration(contextHydration);
  return {
    summarizeToolCode: "summarize_context",
    compactToolCode: "compact_context",
    webSuggestionLatencyMs: DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
    reserveTokens: derived.reserveTokens,
    keepRecentTokens: derived.keepRecentTokens,
    recentTurnsPreserve: derived.recentTurnsPreserve,
    telegramAutoSummarizeEnabled: contextHydration.autoCompactionTelegram
  };
}
