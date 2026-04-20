import crypto from "node:crypto";
import { SmokeApiClient } from "./api-client";
import {
  diffAgainstBaseline,
  formatSummary,
  loadBaseline,
  writeBaseline,
  writeRunArtifacts,
  type BaselineDiff,
  type SmokeRunArtifacts
} from "./reporter";
import type { SmokeScenarioDefinition, SmokeTurnDefinition } from "./scenario";
import { summarizeTrace, type SmokeRunSummary, type SmokeTurnTrace } from "./trace";
import { buildRunId, ensureDir, nowIso, type SmokeEnv } from "./workspace";

export interface SmokeRunOptions {
  scenario: SmokeScenarioDefinition;
  env: SmokeEnv;
  updateBaseline?: boolean;
  threadKeyOverride?: string;
}

export interface SmokeRunResult {
  runId: string;
  trace: SmokeTurnTrace[];
  summary: SmokeRunSummary;
  baseline: BaselineDiff;
  artifacts: SmokeRunArtifacts;
  consoleLines: string[];
  baselineWrittenTo?: string;
}

export async function runScenario(options: SmokeRunOptions): Promise<SmokeRunResult> {
  await ensureDir(options.env.artifactsDir);
  const client = new SmokeApiClient(options.env);
  const runId = buildRunId(options.scenario.id);
  const startedAt = nowIso();
  const consoleLines: string[] = [];
  const trace: SmokeTurnTrace[] = [];

  const threadSuffix = options.threadKeyOverride ?? crypto.randomBytes(4).toString("hex");
  log(consoleLines, `▶ ${options.scenario.id} (${options.scenario.title})`);
  log(consoleLines, `   thread suffix: ${threadSuffix}`);
  log(consoleLines, `   API: ${options.env.apiBaseUrl}`);
  log(consoleLines, `   assistantId: ${options.env.assistantId}`);

  for (const session of options.scenario.sessions) {
    const surfaceThreadKey = buildThreadKey(
      options.env.surfaceThreadPrefix,
      options.scenario,
      session.sessionKey,
      threadSuffix
    );
    log(
      consoleLines,
      `\n  ▸ session ${session.sessionKey} → ${surfaceThreadKey} (${session.turns.length} turns)`
    );
    let turnIndex = 0;
    for (const turn of session.turns) {
      turnIndex += 1;
      const kind = turn.kind ?? options.scenario.defaultKind ?? "web_sync";
      const turnLabel = `[${session.sessionKey}#${turnIndex}/${kind}]`;
      const turnStart = nowIso();
      // Capture cursor BEFORE we send so the receipt that the server creates for THIS turn
      // satisfies `createdAt > afterCursor`. We back off a few hundred ms to absorb any
      // small clock skew between local box and the API pod.
      const afterCursorIso = new Date(Date.now() - 1_000).toISOString();
      const outcome =
        kind === "web_stream"
          ? await client.sendWebChatStream({
              surfaceThreadKey,
              message: turn.message,
              clientTurnId: client.newClientTurnId()
            })
          : await client.sendWebChatSync({
              surfaceThreadKey,
              message: turn.message,
              clientTurnId: client.newClientTurnId()
            });
      const turnEnd = nowIso();

      let receipt: SmokeTurnTrace["receipt"] = null;
      let receiptMissingReason: string | undefined;
      if (outcome.ok) {
        // The HTTP-level requestId returned by /assistant/chat/web is a tracing id and is
        // NOT the same identifier persisted on RuntimeTurnReceipt.requestId. We correlate
        // by externalThreadKey + createdAt cursor instead, which is unambiguous because
        // the harness sends turns sequentially per thread.
        receipt = await client.findReceiptForThreadAfter(surfaceThreadKey, afterCursorIso);
        if (receipt === null) {
          receiptMissingReason =
            "polling timed out before a completed receipt appeared for this thread";
        }
      } else {
        receiptMissingReason = `turn failed: ${outcome.errorCode}`;
      }

      const traceItem: SmokeTurnTrace = {
        scenarioId: options.scenario.id,
        sessionKey: session.sessionKey,
        turnIndex,
        message: turn.message,
        surfaceThreadKey,
        kind,
        startedAt: turnStart,
        finishedAt: turnEnd,
        latencyMs: outcome.latencyMs,
        status: outcome.ok ? "ok" : "failed",
        ...(outcome.ok ? {} : { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage }),
        requestId: outcome.requestId,
        responseText: outcome.ok ? outcome.responseText : "",
        receipt,
        ...(receiptMissingReason === undefined ? {} : { receiptMissingReason })
      };
      trace.push(traceItem);

      const tokenStr = receipt?.usage
        ? `tokens=${receipt.usage.totalTokens ?? "?"}` +
          ` (in=${receipt.usage.inputTokens ?? "?"}/cache=${receipt.usage.cachedInputTokens ?? "?"}/out=${receipt.usage.outputTokens ?? "?"})`
        : "tokens=<no receipt>";
      const toolStr =
        receipt && receipt.toolCalls.length > 0
          ? ` tools=[${receipt.toolCalls.map((t) => `${t.toolCode}×${t.count}`).join(", ")}]` +
            (receipt.toolCallsSource === "usage_entries"
              ? " (billable-only)"
              : receipt.toolCallsSource === "tool_invocations"
                ? ""
                : "")
          : "";
      const statusStr = outcome.ok ? "OK" : `FAIL ${outcome.errorCode}`;
      log(
        consoleLines,
        `    ${turnLabel} ${statusStr} ${outcome.latencyMs}ms ${tokenStr}${toolStr}` +
          (turn.expectToolCode && receipt
            ? ` (expected tool: ${turn.expectToolCode}, ${receipt.toolCalls.some((t) => t.toolCode === turn.expectToolCode) ? "✓" : "✗"})`
            : "")
      );

      const thinkAfterMs = turn.thinkAfterMs ?? options.scenario.defaultThinkAfterMs ?? 0;
      const isLastTurn = turnIndex === session.turns.length;
      if (thinkAfterMs > 0 && !isLastTurn) {
        await sleep(thinkAfterMs);
      }
    }
  }

  const finishedAt = nowIso();
  const summary = summarizeTrace(
    options.scenario.id,
    options.scenario.title,
    startedAt,
    finishedAt,
    trace
  );
  const baseline = await loadBaseline(options.scenario.id);
  const baselineWithDiff = diffAgainstBaseline(summary, baseline);
  log(consoleLines, "");
  for (const line of formatSummary(summary, baselineWithDiff)) {
    log(consoleLines, line);
  }
  const artifacts = await writeRunArtifacts(
    options.env.artifactsDir,
    runId,
    trace,
    summary,
    consoleLines
  );
  log(consoleLines, "");
  log(consoleLines, `Artifacts: ${artifacts.runDir}`);
  let baselineWrittenTo: string | undefined;
  if (options.updateBaseline === true) {
    baselineWrittenTo = await writeBaseline(options.scenario.id, summary);
    log(consoleLines, `Baseline updated: ${baselineWrittenTo}`);
  }
  return {
    runId,
    trace,
    summary,
    baseline: baselineWithDiff,
    artifacts,
    consoleLines,
    ...(baselineWrittenTo === undefined ? {} : { baselineWrittenTo })
  };
}

function buildThreadKey(
  prefix: string,
  scenario: SmokeScenarioDefinition,
  sessionKey: string,
  suffix: string
): string {
  const tail = scenario.threadKeySuffix ? `${scenario.threadKeySuffix}-` : "";
  return `${prefix}-${scenario.id}-${tail}${sessionKey}-${suffix}`;
}

function log(lines: string[], message: string): void {
  lines.push(message);
  // eslint-disable-next-line no-console
  console.log(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export to keep the public surface concise.
export type { SmokeTurnDefinition };
