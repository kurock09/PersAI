import type { SmokeReceipt } from "./api-client";

export interface SmokeTurnTrace {
  scenarioId: string;
  sessionKey: string;
  turnIndex: number;
  message: string;
  surfaceThreadKey: string;
  kind: "web_sync" | "web_stream";
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  status: "ok" | "failed";
  errorCode?: string;
  errorMessage?: string;
  requestId: string | null;
  responseText: string;
  receipt: SmokeReceipt | null;
  receiptMissingReason?: string;
}

export interface SmokeRunSummary {
  scenarioId: string;
  scenarioTitle: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  totals: {
    turns: number;
    succeeded: number;
    failed: number;
    receiptsCaptured: number;
    receiptsMissing: number;
  };
  tokens: {
    totalInputTokens: number;
    totalCachedInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    averagePerTurn: number;
  };
  toolCalls: Array<{ toolCode: string; count: number }>;
  toolCallsSource: "tool_invocations" | "usage_entries" | "mixed" | "none";
  routing: {
    modes: Record<string, number>;
    executionModes: Record<string, number>;
  };
  autoCompactionTriggers: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
}

export function summarizeTrace(
  scenarioId: string,
  scenarioTitle: string,
  startedAt: string,
  finishedAt: string,
  trace: SmokeTurnTrace[]
): SmokeRunSummary {
  const totalDurationMs = new Date(finishedAt).valueOf() - new Date(startedAt).valueOf();
  const succeeded = trace.filter((t) => t.status === "ok").length;
  const failed = trace.length - succeeded;
  const receiptsCaptured = trace.filter((t) => t.receipt !== null).length;
  const receiptsMissing = trace.length - receiptsCaptured;
  let totalInputTokens = 0;
  let totalCachedInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  const toolCounts = new Map<string, number>();
  const modes: Record<string, number> = {};
  const executionModes: Record<string, number> = {};
  let autoCompactionTriggers = 0;
  const sources = new Set<"tool_invocations" | "usage_entries" | "none">();
  for (const t of trace) {
    const usage = t.receipt?.usage;
    if (usage) {
      totalInputTokens += usage.inputTokens ?? 0;
      totalCachedInputTokens += usage.cachedInputTokens ?? 0;
      totalOutputTokens += usage.outputTokens ?? 0;
      totalTokens += usage.totalTokens ?? 0;
    }
    for (const call of t.receipt?.toolCalls ?? []) {
      toolCounts.set(call.toolCode, (toolCounts.get(call.toolCode) ?? 0) + call.count);
    }
    if (t.receipt) {
      sources.add(t.receipt.toolCallsSource ?? "none");
    }
    if (t.receipt?.routingMode) {
      modes[t.receipt.routingMode] = (modes[t.receipt.routingMode] ?? 0) + 1;
    }
    if (t.receipt?.routingExecutionMode) {
      executionModes[t.receipt.routingExecutionMode] =
        (executionModes[t.receipt.routingExecutionMode] ?? 0) + 1;
    }
    if (
      t.receipt?.autoCompactionTokensBefore !== null &&
      t.receipt?.autoCompactionTokensBefore !== undefined &&
      t.receipt?.autoCompactionTokensAfter !== null &&
      t.receipt?.autoCompactionTokensAfter !== undefined
    ) {
      autoCompactionTriggers += 1;
    }
  }
  const averagePerTurn = trace.length === 0 ? 0 : Math.round(totalTokens / trace.length);
  const latencies = trace.map((t) => t.latencyMs);
  return {
    scenarioId,
    scenarioTitle,
    startedAt,
    finishedAt,
    totalDurationMs,
    totals: {
      turns: trace.length,
      succeeded,
      failed,
      receiptsCaptured,
      receiptsMissing
    },
    tokens: {
      totalInputTokens,
      totalCachedInputTokens,
      totalOutputTokens,
      totalTokens,
      averagePerTurn
    },
    toolCalls: [...toolCounts.entries()]
      .map(([toolCode, count]) => ({ toolCode, count }))
      .sort((a, b) => b.count - a.count),
    toolCallsSource: resolveToolCallsSource(sources),
    routing: { modes, executionModes },
    autoCompactionTriggers,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length > 0 ? Math.max(...latencies) : 0
    }
  };
}

function resolveToolCallsSource(
  sources: Set<"tool_invocations" | "usage_entries" | "none">
): "tool_invocations" | "usage_entries" | "mixed" | "none" {
  const meaningful = [...sources].filter((s) => s !== "none");
  if (meaningful.length === 0) return "none";
  if (meaningful.length === 1) return meaningful[0]!;
  return "mixed";
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[idx] ?? 0);
}
