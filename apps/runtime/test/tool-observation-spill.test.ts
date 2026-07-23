import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import { buildPriorToolExchangeReplayMap } from "../src/modules/turns/prior-tool-exchange-replay";
import { projectOneToolExchange } from "../src/modules/turns/project-tool-exchanges-for-model";
import {
  TOOL_WIRE_SOFT_MAX_CHARS,
  buildToolAwareSummarySource,
  buildToolSpillPath,
  buildToolSpillReceipt,
  demoteAllToolExchangesToReceipts,
  demoteOlderToolExchangesToReceipts,
  exceedsToolWireSoftMax,
  isToolSpillReceiptContent,
  sealToolExchangeSpill,
  stubOversizedToolArguments,
  summarizeSpillBody,
  type ToolSpillSealMeta
} from "../src/modules/turns/tool-observation-spill";

function createExchange(input: {
  id: string;
  name: string;
  argumentsValue?: Record<string, unknown>;
  content: string;
  isError?: boolean;
}): ProviderGatewayToolExchange {
  return {
    toolCall: {
      id: input.id,
      name: input.name,
      arguments: input.argumentsValue ?? { action: "read" }
    },
    toolResult: {
      toolCallId: input.id,
      name: input.name,
      content: input.content,
      isError: input.isError === true
    }
  };
}

type SpillWriteRecord = { path: string; content: string };

function createWriteSpillRecorder(): {
  writes: SpillWriteRecord[];
  writeSpill: (input: SpillWriteRecord) => Promise<{
    sha256: string;
    bytes: number;
  }>;
} {
  const writes: SpillWriteRecord[] = [];
  return {
    writes,
    writeSpill: async (input) => {
      writes.push(input);
      return {
        sha256: createHash("sha256").update(input.content, "utf8").digest("hex"),
        bytes: Buffer.byteLength(input.content, "utf8")
      };
    }
  };
}

export async function runToolObservationSpillTest(): Promise<void> {
  assert.equal(
    buildToolSpillPath({
      assistantStableKey: "assistant-1",
      sessionId: "session-1",
      requestId: "req-1",
      toolCallId: "call-1",
      direction: "out",
      ext: "json"
    }),
    "/workspace/assistants/assistant-1/sessions/session-1/.tool-spill/req-1/call-1.out.json"
  );

  {
    const longBody = "x".repeat(5000);
    const receipt = buildToolSpillReceipt({
      status: "error",
      tool: "files",
      action: "read",
      chars: longBody.length,
      bytes: longBody.length,
      path: "/workspace/assistants/a/sessions/s/.tool-spill/r/c.out.txt",
      summarySource: `error from files: ${longBody}`,
      sha256: createHash("sha256").update(longBody, "utf8").digest("hex"),
      spillKind: "result"
    });
    assert.equal(receipt.status, "error");
    assert.equal(receipt.truncated, true);
    assert.equal(receipt.spillKind, "result");
    assert.ok(receipt.summary.startsWith("error from files:"));
    assert.ok(receipt.summary.length <= 2000);
    assert.ok(summarizeSpillBody("short").length > 0);
    assert.equal(isToolSpillReceiptContent(JSON.stringify(receipt)), true);
    assert.equal(isToolSpillReceiptContent(JSON.stringify({ ok: true })), false);
  }

  // 1. Under threshold: unchanged, no spill write
  {
    const exchange = createExchange({
      id: "c1",
      name: "todo_write",
      content: JSON.stringify({ ok: true, items: [] })
    });
    const sealed = await sealToolExchangeSpill(exchange, {
      assistantStableKey: "assistant-1",
      sessionId: "session-1",
      requestId: "req-1",
      writeSpill: async () => {
        throw new Error("writeSpill must not be called under threshold");
      }
    });
    assert.equal(sealed.exchange, exchange);
    assert.equal(sealed.seal, null);
    assert.equal(exceedsToolWireSoftMax(exchange.toolResult.content), false);
  }

  // 2. Huge result: seal keeps full; demoteOlder after second → first receipt, second full
  //    P2: browser-aware summary includes finalUrl/title/elementCount
  {
    const elements = Array.from({ length: 40 }, (_, index) => ({
      ref: `e${String(index)}`,
      text: `element-${String(index)}-${"n".repeat(250)}`
    }));
    const content = JSON.stringify({
      toolCode: "browser",
      action: "snapshot",
      page: {
        finalUrl: "https://example.com/landing",
        title: "Landing",
        elements
      }
    });
    assert.ok(exceedsToolWireSoftMax(content));
    const recorder = createWriteSpillRecorder();
    const first = createExchange({
      id: "call-browser",
      name: "browser",
      argumentsValue: { action: "snapshot" },
      content
    });
    const sealed = await sealToolExchangeSpill(first, {
      assistantStableKey: "assistant-1",
      sessionId: "session-1",
      requestId: "req-42",
      writeSpill: recorder.writeSpill
    });
    assert.equal(recorder.writes.length, 1);
    assert.ok(recorder.writes[0]?.path.includes("/.tool-spill/req-42/call-browser.out."));
    assert.equal(recorder.writes[0]?.content, content);
    assert.equal(sealed.exchange.toolResult.content, content);
    assert.ok(sealed.seal !== null);
    assert.equal(sealed.seal?.resultPath, recorder.writes[0]?.path);
    assert.equal(sealed.seal?.spillKind, "result");

    const seals = new Map<string, ToolSpillSealMeta>();
    seals.set(sealed.seal!.toolCallId, sealed.seal!);
    const history = [sealed.exchange];

    const secondContent = JSON.stringify({ ok: true, items: [] });
    const second = createExchange({
      id: "call-todo",
      name: "todo_write",
      content: secondContent
    });
    const secondSealed = await sealToolExchangeSpill(second, {
      assistantStableKey: "assistant-1",
      sessionId: "session-1",
      requestId: "req-42",
      writeSpill: async () => {
        throw new Error("second exchange under threshold");
      }
    });
    assert.equal(secondSealed.seal, null);
    history.push(secondSealed.exchange);
    demoteOlderToolExchangesToReceipts(history, seals);

    assert.ok(isToolSpillReceiptContent(history[0]!.toolResult.content));
    const receipt = JSON.parse(history[0]!.toolResult.content) as Record<string, unknown>;
    assert.equal(receipt.status, "ok");
    assert.equal(receipt.tool, "browser");
    assert.equal(receipt.action, "snapshot");
    assert.equal(receipt.truncated, true);
    assert.equal(receipt.spillKind, "result");
    assert.equal(receipt.path, recorder.writes[0]?.path);
    assert.equal(typeof receipt.summary, "string");
    assert.ok(String(receipt.summary).includes("finalUrl=https://example.com/landing"));
    assert.ok(String(receipt.summary).includes("title=Landing"));
    assert.ok(String(receipt.summary).includes("elementCount=40"));
    assert.equal(history[1]!.toolResult.content, secondContent);
  }

  // 2b. P2 shell-aware summary: exitCode + stdout/stderr byte counts + first line
  {
    const stdout = `first useful line\n${"out".repeat(TOOL_WIRE_SOFT_MAX_CHARS)}`;
    const stderr = `warn-${"e".repeat(200)}`;
    const content = JSON.stringify({
      toolCode: "shell",
      job: { exitCode: 0, stdout, stderr }
    });
    assert.ok(exceedsToolWireSoftMax(content));
    const summary = buildToolAwareSummarySource("shell", content, false);
    assert.ok(summary.includes("exitCode=0"));
    assert.ok(summary.includes(`stdoutBytes=${String(Buffer.byteLength(stdout, "utf8"))}`));
    assert.ok(summary.includes(`stderrBytes=${String(Buffer.byteLength(stderr, "utf8"))}`));
    assert.ok(summary.includes("firstLine=first useful line"));

    const recorder = createWriteSpillRecorder();
    const sealed = await sealToolExchangeSpill(
      createExchange({ id: "call-shell", name: "shell", content }),
      {
        assistantStableKey: "assistant-1",
        sessionId: "session-1",
        requestId: "req-shell",
        writeSpill: recorder.writeSpill
      }
    );
    const seals = new Map<string, ToolSpillSealMeta>([
      [sealed.seal!.toolCallId, sealed.seal!]
    ]);
    const history = [
      sealed.exchange,
      createExchange({ id: "later", name: "todo_write", content: '{"ok":true}' })
    ];
    demoteOlderToolExchangesToReceipts(history, seals);
    assert.equal(isToolSpillReceiptContent(history[0]!.toolResult.content), true);
    const receipt = JSON.parse(history[0]!.toolResult.content) as Record<string, unknown>;
    assert.ok(String(receipt.summary).includes("exitCode=0"));
    assert.ok(String(receipt.summary).includes("firstLine=first useful line"));
  }

  // 3. demoteAll → only receipts
  {
    const bodyA = "A".repeat(TOOL_WIRE_SOFT_MAX_CHARS + 10);
    const bodyB = "B".repeat(TOOL_WIRE_SOFT_MAX_CHARS + 20);
    const recorder = createWriteSpillRecorder();
    const seals = new Map<string, ToolSpillSealMeta>();
    const history: ProviderGatewayToolExchange[] = [];

    for (const [id, body] of [
      ["call-a", bodyA],
      ["call-b", bodyB]
    ] as const) {
      const sealed = await sealToolExchangeSpill(
        createExchange({ id, name: "shell", content: body }),
        {
          assistantStableKey: "assistant-1",
          sessionId: "session-1",
          requestId: "req-all",
          writeSpill: recorder.writeSpill
        }
      );
      assert.ok(sealed.seal !== null);
      seals.set(sealed.seal!.toolCallId, sealed.seal!);
      history.push(sealed.exchange);
      demoteOlderToolExchangesToReceipts(history, seals);
    }

    assert.ok(isToolSpillReceiptContent(history[0]!.toolResult.content));
    assert.equal(history[1]!.toolResult.content, bodyB);

    demoteAllToolExchangesToReceipts(history, seals);
    assert.ok(isToolSpillReceiptContent(history[0]!.toolResult.content));
    assert.ok(isToolSpillReceiptContent(history[1]!.toolResult.content));
    for (const exchange of history) {
      assert.equal(isToolSpillReceiptContent(exchange.toolResult.content), true);
      assert.ok(!exchange.toolResult.content.includes(bodyA));
      assert.ok(!exchange.toolResult.content.includes(bodyB));
    }
    const receiptB = JSON.parse(history[1]!.toolResult.content) as Record<string, unknown>;
    assert.equal(receiptB.status, "ok");
    assert.equal(receiptB.spillKind, "result");
  }

  // 3b. Multi-tool wave: preserveFromIndex keeps entire unsent wave full (no blind-first)
  {
    const bodyA = `waveA-${"A".repeat(TOOL_WIRE_SOFT_MAX_CHARS)}`;
    const bodyB = `waveB-${"B".repeat(TOOL_WIRE_SOFT_MAX_CHARS)}`;
    const bodyC = `waveC-${"C".repeat(TOOL_WIRE_SOFT_MAX_CHARS)}`;
    const recorder = createWriteSpillRecorder();
    const seals = new Map<string, ToolSpillSealMeta>();
    const history: ProviderGatewayToolExchange[] = [];
    const waveStart = 0;

    for (const [id, body] of [
      ["call-wave-a", bodyA],
      ["call-wave-b", bodyB]
    ] as const) {
      const sealed = await sealToolExchangeSpill(
        createExchange({ id, name: "browser", content: body }),
        {
          assistantStableKey: "assistant-1",
          sessionId: "session-1",
          requestId: "req-wave",
          writeSpill: recorder.writeSpill
        }
      );
      seals.set(sealed.seal!.toolCallId, sealed.seal!);
      history.push(sealed.exchange);
      demoteOlderToolExchangesToReceipts(history, seals, waveStart);
    }

    assert.equal(history[0]!.toolResult.content, bodyA);
    assert.equal(history[1]!.toolResult.content, bodyB);

    const nextWaveStart = history.length;
    const sealedC = await sealToolExchangeSpill(
      createExchange({ id: "call-wave-c", name: "browser", content: bodyC }),
      {
        assistantStableKey: "assistant-1",
        sessionId: "session-1",
        requestId: "req-wave",
        writeSpill: recorder.writeSpill
      }
    );
    seals.set(sealedC.seal!.toolCallId, sealedC.seal!);
    history.push(sealedC.exchange);
    demoteOlderToolExchangesToReceipts(history, seals, nextWaveStart);

    assert.ok(isToolSpillReceiptContent(history[0]!.toolResult.content));
    assert.ok(isToolSpillReceiptContent(history[1]!.toolResult.content));
    assert.equal(history[2]!.toolResult.content, bodyC);
  }

  // 4. Huge args write: stub immediately; short result ack unchanged
  {
    const hugeHtml = `<html>${"a".repeat(TOOL_WIRE_SOFT_MAX_CHARS)}</html>`;
    const args = { action: "write", path: "/workspace/x.html", content: hugeHtml };
    const shortAck = JSON.stringify({ action: "written", path: "/workspace/x.html" });
    const recorder = createWriteSpillRecorder();
    const sealed = await sealToolExchangeSpill(
      createExchange({
        id: "call-write",
        name: "files",
        argumentsValue: args,
        content: shortAck
      }),
      {
        assistantStableKey: "assistant-1",
        sessionId: "session-1",
        requestId: "req-9",
        writeSpill: recorder.writeSpill
      }
    );
    assert.equal(recorder.writes.length, 1);
    assert.ok(recorder.writes[0]?.path.includes(".in.json"));
    const stubbed = sealed.exchange.toolCall.arguments;
    assert.equal(stubbed.action, "write");
    assert.equal(stubbed.path, "/workspace/x.html");
    const contentStub = stubbed.content as Record<string, unknown>;
    assert.equal(contentStub.__spilled_field, true);
    assert.equal(contentStub.path, recorder.writes[0]?.path);
    assert.ok(!exceedsToolWireSoftMax(JSON.stringify(stubbed)));
    assert.equal(sealed.exchange.toolResult.content, shortAck);
    assert.ok(sealed.seal !== null);
    assert.equal(sealed.seal?.spillKind, "args");
    assert.equal(sealed.seal?.resultPath, undefined);
  }

  // 4b. P3: script-like oversized `input` object stubs field; seriesItems → whole-args
  {
    const hugeInput = {
      html: `<html>${"b".repeat(TOOL_WIRE_SOFT_MAX_CHARS)}</html>`,
      meta: { n: 1 }
    };
    const scriptArgs = {
      action: "execute",
      scriptKey: "landing.render",
      input: hugeInput
    };
    const spillPath = "/workspace/assistants/a/sessions/s/.tool-spill/r/script.in.json";
    const scriptStub = stubOversizedToolArguments({
      argumentsValue: scriptArgs,
      spillPath,
      chars: JSON.stringify(scriptArgs).length
    });
    assert.equal(scriptStub.action, "execute");
    assert.equal(scriptStub.scriptKey, "landing.render");
    const inputStub = scriptStub.input as Record<string, unknown>;
    assert.equal(inputStub.__spilled_field, true);
    assert.equal(inputStub.path, spillPath);
    assert.ok(!exceedsToolWireSoftMax(JSON.stringify(scriptStub)));

    const seriesArgs = {
      action: "generate",
      prompt: "short",
      seriesItems: Array.from({ length: 20 }, (_, index) =>
        `item-${String(index)}-${"z".repeat(TOOL_WIRE_SOFT_MAX_CHARS / 10)}`
      )
    };
    const seriesStub = stubOversizedToolArguments({
      argumentsValue: seriesArgs,
      spillPath,
      chars: JSON.stringify(seriesArgs).length
    });
    assert.equal(seriesStub.__spilled_args, true);
    assert.equal(seriesStub.path, spillPath);
    assert.equal(seriesStub.action, "generate");
  }

  // 5. Error huge result: first-seen stays full with isError; demote → receipt status error
  {
    const content = JSON.stringify({
      reason: "boom",
      detail: "E".repeat(TOOL_WIRE_SOFT_MAX_CHARS + 50)
    });
    const recorder = createWriteSpillRecorder();
    const sealed = await sealToolExchangeSpill(
      createExchange({
        id: "call-err",
        name: "shell",
        content,
        isError: true
      }),
      {
        assistantStableKey: "assistant-1",
        sessionId: "session-1",
        requestId: "req-1",
        writeSpill: recorder.writeSpill
      }
    );
    assert.equal(sealed.exchange.toolResult.content, content);
    assert.equal(sealed.exchange.toolResult.isError, true);
    assert.ok(sealed.seal !== null);
    assert.equal(sealed.seal?.isError, true);

    const seals = new Map<string, ToolSpillSealMeta>([
      [sealed.seal!.toolCallId, sealed.seal!]
    ]);
    const history = [
      sealed.exchange,
      createExchange({ id: "later", name: "todo_write", content: '{"ok":true}' })
    ];
    demoteOlderToolExchangesToReceipts(history, seals);
    assert.equal(history[0]!.toolResult.isError, true);
    const receipt = JSON.parse(history[0]!.toolResult.content) as Record<string, unknown>;
    assert.equal(receipt.status, "error");
    assert.ok(String(receipt.summary).includes("error from shell"));
    assert.equal(isToolSpillReceiptContent(history[0]!.toolResult.content), true);

    // Double-demote is a no-op
    demoteAllToolExchangesToReceipts(history, seals);
    assert.equal(history[0]!.toolResult.content, JSON.stringify(receipt));
  }

  {
    const args = {
      nested: { blob: "z".repeat(TOOL_WIRE_SOFT_MAX_CHARS + 10) }
    };
    const stub = stubOversizedToolArguments({
      argumentsValue: args,
      spillPath: "/workspace/assistants/a/sessions/s/.tool-spill/r/c.in.json",
      chars: JSON.stringify(args).length
    });
    assert.equal(stub.__spilled_args, true);
    assert.equal(typeof stub.path, "string");
    assert.equal(typeof stub.chars, "number");
  }

  // 6. P4: prior replay / projectOneToolExchange keep spill receipts (no MB re-expand)
  {
    const spillPath =
      "/workspace/assistants/a/sessions/s/.tool-spill/r/call-prior.out.json";
    const receipt = buildToolSpillReceipt({
      status: "ok",
      tool: "browser",
      action: "snapshot",
      chars: 2_500_000,
      bytes: 2_500_000,
      path: spillPath,
      summarySource: "finalUrl=https://example.com; title=Landing; elementCount=120",
      spillKind: "result"
    });
    const receiptContent = JSON.stringify(receipt);
    assert.equal(isToolSpillReceiptContent(receiptContent), true);

    const projectedFull = projectOneToolExchange(
      createExchange({
        id: "call-prior",
        name: "browser",
        content: receiptContent
      }),
      "full"
    );
    assert.equal(isToolSpillReceiptContent(projectedFull.toolResult.content), true);
    const fullParsed = JSON.parse(projectedFull.toolResult.content) as Record<string, unknown>;
    assert.equal(fullParsed.path, spillPath);
    assert.equal(fullParsed.truncated, true);
    assert.equal(fullParsed.spillKind, "result");
    assert.ok(!projectedFull.toolResult.content.includes("<html"));
    assert.ok(projectedFull.toolResult.content.length < 10_000);

    const projectedMasked = projectOneToolExchange(
      createExchange({
        id: "call-prior-mask",
        name: "browser",
        content: receiptContent
      }),
      "masked"
    );
    assert.equal(isToolSpillReceiptContent(projectedMasked.toolResult.content), true);
    const maskedParsed = JSON.parse(projectedMasked.toolResult.content) as Record<string, unknown>;
    assert.equal(maskedParsed.path, spillPath);
    assert.equal(maskedParsed._observationTier, "masked");

    const replay = buildPriorToolExchangeReplayMap(
      [
        {
          id: "assistant-prior",
          author: "assistant",
          toolExchanges: [
            createExchange({
              id: "call-prior-replay",
              name: "browser",
              content: receiptContent
            })
          ]
        },
        { id: "user-now", author: "user" }
      ],
      "user-now",
      {
        currentTokens: 1_000,
        totalTokensFresh: true,
        compactionTriggerThreshold: 8_000
      }
    );
    const prior = replay.get("assistant-prior");
    assert.ok(prior !== undefined && prior.length === 1);
    assert.equal(isToolSpillReceiptContent(prior![0]!.toolResult.content), true);
    const replayParsed = JSON.parse(prior![0]!.toolResult.content) as Record<string, unknown>;
    assert.equal(replayParsed.path, spillPath);
    assert.equal(replayParsed.spillKind, "result");
    assert.ok(prior![0]!.toolResult.content.length < 10_000);
  }
}
