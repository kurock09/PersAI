import assert from "node:assert/strict";
import { DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS } from "@persai/runtime-contract";
import { buildRuntimeSharedCompactionConfig } from "../src/modules/workspace-management/application/runtime-shared-compaction";

async function run(): Promise<void> {
  const sharedCompaction = buildRuntimeSharedCompactionConfig({
    compactionPolicy: {
      mode: "safeguard",
      reserveTokens: 24000,
      keepRecentTokens: 16000,
      recentTurnsPreserve: 4,
      identifierPolicy: "strict",
      postIndexSync: "async",
      truncateAfterCompaction: true,
      suggestCompactionByMessageCount: false
    },
    telegramAutoSummarizeEnabled: false
  });

  assert.deepEqual(sharedCompaction, {
    summarizeToolCode: "summarize_context",
    compactToolCode: "compact_context",
    webSuggestionLatencyMs: DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS,
    reserveTokens: 24000,
    keepRecentTokens: 16000,
    recentTurnsPreserve: 4,
    suggestByMessageCount: false,
    telegramAutoSummarizeEnabled: false
  });
}

void run();
