import assert from "node:assert/strict";
import {
  hashProviderCacheSemanticPrefix,
  MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS,
  type ProviderGatewayToolExchange
} from "@persai/runtime-contract";
import {
  buildSealedToolExchangeBoundary,
  projectOneToolExchange,
  TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS
} from "../src/modules/turns/project-tool-exchanges-for-model";
import {
  assignMicroClearObservationTier,
  TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT
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
 * ADR-161 A4 — sealed-boundary + per-exchange compactors (micro-clear tiers).
 * ADR-156 in-turn dual-window batch projection is deleted.
 */
export async function runProjectToolExchangesForModelTest(): Promise<void> {
  assert.equal(
    MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS,
    200,
    "ADR-143 out of scope: MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS must stay 200"
  );
  assert.equal(TOOL_OBSERVATION_MICRO_CLEAR_KEEP_FULL_COUNT, 5);

  // ── ADR-161 A1 sealed boundary over full append-only toolHistory ─────────
  {
    for (const exchangeCount of [1, 3, 4, 6, 7, 50]) {
      const completed = Array.from({ length: exchangeCount }, (_, index) =>
        createExchange({
          id: `sealed-${String(exchangeCount)}-${String(index)}`,
          name: index === 0 ? "shell" : "files",
          payload:
            index === 0
              ? createShellPayload({
                  stdoutChars: 1_000,
                  exitCode: exchangeCount === 7 ? 1 : 0,
                  reason: exchangeCount === 7 ? "process_failed" : null
                })
              : createFilesPayload({ contentChars: 1_000 }),
          isError: exchangeCount === 7 && index === 0
        })
      );
      completed[0]!.assistantText = `working note ${String(exchangeCount)}`;
      const priorBoundaries: Array<{ bytes: string; hash: string }> = [];
      for (let index = 0; index < completed.length; index += 1) {
        const prefix = completed.slice(0, index + 1);
        const boundary = buildSealedToolExchangeBoundary(prefix);
        assert.ok(boundary !== null);
        const prior = prefix.slice(0, -1);
        if (prior.length > 0) {
          const previous = priorBoundaries.at(-1)!;
          assert.equal(JSON.stringify(prior), previous.bytes);
          assert.equal(
            hashProviderCacheSemanticPrefix({
              provider: "persai_sealed_spine",
              serializedPrefix: prior
            }).hash,
            previous.hash
          );
          assert.equal(boundary.priorSealedCacheContentHash, previous.hash);
          assert.equal(
            boundary.priorSealedCacheContentChars,
            hashProviderCacheSemanticPrefix({
              provider: "persai_sealed_spine",
              serializedPrefix: prior
            }).chars
          );
        } else {
          assert.equal(boundary.priorSealedCacheContentHash, null);
          assert.equal(boundary.priorSealedCacheContentChars, null);
        }
        priorBoundaries.push({
          bytes: JSON.stringify(prefix),
          hash: boundary.cacheContentHash
        });
      }

      const boundary = buildSealedToolExchangeBoundary(completed);
      assert.equal(boundary?.exchangeCount, exchangeCount);
      assert.equal(boundary?.cacheContentHash, priorBoundaries.at(-1)?.hash);
      assert.equal(boundary?.boundaryKind, "sealed_tool_exchange_spine");
      assert.equal(completed[0]!.assistantText, `working note ${String(exchangeCount)}`);
      assert.equal(
        parseContent(completed[0]!)._observationTier,
        undefined,
        "A1 full-at-insert history is canonical sanitized content, not compact projection"
      );
    }
  }

  // Empty history has no sealed boundary.
  {
    assert.equal(buildSealedToolExchangeBoundary([]), null);
  }

  // ── Micro-clear age tiers (keep newest 5 full) ────────────────────────────
  {
    assert.equal(
      assignMicroClearObservationTier({ index: 0, exchangeCount: 7, isError: false }),
      "masked"
    );
    assert.equal(
      assignMicroClearObservationTier({ index: 1, exchangeCount: 7, isError: false }),
      "masked"
    );
    assert.equal(
      assignMicroClearObservationTier({ index: 2, exchangeCount: 7, isError: false }),
      "full"
    );
    assert.equal(
      assignMicroClearObservationTier({ index: 6, exchangeCount: 7, isError: false }),
      "full"
    );
    assert.equal(
      assignMicroClearObservationTier({ index: 0, exchangeCount: 7, isError: true }),
      "compact",
      "micro-clear error exchanges must never fall to bare mask"
    );
  }

  // ── Browser × full / compact / masked via projectOneToolExchange ──────────
  {
    const fullPayload = createBrowserPayload();
    const exchange = createExchange({ id: "b0", name: "browser", payload: fullPayload });
    const masked = projectOneToolExchange(exchange, "masked");
    const compact = projectOneToolExchange(exchange, "compact");
    const full = projectOneToolExchange(exchange, "full");
    assert.equal(tierOf(masked), "masked");
    assert.equal(tierOf(compact), "compact");
    assert.equal(tierOf(full), "full");

    const maskedBody = parseContent(masked);
    assert.equal(maskedBody.toolCode, "browser");
    assert.equal(typeof maskedBody.gist, "string");
    assert.equal(maskedBody.page, undefined);
    assert.match(String(maskedBody.gist), /masked browser observation/);

    const compactBody = parseContent(compact);
    assert.equal(compactBody.toolCode, "browser");
    assert.equal(compactBody.action, "snapshot");
    assert.equal(compactBody.finalUrl, "https://shop.example/catalog");
    assert.equal(compactBody.title, "Catalog");
    assert.equal(compactBody.elementCount, MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS);
    assert.equal(compactBody.extractedCount, 1);
    assert.equal(compactBody.page, undefined);
    assert.ok(!("content" in compactBody));

    const fullBody = parseContent(full);
    assert.equal(fullBody._observationTier, "full");
    const fullPage = fullBody.page as Record<string, unknown>;
    const originalPage = fullPayload.page as Record<string, unknown>;
    assert.deepEqual(fullPage.elements, originalPage.elements);
    assert.equal(fullPage.content, originalPage.content);
    const fullWithoutTier = { ...fullBody };
    delete fullWithoutTier._observationTier;
    assert.deepEqual(fullWithoutTier, fullPayload);
  }

  // ── Shell × full / compact / masked ───────────────────────────────────────
  {
    const shellFull = createShellPayload({ stdoutChars: 4_000 });
    const exchange = createExchange({ id: "s0", name: "shell", payload: shellFull });
    const compact = parseContent(projectOneToolExchange(exchange, "compact"));
    assert.equal(compact.toolCode, "shell");
    assert.equal(compact.exitCode, 0);
    assert.equal(typeof compact.stdoutTail, "string");
    assert.ok(String(compact.stdoutTail).length <= 500);
    assert.equal(compact.stderrTail, undefined);
    assert.deepEqual(compact.paths, ["/workspace/assistants/a/sessions/s/out.txt"]);
    assert.equal(compact.job, undefined);
    assert.ok(!("stdout" in compact));

    const full = parseContent(projectOneToolExchange(exchange, "full"));
    const fullWithoutTier = { ...full };
    delete fullWithoutTier._observationTier;
    assert.deepEqual(fullWithoutTier, shellFull);
  }

  // ── Files × full / compact / masked ───────────────────────────────────────
  {
    const filesFull = createFilesPayload({ contentChars: 3_000 });
    const exchange = createExchange({ id: "f0", name: "files", payload: filesFull });
    const compact = parseContent(projectOneToolExchange(exchange, "compact"));
    assert.equal(compact.toolCode, "files");
    assert.equal(compact.action, "read");
    assert.equal(compact.path, "/workspace/assistants/a/sessions/s/notes.md");
    assert.equal(compact.charCount, 3_000);
    assert.equal(compact.truncated, false);
    assert.equal(compact.content, undefined);

    const full = parseContent(projectOneToolExchange(exchange, "full"));
    const fullWithoutTier = { ...full };
    delete fullWithoutTier._observationTier;
    assert.deepEqual(fullWithoutTier, filesFull);
  }

  // ── Script compact placeholder drops exact output ─────────────────────────
  {
    const exactOutput = {
      echoed: "founder live value",
      totals: { accepted: 3, rejected: 1 },
      rows: Array.from({ length: 100 }, (_, index) => ({
        index,
        value: `exact-script-row-${String(index)}`
      }))
    };
    const canonical = createExchange({
      id: "script-1",
      name: "script",
      payload: createScriptPayload(exactOutput)
    });
    const snapshot = structuredClone(canonical);
    const full = parseContent(projectOneToolExchange(canonical, "full"));
    const compact = parseContent(projectOneToolExchange(canonical, "compact"));
    assert.deepEqual(full.output, exactOutput);
    assert.equal(compact.toolCode, "script.execute");
    assert.equal(compact.action, "completed");
    assert.equal(compact.outputPresent, true);
    assert.equal("output" in compact, false);
    assert.deepEqual(canonical, snapshot, "projectOneToolExchange must not mutate canonical");
    assert.equal(parseContent(canonical)._observationTier, undefined);
  }

  // ── Generic × full / compact / masked ─────────────────────────────────────
  {
    const genericFull = createGenericPayload();
    const exchange = createExchange({ id: "g0", name: "web_search", payload: genericFull });
    const compact = parseContent(projectOneToolExchange(exchange, "compact"));
    assert.equal(compact.toolCode, "web_search");
    assert.equal(compact.action, "searched");
    assert.equal(compact.resultsCount, 20);
    assert.equal(typeof compact.blobTail, "string");
    assert.ok(String(compact.blobTail).length <= 400);
    assert.equal(compact.results, undefined);
    assert.equal(compact.blob, undefined);

    const masked = parseContent(projectOneToolExchange(exchange, "masked"));
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
    const projected = projectOneToolExchange(errorExchange, "compact");
    assert.equal(tierOf(projected), "compact");
    assert.equal(projected.toolResult.isError, true);
    const compact = parseContent(projected);
    assert.equal(compact.reason, "process_failed");
    assert.equal(compact.exitCode, 1);
    assert.equal(compact.isError, true);
    assert.equal(typeof compact.stderrTail, "string");
    assert.ok(String(compact.stderrTail).length <= 500);
    assert.ok(String(compact.stderrTail).length > 0);
    assert.equal(compact.gist, undefined);
  }

  // ── Argument bounding lives under the projection module ───────────────────
  {
    const exchange = createExchange({
      id: "args-1",
      name: "files",
      payload: createFilesPayload({ contentChars: 50 })
    });
    exchange.toolCall.arguments = { payload: "x".repeat(2_000) };
    const projected = projectOneToolExchange(exchange, "full");
    const serialized = JSON.stringify(projected.toolCall.arguments);
    assert.ok(serialized.length <= TOOL_OBSERVATION_ARGUMENTS_MAX_SERIALIZED_CHARS);
    assert.ok(serialized.includes("tool arguments truncated"));
  }
}
