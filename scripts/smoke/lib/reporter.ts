import { promises as fs } from "node:fs";
import path from "node:path";
import { BASELINES_DIR, ensureDir } from "./workspace";
import type { SmokeRunSummary, SmokeTurnTrace } from "./trace";

export interface SmokeRunArtifacts {
  runDir: string;
  tracePath: string;
  summaryPath: string;
  consolePath: string;
}

export interface BaselineDiff {
  hasBaseline: boolean;
  baselinePath: string;
  baseline?: SmokeRunSummary;
  diff?: {
    totalTokensDelta: number;
    totalTokensDeltaPct: number | null;
    inputTokensDelta: number;
    cachedInputTokensDelta: number;
    outputTokensDelta: number;
    averagePerTurnDelta: number;
    latencyP95DeltaMs: number;
    succeededDelta: number;
    failedDelta: number;
    autoCompactionTriggersDelta: number;
  };
}

export async function writeRunArtifacts(
  artifactsDir: string,
  runId: string,
  trace: SmokeTurnTrace[],
  summary: SmokeRunSummary,
  consoleLines: string[]
): Promise<SmokeRunArtifacts> {
  const runDir = path.join(artifactsDir, runId);
  await ensureDir(runDir);
  const tracePath = path.join(runDir, "trace.json");
  const summaryPath = path.join(runDir, "summary.json");
  const consolePath = path.join(runDir, "console.txt");
  await fs.writeFile(tracePath, JSON.stringify(trace, null, 2), "utf8");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(consolePath, consoleLines.join("\n") + "\n", "utf8");
  return { runDir, tracePath, summaryPath, consolePath };
}

export async function loadBaseline(scenarioId: string): Promise<BaselineDiff> {
  const baselinePath = path.join(BASELINES_DIR, `${scenarioId}.summary.json`);
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    const baseline = JSON.parse(raw) as SmokeRunSummary;
    return { hasBaseline: true, baselinePath, baseline };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { hasBaseline: false, baselinePath };
    }
    throw error;
  }
}

export function diffAgainstBaseline(
  current: SmokeRunSummary,
  baseline: BaselineDiff
): BaselineDiff {
  if (!baseline.hasBaseline || !baseline.baseline) {
    return baseline;
  }
  const b = baseline.baseline;
  const totalTokensDelta = current.tokens.totalTokens - b.tokens.totalTokens;
  const totalTokensDeltaPct =
    b.tokens.totalTokens === 0
      ? null
      : Math.round((totalTokensDelta / b.tokens.totalTokens) * 10_000) / 100;
  return {
    hasBaseline: true,
    baselinePath: baseline.baselinePath,
    baseline: b,
    diff: {
      totalTokensDelta,
      totalTokensDeltaPct,
      inputTokensDelta: current.tokens.totalInputTokens - b.tokens.totalInputTokens,
      cachedInputTokensDelta:
        current.tokens.totalCachedInputTokens - b.tokens.totalCachedInputTokens,
      outputTokensDelta: current.tokens.totalOutputTokens - b.tokens.totalOutputTokens,
      averagePerTurnDelta: current.tokens.averagePerTurn - b.tokens.averagePerTurn,
      latencyP95DeltaMs: current.latencyMs.p95 - b.latencyMs.p95,
      succeededDelta: current.totals.succeeded - b.totals.succeeded,
      failedDelta: current.totals.failed - b.totals.failed,
      autoCompactionTriggersDelta: current.autoCompactionTriggers - b.autoCompactionTriggers
    }
  };
}

export async function writeBaseline(scenarioId: string, summary: SmokeRunSummary): Promise<string> {
  await ensureDir(BASELINES_DIR);
  const baselinePath = path.join(BASELINES_DIR, `${scenarioId}.summary.json`);
  await fs.writeFile(baselinePath, JSON.stringify(summary, null, 2), "utf8");
  return baselinePath;
}

export function formatSummary(summary: SmokeRunSummary, baseline: BaselineDiff): string[] {
  const lines: string[] = [];
  lines.push(`Scenario: ${summary.scenarioId} — ${summary.scenarioTitle}`);
  lines.push(
    `Window:   ${summary.startedAt} → ${summary.finishedAt} (${summary.totalDurationMs}ms)`
  );
  lines.push(
    `Turns:    ${summary.totals.turns} (ok=${summary.totals.succeeded} failed=${summary.totals.failed}) ` +
      `receipts captured=${summary.totals.receiptsCaptured} missing=${summary.totals.receiptsMissing}`
  );
  lines.push(
    `Tokens:   total=${summary.tokens.totalTokens} ` +
      `input=${summary.tokens.totalInputTokens} cached=${summary.tokens.totalCachedInputTokens} ` +
      `output=${summary.tokens.totalOutputTokens} avg/turn=${summary.tokens.averagePerTurn}`
  );
  lines.push(
    `Latency:  p50=${summary.latencyMs.p50}ms p95=${summary.latencyMs.p95}ms ` +
      `p99=${summary.latencyMs.p99}ms max=${summary.latencyMs.max}ms`
  );
  const sourceLabel =
    summary.toolCallsSource === "tool_invocations"
      ? ""
      : summary.toolCallsSource === "usage_entries"
        ? " (billable-only — model may have invoked more inline tools)"
        : summary.toolCallsSource === "mixed"
          ? " (mixed sources: invocations + billable-only fallback)"
          : "";
  if (summary.toolCalls.length === 0) {
    lines.push(`Tools:    <none>${sourceLabel}`);
  } else {
    lines.push(
      `Tools:    ${summary.toolCalls.map((t) => `${t.toolCode}=${t.count}`).join(", ")}${sourceLabel}`
    );
  }
  const modeStr = Object.entries(summary.routing.modes)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const execStr = Object.entries(summary.routing.executionModes)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  lines.push(`Routing:  modes=[${modeStr || "<none>"}] execModes=[${execStr || "<none>"}]`);
  lines.push(`Auto-compaction triggers: ${summary.autoCompactionTriggers}`);
  if (baseline.hasBaseline && baseline.diff) {
    const pct =
      baseline.diff.totalTokensDeltaPct === null
        ? "n/a"
        : `${baseline.diff.totalTokensDeltaPct >= 0 ? "+" : ""}${baseline.diff.totalTokensDeltaPct}%`;
    lines.push(``);
    lines.push(`Baseline: ${baseline.baselinePath}`);
    lines.push(
      `Δ tokens: total=${formatSigned(baseline.diff.totalTokensDelta)} (${pct}) ` +
        `input=${formatSigned(baseline.diff.inputTokensDelta)} ` +
        `cached=${formatSigned(baseline.diff.cachedInputTokensDelta)} ` +
        `output=${formatSigned(baseline.diff.outputTokensDelta)} ` +
        `avg/turn=${formatSigned(baseline.diff.averagePerTurnDelta)}`
    );
    lines.push(
      `Δ latency p95: ${formatSigned(baseline.diff.latencyP95DeltaMs)}ms | ` +
        `Δ ok=${formatSigned(baseline.diff.succeededDelta)} ` +
        `Δ failed=${formatSigned(baseline.diff.failedDelta)} ` +
        `Δ auto-compaction=${formatSigned(baseline.diff.autoCompactionTriggersDelta)}`
    );
  } else {
    lines.push(``);
    lines.push(`Baseline: <none> (write one with --update-baseline)`);
  }
  return lines;
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
