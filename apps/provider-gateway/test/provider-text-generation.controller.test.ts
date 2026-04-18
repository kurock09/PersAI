import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { ProviderTextGenerationController } from "../src/modules/providers/interface/http/provider-text-generation.controller";
import type { ProviderTextGenerationService } from "../src/modules/providers/provider-text-generation.service";

class FakeProviderTextGenerationService {
  calls: Array<{ body: ProviderGatewayTextGenerateRequest; signal?: AbortSignal }> = [];
  order: string[] = [];
  streamFactory:
    | ((body: ProviderGatewayTextGenerateRequest) => AsyncGenerator<ProviderGatewayTextStreamEvent>)
    | null = null;

  async streamText(
    body: ProviderGatewayTextGenerateRequest,
    signal?: AbortSignal
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    this.calls.push({
      body,
      ...(signal === undefined ? {} : { signal })
    });
    if (this.streamFactory !== null) {
      return this.streamFactory(body);
    }
    const order = this.order;
    return (async function* () {
      order.push("generator_started");
      yield {
        type: "completed",
        result: {
          provider: "openai",
          model: body.model,
          text: "done",
          respondedAt: "2026-04-18T09:30:00.000Z",
          usage: null,
          stopReason: "completed",
          toolCalls: []
        }
      };
    })();
  }
}

class FakeRequest extends EventEmitter {}

class FakeResponse extends EventEmitter {
  headers = new Map<string, string>();
  writes: string[] = [];
  writableEnded = false;
  order: string[] = [];

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
    this.order.push(`header:${name}`);
  }

  flushHeaders(): void {
    this.order.push("flushHeaders");
  }

  write(chunk: string): void {
    this.writes.push(chunk);
    this.order.push("write");
  }

  flush(): void {
    this.order.push("flush");
  }

  end(): void {
    this.writableEnded = true;
    this.order.push("end");
  }
}

function createRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "openai",
    model: "gpt-5.4-mini",
    systemPrompt: "Be helpful.",
    messages: [
      {
        role: "user",
        content: "hello"
      }
    ]
  };
}

export async function runProviderTextGenerationControllerTest(): Promise<void> {
  const service = new FakeProviderTextGenerationService();
  const controller = new ProviderTextGenerationController(
    service as unknown as ProviderTextGenerationService
  );
  const req = new FakeRequest();
  const res = new FakeResponse();
  const body = createRequest();

  await controller.streamText(req as never, res as never, body);

  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0]?.body.model, "gpt-5.4-mini");
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("Connection"), "keep-alive");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");
  assert.ok(res.writes[0]?.includes('"type":"completed"'));
  assert.equal(res.writableEnded, true);

  const combinedOrder = [...res.order.slice(0, 5), ...service.order];
  assert.deepEqual(combinedOrder, [
    "header:Content-Type",
    "header:Cache-Control",
    "header:Connection",
    "header:X-Accel-Buffering",
    "flushHeaders",
    "generator_started"
  ]);

  service.streamFactory = (streamBody) =>
    (async function* () {
      yield {
        type: "text_delta",
        delta: "Hel",
        accumulatedText: "Hel"
      };
      yield {
        type: "text_delta",
        delta: "lo",
        accumulatedText: "Hello"
      };
      yield {
        type: "completed",
        result: {
          provider: "openai",
          model: streamBody.model,
          text: "Hello",
          respondedAt: "2026-04-18T09:30:01.000Z",
          usage: null,
          stopReason: "completed",
          toolCalls: []
        }
      };
    })();

  const resWithBatchedDeltas = new FakeResponse();
  await controller.streamText(req as never, resWithBatchedDeltas as never, body);
  assert.equal(resWithBatchedDeltas.writes.length, 2);
  assert.ok(
    resWithBatchedDeltas.writes[0]?.includes('"type":"text_delta"') &&
      resWithBatchedDeltas.writes[0]?.includes('"delta":"Hello"') &&
      resWithBatchedDeltas.writes[0]?.includes('"accumulatedText":"Hello"')
  );
  assert.ok(resWithBatchedDeltas.writes[1]?.includes('"type":"completed"'));
}
