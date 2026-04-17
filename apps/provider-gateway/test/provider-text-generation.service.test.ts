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
      usage: null,
      stopReason: "completed",
      toolCalls: []
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
        usage: null,
        stopReason: "completed",
        toolCalls: []
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
      usage: null,
      stopReason: "completed",
      toolCalls: []
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
        usage: null,
        stopReason: "completed",
        toolCalls: []
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
    ...(provider === "openai"
      ? {
          promptCache: {
            key: "persai:ordinary_chat:bundle-hash-1:b03",
            retention: "in_memory" as const
          }
        }
      : {}),
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
  assert.deepEqual(openaiClient.calls[0]?.promptCache, {
    key: "persai:ordinary_chat:bundle-hash-1:b03",
    retention: "in_memory"
  });

  warmupService.snapshot.providers[0] = {
    ...warmupService.snapshot.providers[0]!,
    catalogModels: ["gpt‑5.4-mini"]
  };
  const normalizedCatalogResult = await service.generateText({
    ...createRequest("openai"),
    model: "gpt-5.4-mini"
  });
  assert.equal(normalizedCatalogResult.text, "openai-result");
  assert.equal(openaiClient.calls.length, 2);
  warmupService.snapshot.providers[0] = {
    ...warmupService.snapshot.providers[0]!,
    catalogModels: ["gpt-5.4"]
  };

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
  assert.equal(openaiClient.calls.length, 3);

  const anthropicResult = await service.generateText(createRequest("anthropic"));
  assert.equal(anthropicResult.text, "anthropic-result");
  assert.equal(anthropicClient.calls.length, 1);

  const structuredOpenAIResult = await service.generateText({
    ...createRequest("openai"),
    outputSchema: {
      name: "shared_compaction",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          stableFacts: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: ["stableFacts"]
      },
      strict: true
    }
  });
  assert.equal(structuredOpenAIResult.text, "openai-result");
  assert.equal(openaiClient.calls.at(-1)?.outputSchema?.name, "shared_compaction");

  const historicalToolResult = await service.generateText({
    ...createRequest("openai"),
    tools: [
      {
        name: "knowledge_search",
        description: "Search knowledge",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string"
            }
          },
          required: ["query"]
        }
      }
    ],
    toolHistory: [
      {
        toolCall: {
          id: "call-route-control-1",
          name: "route_control",
          arguments: {
            reason: "Need smarter routing."
          }
        },
        toolResult: {
          toolCallId: "call-route-control-1",
          name: "route_control",
          content:
            '{"toolCode":"route_control","action":"planned","modelRole":"reasoning","lookupStrategy":"web_required"}',
          isError: false
        }
      }
    ],
    requestMetadata: {
      classification: "tool_loop_followup",
      runtimeRequestId: "request-2",
      runtimeSessionId: "session-2",
      toolLoopIteration: 1,
      compactionToolCode: null
    }
  });
  assert.equal(historicalToolResult.text, "openai-result");
  assert.equal(openaiClient.calls.at(-1)?.toolHistory?.[0]?.toolCall.name, "route_control");
  assert.equal(openaiClient.calls.at(-1)?.tools?.[0]?.name, "knowledge_search");

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

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        promptCache: {
          key: "x".repeat(65),
          retention: "in_memory"
        },
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }),
    /promptCache.key must be at most 64 characters when provided/
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        promptCache: {
          retention: "forever" as "in_memory"
        },
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }),
    /promptCache.retention must be one of the supported provider prompt cache retention values/
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        outputSchema: {
          name: "",
          schema: {
            type: "object"
          }
        }
      }),
    /outputSchema.name must be 1-64 chars/
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        requestMetadata: {
          classification: "tool_loop_followup",
          runtimeRequestId: "request-1",
          runtimeSessionId: "session-1",
          toolLoopIteration: 0,
          compactionToolCode: null
        }
      }),
    /toolLoopIteration must be >= 1/
  );
}
