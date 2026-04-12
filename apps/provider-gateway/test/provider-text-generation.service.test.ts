import assert from "node:assert/strict";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import type { ProviderWarmupSnapshot } from "../src/modules/providers/provider-client.types";
import { ProviderTextGenerationService } from "../src/modules/providers/provider-text-generation.service";
import type { ProviderWarmupService } from "../src/modules/providers/provider-warmup.service";
import type { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";
import type { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";

function createWarmupSnapshot(): ProviderWarmupSnapshot {
  return {
    schema: "persai.providerGatewayWarmup.v1",
    warmOnBoot: false,
    runs: 1,
    failures: 0,
    lastAttemptedAt: null,
    lastCompletedAt: null,
    lastDurationMs: null,
    providers: [
      {
        provider: "openai",
        configured: true,
        state: "ready",
        catalogModels: ["gpt-5.4"],
        catalogSource: "control_plane_apply",
        warmedAt: "2026-04-11T12:00:00.000Z",
        error: null
      },
      {
        provider: "anthropic",
        configured: true,
        state: "ready",
        catalogModels: ["claude-sonnet-4-5"],
        catalogSource: "control_plane_apply",
        warmedAt: "2026-04-11T12:00:00.000Z",
        error: null
      }
    ]
  };
}

class FakeProviderWarmupService {
  snapshot = createWarmupSnapshot();

  getSnapshot(): ProviderWarmupSnapshot {
    return this.snapshot;
  }
}

class FakeOpenAIProviderClient {
  calls: ProviderGatewayTextGenerateRequest[] = [];
  streamCalls: ProviderGatewayTextGenerateRequest[] = [];

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.calls.push(input);
    return {
      provider: "openai",
      model: input.model,
      text: "openai-result",
      respondedAt: "2026-04-11T12:00:01.000Z",
      usage: null
    };
  }

  async *streamText(
    input: ProviderGatewayTextGenerateRequest
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    this.streamCalls.push(input);
    yield {
      type: "text_delta",
      delta: "openai-",
      accumulatedText: "openai-"
    };
    yield {
      type: "completed",
      result: {
        provider: "openai",
        model: input.model,
        text: "openai-stream",
        respondedAt: "2026-04-11T12:00:03.000Z",
        usage: null
      }
    };
  }
}

class FakeAnthropicProviderClient {
  calls: ProviderGatewayTextGenerateRequest[] = [];
  streamCalls: ProviderGatewayTextGenerateRequest[] = [];

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.calls.push(input);
    return {
      provider: "anthropic",
      model: input.model,
      text: "anthropic-result",
      respondedAt: "2026-04-11T12:00:02.000Z",
      usage: null
    };
  }

  async *streamText(
    input: ProviderGatewayTextGenerateRequest
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    this.streamCalls.push(input);
    yield {
      type: "text_delta",
      delta: "anthropic-",
      accumulatedText: "anthropic-"
    };
    yield {
      type: "completed",
      result: {
        provider: "anthropic",
        model: input.model,
        text: "anthropic-stream",
        respondedAt: "2026-04-11T12:00:04.000Z",
        usage: null
      }
    };
  }
}

async function collectStreamEvents(
  generator: AsyncGenerator<ProviderGatewayTextStreamEvent>
): Promise<ProviderGatewayTextStreamEvent[]> {
  const events: ProviderGatewayTextStreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

function createRequest(provider: "openai" | "anthropic"): ProviderGatewayTextGenerateRequest {
  return {
    provider,
    model: provider === "openai" ? "gpt-5.4" : "claude-sonnet-4-5",
    systemPrompt: "Be helpful.",
    messages: [
      {
        role: "user",
        content: "hello"
      }
    ]
  };
}

export async function runProviderTextGenerationServiceTest(): Promise<void> {
  const warmupService = new FakeProviderWarmupService();
  const openaiClient = new FakeOpenAIProviderClient();
  const anthropicClient = new FakeAnthropicProviderClient();
  const service = new ProviderTextGenerationService(
    warmupService as unknown as ProviderWarmupService,
    openaiClient as unknown as OpenAIProviderClient,
    anthropicClient as unknown as AnthropicProviderClient
  );

  const openaiResult = await service.generateText(createRequest("openai"));
  assert.equal(openaiResult.text, "openai-result");
  assert.equal(openaiClient.calls.length, 1);
  assert.equal(anthropicClient.calls.length, 0);

  const multimodalResult = await service.generateText({
    ...createRequest("openai"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "inspect this"
          },
          {
            type: "image",
            mimeType: "image/png",
            dataBase64: "aGVsbG8=",
            filename: "diagram.png"
          },
          {
            type: "pdf",
            mimeType: "application/pdf",
            dataBase64: "cGRmLWRhdGE=",
            filename: "report.pdf"
          }
        ]
      }
    ]
  });
  assert.equal(multimodalResult.text, "openai-result");
  assert.equal(openaiClient.calls.length, 2);

  const anthropicResult = await service.generateText(createRequest("anthropic"));
  assert.equal(anthropicResult.text, "anthropic-result");
  assert.equal(anthropicClient.calls.length, 1);

  const openaiStream = await service.streamText(createRequest("openai"));
  const openaiStreamEvents = await collectStreamEvents(openaiStream);
  assert.equal(openaiClient.streamCalls.length, 1);
  assert.deepEqual(
    openaiStreamEvents.map((event) => event.type),
    ["text_delta", "completed"]
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        model: "gpt-unknown"
      }),
    /not present in the warmed provider catalog/
  );

  warmupService.snapshot.providers[0] = {
    provider: "openai",
    configured: true,
    state: "failed",
    catalogModels: ["gpt-5.4"],
    catalogSource: "control_plane_apply",
    warmedAt: "2026-04-11T12:00:00.000Z",
    error: "warmup failed"
  };
  await assert.rejects(() => service.generateText(createRequest("openai")), /not ready/);

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("anthropic"),
        messages: []
      }),
    /messages must include at least one item/
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "pdf",
                mimeType: "application/pdf",
                dataBase64: "",
                filename: "bad.pdf"
              }
            ]
          }
        ]
      }),
    /dataBase64 must be non-empty/
  );
}
