import assert from "node:assert/strict";
import {
  MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS,
  type ProviderGatewayToolExchange
} from "@persai/runtime-contract";
import {
  formatToolHistoryProjectionMetricsLog,
  projectToolExchangesForModel,
  projectToolExchangesForModelWithMetrics,
  TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS
} from "../src/modules/turns/project-tool-exchanges-for-model";
import { TOOL_OBSERVATION_SCRIPT_OUTPUT_MAX_SERIALIZED_CHARS } from "../src/modules/turns/tool-observation-compactors";
import {
  assignToolObservationTier,
  assignToolObservationTiersForExchanges,
  TOOL_OBSERVATION_COMPACT_COUNT,
  TOOL_OBSERVATION_FULL_COUNT
} from "../src/modules/turns/tool-observation-policy";

type ObservationTier = "full" | "compact" | "masked";

function parseContent(exchange: ProviderGatewayToolExchange): Record<string, unknown> {
  return JSON.parse(exchange.toolResult.content) as Record<string, unknown>;
}

function tierOf(exchange: ProviderGatewayToolExchange): ObservationTier {
  const parsed = parseContent(exchange);
  const tier = parsed._observationTier;
  assert.ok(tier === "full" || tier === "compact" || tier === "masked");
  return tier;
}

function createExchange(input: {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  isError?: boolean;
}): ProviderGatewayToolExchange {
  return {
    toolCall: {
      id: input.id,
      name: input.name,
      arguments: { action: "test" }
    },
    toolResult: {
      toolCallId: input.id,
      name: input.name,
      content: JSON.stringify(input.payload),
      isError: input.isError === true
    }
  };
}

function createBrowserPayload(input?: {
  contentChars?: number;
  elementCount?: number;
  url?: string;
  action?: string;
}): Record<string, unknown> {
  const contentChars = input?.contentChars ?? 12_000;
  const elementCount = input?.elementCount ?? MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS;
  const elements = Array.from({ length: elementCount }, (_, index) => ({
    index,
    tag: "button",
    role: "button",
    name: `Interactive control ${String(index)}`,
    text: `Buy item ${String(index)} with a longer label to inflate the observation`,
    selector: `#el-${String(index)}`,
    bounds: { x: index, y: index, width: 40, height: 20 }
  }));
  return {
    toolCode: "browser",
    executionMode: "worker",
    provider: "local_bridge",
    requestedAction: input?.action ?? "snapshot",
    page: {
      initialUrl: input?.url ?? "https://shop.example/catalog",
      finalUrl: input?.url ?? "https://shop.example/catalog",
      title: "Catalog",
      content: "X".repeat(contentChars),
      truncated: false,
      elements,
      extracted: [
        {
          kind: "text",
          value: "Y".repeat(2_000)
        }
      ],
      observedAt: "2026-07-11T00:00:00.000Z",
      tookMs: 120,
      warning: null
    },
    action: input?.action === "act" ? "acted" : "snapshot",
    reason: null,
    warning: null
  };
}

function createShellPayload(input?: {
  stdoutChars?: number;
  stderrChars?: number;
  exitCode?: number;
  reason?: string | null;
}): Record<string, unknown> {
  return {
    toolCode: "shell",
    executionMode: "sandbox",
    action: "completed",
    reason: input?.reason ?? null,
    warning: null,
    job: {
      jobId: "job-1",
      status: "completed",
      toolCode: "shell",
      reason: input?.reason ?? null,
      warning: null,
      violationCode: null,
      violationMessage: null,
      exitCode: input?.exitCode ?? 0,
      stdout: "O".repeat(input?.stdoutChars ?? 8_000),
      stderr: "E".repeat(input?.stderrChars ?? 0),
      content: null,
      files: []
    },
    paths: ["/workspace/assistants/a/sessions/s/out.txt"]
  };
}

function createFilesPayload(input?: { contentChars?: number }): Record<string, unknown> {
  const content = "F".repeat(input?.contentChars ?? 10_000);
  return {
    toolCode: "files",
    executionMode: "inline",
    requestedAction: "read",
    action: "read",
    reason: null,
    warning: null,
    path: "/workspace/assistants/a/sessions/s/notes.md",
    content,
    charCount: content.length,
    truncated: false,
    item: {
      path: "/workspace/assistants/a/sessions/s/notes.md",
      kind: "file"
    },
    items: [],
    job: null,
    queuedArtifacts: 0
  };
}

function createGenericPayload(): Record<string, unknown> {
  return {
    toolCode: "web_search",
    action: "searched",
    query: "persai browser projection",
    results: Array.from({ length: 20 }, (_, index) => ({
      title: `Result ${String(index)}`,
      url: `https://example.com/${String(index)}`,
      snippet: "Z".repeat(500)
    })),
    blob: "B".repeat(5_000)
  };
}

function createScriptPayload(output: unknown): Record<string, unknown> {
  return {
    toolCode: "script.execute",
    executionMode: "sandbox",
    action: "completed",
    reason: null,
    warning: null,
    scriptKey: "adr151_live_echo",
    versionNumber: 1,
    jobId: "script-job-1",
    output
  };
}

/**
 * ADR-143 — core model-facing projection module unit tests (S1 + shared policy).
 */
export async function runProjectToolExchangesForModelTest(): Promise<void> {
  assert.equal(
    MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS,
    200,
    "ADR-143 out of scope: MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS must stay 200"
  );
  assert.equal(TOOL_OBSERVATION_FULL_COUNT, 1);
  assert.equal(TOOL_OBSERVATION_COMPACT_COUNT, 4);

  // ── Tier windows ──────────────────────────────────────────────────────────
  {
    const tiers = assignToolObservationTiersForExchanges(
      Array.from({ length: 8 }, () => ({
        toolResult: { isError: false }
      }))
    );
    assert.deepEqual(tiers, [
      "masked",
      "masked",
      "masked",
      "compact",
      "compact",
      "compact",
      "compact",
      "full"
    ]);
    assert.equal(
      assignToolObservationTier({ index: 0, exchangeCount: 10, isError: true }),
      "compact",
      "error exchanges must never fall to bare mask"
    );
  }

  // ── Browser × full / compact / masked ─────────────────────────────────────
  {
    const fullPayload = createBrowserPayload();
    const exchanges = [
      createExchange({ id: "b0", name: "browser", payload: createBrowserPayload() }),
      createExchange({ id: "b1", name: "browser", payload: createBrowserPayload() }),
      createExchange({ id: "b2", name: "browser", payload: createBrowserPayload() }),
      createExchange({ id: "b3", name: "browser", payload: createBrowserPayload() }),
      createExchange({ id: "b4", name: "browser", payload: createBrowserPayload() }),
      createExchange({ id: "b5", name: "browser", payload: fullPayload })
    ];
    const projected = projectToolExchangesForModel(exchanges, { mode: "in_turn" });
    assert.equal(tierOf(projected[0]!), "masked");
    assert.equal(tierOf(projected[1]!), "compact");
    assert.equal(tierOf(projected[5]!), "full");

    const masked = parseContent(projected[0]!);
    assert.equal(masked.toolCode, "browser");
    assert.equal(typeof masked.gist, "string");
    assert.equal(masked.page, undefined);
    assert.match(String(masked.gist), /masked browser observation/);

    const compact = parseContent(projected[1]!);
    assert.equal(compact.toolCode, "browser");
    assert.equal(compact.action, "snapshot");
    assert.equal(compact.finalUrl, "https://shop.example/catalog");
    assert.equal(compact.title, "Catalog");
    assert.equal(compact.elementCount, MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS);
    assert.equal(compact.extractedCount, 1);
    assert.equal(compact.page, undefined);
    assert.ok(!("content" in compact));

    const full = parseContent(projected[5]!);
    assert.equal(full._observationTier, "full");
    const fullPage = full.page as Record<string, unknown>;
    const originalPage = fullPayload.page as Record<string, unknown>;
    assert.deepEqual(fullPage.elements, originalPage.elements);
    assert.equal(fullPage.content, originalPage.content);
    const fullWithoutTier = { ...full };
    delete fullWithoutTier._observationTier;
    assert.deepEqual(fullWithoutTier, fullPayload);
  }

  // ── Shell × full / compact / masked ───────────────────────────────────────
  {
    const shellFull = createShellPayload({ stdoutChars: 4_000 });
    const exchanges = [
      createExchange({ id: "s0", name: "shell", payload: createShellPayload() }),
      createExchange({ id: "s1", name: "shell", payload: createShellPayload() }),
      createExchange({ id: "s2", name: "shell", payload: createShellPayload() }),
      createExchange({ id: "s3", name: "shell", payload: createShellPayload() }),
      createExchange({ id: "s4", name: "shell", payload: createShellPayload() }),
      createExchange({ id: "s5", name: "shell", payload: shellFull })
    ];
    const projected = projectToolExchangesForModel(exchanges);
    assert.equal(tierOf(projected[0]!), "masked");
    assert.equal(tierOf(projected[1]!), "compact");
    assert.equal(tierOf(projected[5]!), "full");

    const compact = parseContent(projected[1]!);
    assert.equal(compact.toolCode, "shell");
    assert.equal(compact.exitCode, 0);
    assert.equal(typeof compact.stdoutTail, "string");
    assert.ok(String(compact.stdoutTail).length <= 500);
    assert.equal(compact.stderrTail, undefined);
    assert.deepEqual(compact.paths, ["/workspace/assistants/a/sessions/s/out.txt"]);
    assert.equal(compact.job, undefined);
    assert.ok(!("stdout" in compact));

    const full = parseContent(projected[5]!);
    const fullWithoutTier = { ...full };
    delete fullWithoutTier._observationTier;
    assert.deepEqual(fullWithoutTier, shellFull);
  }

  // ── Files × full / compact / masked ───────────────────────────────────────
  {
    const filesFull = createFilesPayload({ contentChars: 3_000 });
    const exchanges = [
      createExchange({ id: "f0", name: "files", payload: createFilesPayload() }),
      createExchange({ id: "f1", name: "files", payload: createFilesPayload() }),
      createExchange({ id: "f2", name: "files", payload: createFilesPayload() }),
      createExchange({ id: "f3", name: "files", payload: createFilesPayload() }),
      createExchange({ id: "f4", name: "files", payload: createFilesPayload() }),
      createExchange({ id: "f5", name: "files", payload: filesFull })
    ];
    const projected = projectToolExchangesForModel(exchanges);
    assert.equal(tierOf(projected[0]!), "masked");
    assert.equal(tierOf(projected[1]!), "compact");
    assert.equal(tierOf(projected[5]!), "full");

    const compact = parseContent(projected[1]!);
    assert.equal(compact.toolCode, "files");
    assert.equal(compact.action, "read");
    assert.equal(compact.path, "/workspace/assistants/a/sessions/s/notes.md");
    assert.equal(compact.charCount, 10_000);
    assert.equal(compact.truncated, false);
    assert.equal(compact.content, undefined);

    const full = parseContent(projected[5]!);
    const fullWithoutTier = { ...full };
    delete fullWithoutTier._observationTier;
    assert.deepEqual(fullWithoutTier, filesFull);
  }

  // ── Script compact output stays useful and bounded ────────────────────────
  {
    const exactOutput = {
      echoed: "founder live value",
      totals: { accepted: 3, rejected: 1 },
      rows: ["alpha", "beta"]
    };
    const canonicalScript = createExchange({
      id: "script-small",
      name: "script",
      payload: createScriptPayload(exactOutput)
    });
    const canonicalSnapshot = structuredClone(canonicalScript);
    const projected = projectToolExchangesForModel([
      canonicalScript,
      createExchange({ id: "script-newest", name: "web_search", payload: createGenericPayload() })
    ]);
    const compact = parseContent(projected[0]!);
    assert.equal(tierOf(projected[0]!), "compact");
    assert.equal(compact.toolCode, "script.execute");
    assert.equal(compact.executionMode, "sandbox");
    assert.equal(compact.action, "completed");
    assert.equal(compact.reason, null);
    assert.equal(compact.warning, null);
    assert.equal(compact.scriptKey, "adr151_live_echo");
    assert.equal(compact.versionNumber, 1);
    assert.equal(compact.jobId, "script-job-1");
    assert.deepEqual(compact.output, exactOutput);
    assert.equal(compact.outputPresent, undefined);
    assert.deepEqual(
      canonicalScript,
      canonicalSnapshot,
      "model projection must not mutate the canonical full Script exchange retained for storage"
    );
    const canonicalPayload = parseContent(canonicalScript);
    assert.deepEqual(canonicalPayload.output, exactOutput);
    assert.equal(canonicalPayload._observationTier, undefined);
  }

  {
    const oversizedOutput = {
      rows: Array.from({ length: 2_000 }, (_, index) => ({
        index,
        value: `row-${String(index)}-${"x".repeat(80)}`
      }))
    };
    const exchanges = [
      createExchange({
        id: "script-large",
        name: "script",
        payload: createScriptPayload(oversizedOutput)
      }),
      createExchange({
        id: "script-large-newest",
        name: "web_search",
        payload: createGenericPayload()
      })
    ];
    const firstProjection = projectToolExchangesForModel(exchanges);
    const secondProjection = projectToolExchangesForModel(exchanges);
    assert.equal(
      firstProjection[0]!.toolResult.content,
      secondProjection[0]!.toolResult.content,
      "oversized Script output truncation must be deterministic"
    );
    assert.ok(
      firstProjection[0]!.toolResult.content.length <
        TOOL_OBSERVATION_SCRIPT_OUTPUT_MAX_SERIALIZED_CHARS + 500,
      "the complete compact Script observation must remain close to the explicit output cap"
    );
    const compact = parseContent(firstProjection[0]!);
    const boundedOutput = compact.output as Record<string, unknown>;
    assert.equal(boundedOutput.__truncated, true);
    assert.equal(typeof boundedOutput.originalSerializedChars, "number");
    assert.equal(typeof boundedOutput.omittedSerializedChars, "number");
    assert.equal(typeof boundedOutput.jsonPrefix, "string");
    assert.ok(
      JSON.stringify(boundedOutput).length <= TOOL_OBSERVATION_SCRIPT_OUTPUT_MAX_SERIALIZED_CHARS
    );
    assert.ok(Number(boundedOutput.omittedSerializedChars) > 0);
    assert.doesNotThrow(() => JSON.parse(firstProjection[0]!.toolResult.content));
  }

  {
    const scriptError = createExchange({
      id: "script-error",
      name: "script",
      isError: true,
      payload: {
        ...createScriptPayload(null),
        action: "skipped",
        reason: "script_output_schema_invalid",
        warning: "output failed published schema validation"
      }
    });
    const projected = projectToolExchangesForModel([
      scriptError,
      ...Array.from({ length: 6 }, (_, index) =>
        createExchange({
          id: `script-error-newer-${String(index)}`,
          name: "web_search",
          payload: createGenericPayload()
        })
      )
    ]);
    const compact = parseContent(projected[0]!);
    assert.equal(tierOf(projected[0]!), "compact");
    assert.equal(compact.action, "skipped");
    assert.equal(compact.reason, "script_output_schema_invalid");
    assert.equal(compact.warning, "output failed published schema validation");
    assert.equal(compact.scriptKey, "adr151_live_echo");
    assert.equal(compact.versionNumber, 1);
    assert.equal(compact.jobId, "script-job-1");
    assert.equal(compact.output, null);
    assert.equal(compact.isError, true);
  }

  {
    const secretOutputValue = "must-not-leak-from-masked-script-output";
    const warningProjection = projectToolExchangesForModel([
      createExchange({
        id: "script-masked-warning",
        name: "script",
        payload: {
          ...createScriptPayload({ secretOutputValue }),
          warning: "completed_with_notice"
        }
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        createExchange({
          id: `script-masked-warning-newer-${String(index)}`,
          name: "web_search",
          payload: createGenericPayload()
        })
      )
    ]);
    const maskedWarning = parseContent(warningProjection[0]!);
    assert.equal(tierOf(warningProjection[0]!), "masked");
    assert.deepEqual(maskedWarning, {
      toolCode: "script.execute",
      gist: "[masked script.execute observation: completed: warning=completed_with_notice]",
      _observationTier: "masked"
    });
    assert.equal(warningProjection[0]!.toolResult.content.includes(secretOutputValue), false);
    assert.equal("output" in maskedWarning, false);

    const reasonProjection = projectToolExchangesForModel([
      createExchange({
        id: "script-masked-reason",
        name: "script",
        payload: {
          ...createScriptPayload({ secretOutputValue }),
          action: "skipped",
          reason: "script_not_active",
          warning: "secondary_warning"
        }
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        createExchange({
          id: `script-masked-reason-newer-${String(index)}`,
          name: "web_search",
          payload: createGenericPayload()
        })
      )
    ]);
    const maskedReason = parseContent(reasonProjection[0]!);
    assert.equal(tierOf(reasonProjection[0]!), "masked");
    assert.deepEqual(maskedReason, {
      toolCode: "script.execute",
      gist: "[masked script.execute observation: skipped: reason=script_not_active]",
      _observationTier: "masked"
    });
    assert.equal(reasonProjection[0]!.toolResult.content.includes(secretOutputValue), false);
    assert.equal("output" in maskedReason, false);
  }

  // ── Generic × full / compact / masked ─────────────────────────────────────
  {
    const genericFull = createGenericPayload();
    const exchanges = [
      createExchange({ id: "g0", name: "web_search", payload: createGenericPayload() }),
      createExchange({ id: "g1", name: "web_search", payload: createGenericPayload() }),
      createExchange({ id: "g2", name: "web_search", payload: createGenericPayload() }),
      createExchange({ id: "g3", name: "web_search", payload: createGenericPayload() }),
      createExchange({ id: "g4", name: "web_search", payload: createGenericPayload() }),
      createExchange({ id: "g5", name: "web_search", payload: genericFull })
    ];
    const projected = projectToolExchangesForModel(exchanges);
    assert.equal(tierOf(projected[0]!), "masked");
    assert.equal(tierOf(projected[1]!), "compact");
    assert.equal(tierOf(projected[5]!), "full");

    const compact = parseContent(projected[1]!);
    assert.equal(compact.toolCode, "web_search");
    assert.equal(compact.action, "searched");
    assert.equal(compact.resultsCount, 20);
    assert.equal(typeof compact.blobTail, "string");
    assert.ok(String(compact.blobTail).length <= 400);
    assert.equal(compact.results, undefined);
    assert.equal(compact.blob, undefined);

    const masked = parseContent(projected[0]!);
    assert.match(String(masked.gist), /masked web_search observation/);
  }

  // ── Error exchange retains failure detail at compact (never bare mask) ────
  {
    const errorExchange = createExchange({
      id: "err-shell",
      name: "shell",
      isError: true,
      payload: createShellPayload({
        stdoutChars: 2_000,
        stderrChars: 1_200,
        exitCode: 1,
        reason: "process_failed"
      })
    });
    // Place error far from newest so policy would otherwise mask it.
    const exchanges = [
      errorExchange,
      ...Array.from({ length: 6 }, (_, index) =>
        createExchange({
          id: `ok-${String(index)}`,
          name: "shell",
          payload: createShellPayload({ stdoutChars: 100 })
        })
      )
    ];
    const projected = projectToolExchangesForModel(exchanges);
    assert.equal(tierOf(projected[0]!), "compact");
    assert.equal(projected[0]!.toolResult.isError, true);
    const compact = parseContent(projected[0]!);
    assert.equal(compact.reason, "process_failed");
    assert.equal(compact.exitCode, 1);
    assert.equal(compact.isError, true);
    assert.equal(typeof compact.stderrTail, "string");
    assert.ok(String(compact.stderrTail).length <= 500);
    assert.ok(String(compact.stderrTail).length > 0);
    assert.equal(compact.gist, undefined);
  }

  // ── Input array not mutated ───────────────────────────────────────────────
  {
    const originalPayload = createBrowserPayload({ contentChars: 500, elementCount: 3 });
    const exchanges = [
      createExchange({
        id: "m0",
        name: "browser",
        payload: createBrowserPayload({ elementCount: 2 })
      }),
      createExchange({ id: "m1", name: "browser", payload: originalPayload })
    ];
    const snapshot = structuredClone(exchanges);
    const projected = projectToolExchangesForModel(exchanges);
    assert.notEqual(projected, exchanges);
    assert.notEqual(projected[0], exchanges[0]);
    assert.deepEqual(exchanges, snapshot);
    assert.notEqual(projected[1]!.toolResult.content, exchanges[1]!.toolResult.content);
  }

  // ── 40-step browser fixture: projected ≪ raw; last stays full ─────────────
  // Budget: projected total content chars must be < 10% of raw total content
  // chars. Raw is dominated by page.content (12k) + ~200 elements each step.
  {
    const BROWSER_STEPS = 40;
    const CONTENT_CHARS = 12_000;
    const ELEMENT_COUNT = MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS;
    const exchanges: ProviderGatewayToolExchange[] = Array.from(
      { length: BROWSER_STEPS },
      (_, index) =>
        createExchange({
          id: `browser-${String(index)}`,
          name: "browser",
          payload: createBrowserPayload({
            contentChars: CONTENT_CHARS,
            elementCount: ELEMENT_COUNT,
            url: `https://shop.example/step-${String(index)}`,
            action: index % 2 === 0 ? "snapshot" : "act"
          })
        })
    );

    const rawTotalChars = exchanges.reduce(
      (sum, exchange) => sum + exchange.toolResult.content.length,
      0
    );
    const projected = projectToolExchangesForModel(exchanges, { mode: "in_turn" });
    const projectedTotalChars = projected.reduce(
      (sum, exchange) => sum + exchange.toolResult.content.length,
      0
    );

    assert.equal(projected.length, BROWSER_STEPS);
    assert.ok(
      projectedTotalChars < rawTotalChars * 0.1,
      `ADR-143 S1 budget: projected (${String(projectedTotalChars)}) must be < 10% of raw (${String(rawTotalChars)}); ratio=${(
        projectedTotalChars / rawTotalChars
      ).toFixed(4)}`
    );

    for (let index = 0; index < BROWSER_STEPS; index += 1) {
      const ageFromNewest = BROWSER_STEPS - 1 - index;
      const expected: ObservationTier =
        ageFromNewest === 0 ? "full" : ageFromNewest <= 4 ? "compact" : "masked";
      assert.equal(
        tierOf(projected[index]!),
        expected,
        `exchange[${String(index)}] expected tier ${expected}`
      );
    }

    const lastOriginal = parseContent(exchanges[BROWSER_STEPS - 1]!);
    const lastProjected = parseContent(projected[BROWSER_STEPS - 1]!);
    assert.equal(lastProjected._observationTier, "full");
    const lastOriginalPage = lastOriginal.page as Record<string, unknown>;
    const lastProjectedPage = lastProjected.page as Record<string, unknown>;
    assert.deepEqual(lastProjectedPage.elements, lastOriginalPage.elements);
    assert.equal(lastProjectedPage.content, lastOriginalPage.content);
    const lastWithoutTier = { ...lastProjected };
    delete lastWithoutTier._observationTier;
    assert.deepEqual(lastWithoutTier, lastOriginal);

    // Preserve ids / isError / toolCall identity
    assert.equal(projected[0]!.toolCall.id, exchanges[0]!.toolCall.id);
    assert.equal(projected[0]!.toolResult.toolCallId, exchanges[0]!.toolResult.toolCallId);
    assert.equal(projected[0]!.toolResult.name, "browser");
    assert.equal(projected[0]!.toolResult.isError, false);
  }

  // ── Cross-turn mode uses the same windows ─────────────────────────────────
  {
    const exchanges = Array.from({ length: 6 }, (_, index) =>
      createExchange({
        id: `x-${String(index)}`,
        name: "files",
        payload: createFilesPayload({ contentChars: 100 })
      })
    );
    const inTurn = projectToolExchangesForModel(exchanges, { mode: "in_turn" }).map(tierOf);
    const crossTurn = projectToolExchangesForModel(exchanges, { mode: "cross_turn" }).map(tierOf);
    assert.deepEqual(crossTurn, inTurn);
    assert.deepEqual(crossTurn, ["masked", "compact", "compact", "compact", "compact", "full"]);
  }

  // ── Argument bounding lives under the projection module ───────────────────
  {
    const exchanges = [
      createExchange({
        id: "args-1",
        name: "files",
        payload: createFilesPayload({ contentChars: 50 })
      })
    ];
    exchanges[0]!.toolCall.arguments = { payload: "x".repeat(2_000) };
    const projected = projectToolExchangesForModel(exchanges, { mode: "cross_turn" });
    const serialized = JSON.stringify(projected[0]!.toolCall.arguments);
    assert.ok(serialized.length <= TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS);
    assert.ok(serialized.includes("tool arguments truncated"));
  }

  // ── S4 metrics: project once, char + tier counts, log format ──────────────
  {
    const exchanges = Array.from({ length: 7 }, (_, index) =>
      createExchange({
        id: `m-${String(index)}`,
        name: "browser",
        payload: createBrowserPayload({
          contentChars: 2_000,
          elementCount: 20
        })
      })
    );
    const rawChars = exchanges.reduce(
      (sum, exchange) => sum + exchange.toolResult.content.length,
      0
    );
    const { exchanges: projected, metrics } = projectToolExchangesForModelWithMetrics(exchanges, {
      mode: "in_turn"
    });
    assert.equal(projected.length, 7);
    assert.equal(metrics.rawChars, rawChars);
    assert.ok(metrics.projectedChars < metrics.rawChars);
    assert.equal(metrics.fullCount, 1);
    assert.equal(metrics.compactCount, 4);
    assert.equal(metrics.maskedCount, 2);
    const logLine = formatToolHistoryProjectionMetricsLog({
      requestId: "req-s4",
      metrics
    });
    assert.equal(
      logLine,
      `[toolHistoryProjection] requestId=req-s4 rawChars=${String(metrics.rawChars)} projectedChars=${String(metrics.projectedChars)} fullCount=1 compactCount=4 maskedCount=2`
    );
  }
}
