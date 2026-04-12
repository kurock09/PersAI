import {
  DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
  type RuntimeSharedCompactionConfig
} from "@persai/runtime-contract";
import type { RuntimeCompactionPolicyState } from "./platform-runtime-provider-settings";

export function buildRuntimeSharedCompactionConfig(params: {
  compactionPolicy: RuntimeCompactionPolicyState;
  telegramAutoSummarizeEnabled: boolean;
}): RuntimeSharedCompactionConfig {
  return {
    summarizeToolCode: "summarize_context",
    compactToolCode: "compact_context",
    webSuggestionLatencyMs: DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
    reserveTokens: params.compactionPolicy.reserveTokens,
    keepRecentTokens: params.compactionPolicy.keepRecentTokens,
    recentTurnsPreserve: params.compactionPolicy.recentTurnsPreserve,
    suggestByMessageCount: params.compactionPolicy.suggestCompactionByMessageCount,
    telegramAutoSummarizeEnabled: params.telegramAutoSummarizeEnabled
  };
}
