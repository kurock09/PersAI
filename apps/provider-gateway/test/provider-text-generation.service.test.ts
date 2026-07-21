import assert from "node:assert/strict";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import type { ProviderWarmupSnapshot } from "../src/modules/providers/provider-client.types";
import { normalizeModelKey } from "../src/modules/providers/model-key-normalization";
import { ProviderTextGenerationService } from "../src/modules/providers/provider-text-generation.service";
import type { ProviderWarmupService } from "../src/modules/providers/provider-warmup.service";
import type { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";
import type { DeepSeekProviderClient } from "../src/modules/providers/deepseek/deepseek-provider.client";
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
      },
      {
        provider: "deepseek",
        configured: true,
        state: "ready",
        catalogModels: ["deepseek-v4-flash"],
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

  async ensureReadyForRequest(input: {
    provider: "openai" | "anthropic" | "deepseek";
    model: string;
  }): Promise<ProviderWarmupSnapshot["providers"][number]> {
    const providerState = this.snapshot.providers.find(
      (provider) => provider.provider === input.provider
    );
    if (!providerState || providerState.state !== "ready") {
      throw new Error(`Provider "${input.provider}" is not ready.`);
    }
    if (
      providerState.catalogModels.length > 0 &&
      !providerState.catalogModels
        .map((model) => normalizeModelKey(model))
        .includes(normalizeModelKey(input.model))
    ) {
      throw new Error(
        `Model "${input.model}" is not present in the warmed provider catalog for "${input.provider}".`
      );
    }
    return providerState;
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
      textUsage: { status: "usage_unavailable", reason: "fixture" },
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
        textUsage: { status: "usage_unavailable", reason: "fixture" },
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
      textUsage: { status: "usage_unavailable", reason: "fixture" },
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
        textUsage: { status: "usage_unavailable", reason: "fixture" },
        stopReason: "completed",
        toolCalls: []
      }
    };
  }
}

class FakeDeepSeekProviderClient {
  calls: ProviderGatewayTextGenerateRequest[] = [];
  streamCalls: ProviderGatewayTextGenerateRequest[] = [];

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.calls.push(input);
    return {
      provider: "deepseek",
      model: input.model,
      text: "deepseek-result",
      respondedAt: "2026-04-11T12:00:05.000Z",
      usage: null,
      textUsage: { status: "usage_unavailable", reason: "fixture" },
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
      delta: "deepseek-",
      accumulatedText: "deepseek-"
    };
    yield {
      type: "completed",
      result: {
        provider: "deepseek",
        model: input.model,
        text: "deepseek-stream",
        respondedAt: "2026-04-11T12:00:06.000Z",
        usage: null,
        textUsage: { status: "usage_unavailable", reason: "fixture" },
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

function createRequest(
  provider: "openai" | "anthropic" | "deepseek"
): ProviderGatewayTextGenerateRequest {
  return {
    provider,
    model:
      provider === "openai"
        ? "gpt-5.4"
        : provider === "anthropic"
          ? "claude-sonnet-4-5"
          : "deepseek-v4-flash",
    systemPrompt: "Be helpful.",
    ...(provider === "openai"
      ? {
          promptCache: {
            key: "persai:ordinary_chat:bundle-hash-1:b03",
            openaiPolicy: { mode: "automatic", retention: "in_memory" as const }
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
  const deepseekClient = new FakeDeepSeekProviderClient();
  const service = new ProviderTextGenerationService(
    warmupService as unknown as ProviderWarmupService,
    openaiClient as unknown as OpenAIProviderClient,
    anthropicClient as unknown as AnthropicProviderClient,
    deepseekClient as unknown as DeepSeekProviderClient
  );

  const openaiResult = await service.generateText(createRequest("openai"));
  assert.equal(openaiResult.text, "openai-result");
  assert.deepEqual(openaiResult.textUsage, { status: "usage_unavailable", reason: "fixture" });
  assert.equal(openaiClient.calls.length, 1);
  assert.equal(anthropicClient.calls.length, 0);
  assert.deepEqual(openaiClient.calls[0]?.promptCache, {
    key: "persai:ordinary_chat:bundle-hash-1:b03",
    openaiPolicy: { mode: "automatic", retention: "in_memory" }
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

  const deepseekResult = await service.generateText(createRequest("deepseek"));
  assert.equal(deepseekResult.text, "deepseek-result");
  assert.equal(deepseekClient.calls.length, 1);

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
          id: "call-knowledge-search-1",
          name: "knowledge_search",
          arguments: {
            query: "routing architecture"
          }
        },
        toolResult: {
          toolCallId: "call-knowledge-search-1",
          name: "knowledge_search",
          content:
            '{"toolCode":"knowledge_search","action":"completed","query":"routing architecture"}',
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
  assert.equal(openaiClient.calls.at(-1)?.toolHistory?.[0]?.toolCall.name, "knowledge_search");
  assert.equal(openaiClient.calls.at(-1)?.tools?.[0]?.name, "knowledge_search");

  const openaiStream = await service.streamText(createRequest("openai"));
  const openaiStreamEvents = await collectStreamEvents(openaiStream);
  assert.equal(openaiClient.streamCalls.length, 1);
  assert.deepEqual(
    openaiStreamEvents.map((event) => event.type),
    ["text_delta", "completed"]
  );

  const deepseekStream = await service.streamText(createRequest("deepseek"));
  const deepseekStreamEvents = await collectStreamEvents(deepseekStream);
  assert.equal(deepseekClient.streamCalls.length, 1);
  assert.deepEqual(
    deepseekStreamEvents.map((event) => event.type),
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
          openaiPolicy: { mode: "automatic", retention: "in_memory" }
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
          openaiPolicy: { mode: "automatic", retention: "forever" as "in_memory" }
        },
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      }),
    /promptCache.openaiPolicy is invalid/
  );

  warmupService.snapshot.providers[0] = {
    provider: "openai",
    configured: true,
    state: "ready",
    catalogModels: ["gpt-5.4"],
    catalogSource: "control_plane_apply",
    warmedAt: "2026-04-11T12:00:00.000Z",
    error: null
  };
  const uncachedOpenAIRequest = createRequest("openai");
  delete uncachedOpenAIRequest.promptCache;
  const uncachedOpenAIResult = await service.generateText(uncachedOpenAIRequest);
  assert.equal(uncachedOpenAIResult.text, "openai-result");
  assert.equal(openaiClient.calls.at(-1)?.promptCache, undefined);

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        promptCache: {
          openaiPolicy: {
            mode: "automatic",
            retention: "in_memory",
            unknown: true
          } as unknown as { mode: "automatic"; retention: "in_memory" }
        }
      }),
    /promptCache.openaiPolicy is invalid/
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

  // ADR-097 Slice 3: timeoutMsHint validation
  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        timeoutMsHint: 0
      }),
    /timeoutMsHint must be a positive integer/,
    "zero timeoutMsHint must be rejected"
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        timeoutMsHint: -500
      }),
    /timeoutMsHint must be a positive integer/,
    "negative timeoutMsHint must be rejected"
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        timeoutMsHint: 600_001
      }),
    /timeoutMsHint must not exceed 600000ms/,
    "timeoutMsHint exceeding 600s must be rejected"
  );

  // ADR-121 Slice 3 — thinkingBudget validation
  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        thinkingBudget: -1
      }),
    /thinkingBudget must be a non-negative integer when provided/,
    "negative thinkingBudget must be rejected"
  );

  await assert.rejects(
    () =>
      service.generateText({
        ...createRequest("openai"),
        thinkingBudget: 1.5
      }),
    /thinkingBudget must be a non-negative integer when provided/,
    "non-integer thinkingBudget must be rejected"
  );

  warmupService.snapshot.providers[0] = {
    provider: "openai",
    configured: true,
    state: "ready",
    catalogModels: ["gpt-5.4"],
    catalogSource: "control_plane_apply",
    warmedAt: "2026-04-11T12:00:00.000Z",
    error: null
  };

  const validZeroBudgetResult = await service.generateText({
    ...createRequest("openai"),
    thinkingBudget: 0
  });
  assert.equal(validZeroBudgetResult.text, "openai-result", "thinkingBudget 0 must be accepted");

  const validPositiveBudgetResult = await service.generateText({
    ...createRequest("anthropic"),
    thinkingBudget: 8_192
  });
  assert.equal(
    validPositiveBudgetResult.text,
    "anthropic-result",
    "positive integer thinkingBudget must be accepted"
  );
}
