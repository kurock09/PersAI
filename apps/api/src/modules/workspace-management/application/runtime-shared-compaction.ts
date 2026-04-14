import {
  DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
  type RuntimeContextHydrationConfig,
  type RuntimeSharedCompactionConfig
} from "@persai/runtime-contract";
import type { RuntimeCompactionPolicyState } from "./platform-runtime-provider-settings";
import { deriveSharedCompactionBudgetsFromContextHydration } from "./context-hydration-policy";

export function buildRuntimeSharedCompactionConfig(params: {
  compactionPolicy: RuntimeCompactionPolicyState;
  contextHydration: RuntimeContextHydrationConfig;
}): RuntimeSharedCompactionConfig {
  const derived = deriveSharedCompactionBudgetsFromContextHydration(params.contextHydration);
  return {
    summarizeToolCode: "summarize_context",
    compactToolCode: "compact_context",
    webSuggestionLatencyMs: DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
    reserveTokens: derived.reserveTokens,
    keepRecentTokens: derived.keepRecentTokens,
    recentTurnsPreserve: derived.recentTurnsPreserve,
    suggestByMessageCount: params.compactionPolicy.suggestCompactionByMessageCount,
    telegramAutoSummarizeEnabled: params.contextHydration.autoCompactionTelegram
  };
}
