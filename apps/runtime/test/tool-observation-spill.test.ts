import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import {
  TOOL_WIRE_SOFT_MAX_CHARS,
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

function createWriteSpillRecorder(): {
  writes: Array<{ path: string; content: string }>;
  writeSpill: (input: { path: string; content: string }) => Promise<{
    sha256: string;
    bytes: number;
  }>;
} {
  const writes: Array<{ path: string; content: string }> = [];
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
  {
    const huge = "H".repeat(TOOL_WIRE_SOFT_MAX_CHARS + 100);
    const content = JSON.stringify({
      toolCode: "files",
      action: "read",
      content: huge
    });
    const recorder = createWriteSpillRecorder();
    const first = createExchange({
      id: "call-read",
      name: "files",
      argumentsValue: { action: "read", path: "/workspace/assistants/a/sessions/s/page.html" },
      content
    });
    const sealed = await sealToolExchangeSpill(first, {
      assistantStableKey: "assistant-1",
      sessionId: "session-1",
      requestId: "req-42",
      writeSpill: recorder.writeSpill
    });
    assert.equal(recorder.writes.length, 1);
    assert.ok(recorder.writes[0]?.path.includes("/.tool-spill/req-42/call-read.out."));
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
    assert.equal(receipt.tool, "files");
    assert.equal(receipt.action, "read");
    assert.equal(receipt.truncated, true);
    assert.equal(receipt.spillKind, "result");
    assert.equal(receipt.path, recorder.writes[0]?.path);
    assert.equal(typeof receipt.summary, "string");
    assert.equal(history[1]!.toolResult.content, secondContent);
  }

  // 3. demoteAll → both receipts
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
    const receiptB = JSON.parse(history[1]!.toolResult.content) as Record<string, unknown>;
    assert.equal(receiptB.status, "ok");
    assert.equal(receiptB.spillKind, "result");
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
}
