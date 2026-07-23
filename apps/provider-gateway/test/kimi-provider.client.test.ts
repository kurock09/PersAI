import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import {
  KIMI_BASE_URL,
  KimiProviderClient
} from "../src/modules/providers/kimi/kimi-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: 5,
    PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS: 2_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS: 10_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "kimi",
    model: "kimi-k3",
    systemPrompt: "Be concise.",
    developerInstructions: "Use tools when helpful.",
    messages: [
      {
        role: "user",
        content: "hello"
      }
    ],
    tools: [
      {
        name: "knowledge_search",
        description: "Search knowledge",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" }
          },
          required: ["query"]
        }
      }
    ],
    skillsEnabled: true,
    requestMetadata: {
      classification: "main_turn",
      runtimeRequestId: "req-kimi-1",
      runtimeSessionId: null,
      toolLoopIteration: null,
      compactionToolCode: null
    }
  };
}

async function collectStream(
  stream: AsyncGenerator<ProviderGatewayTextStreamEvent>
): Promise<ProviderGatewayTextStreamEvent[]> {
  const events: ProviderGatewayTextStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

export async function runKimiProviderClientTest(): Promise<void> {
  const client = new KimiProviderClient(createConfig());

  let warmedApiKey: string | null = null;
  let warmedBaseUrl: string | null = null;
  (
    client as unknown as { createClient: (apiKey: string, baseURL: string) => unknown }
  ).createClient = (apiKey: string, baseURL: string) => {
    warmedApiKey = apiKey;
    warmedBaseUrl = baseURL;
    return {};
  };
  await client.warm("kimi-managed-key");
  assert.equal(warmedApiKey, "kimi-managed-key");
  assert.equal(warmedBaseUrl, KIMI_BASE_URL);

  let capturedGeneratePayload: Record<string, unknown> | null = null;
  (client as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (payload: Record<string, unknown>) => {
          capturedGeneratePayload = payload;
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  reasoning_content: "think-step",
                  tool_calls: [
                    {
                      id: "call-1",
                      function: {
                        name: "knowledge_search",
                        arguments: '{"query":"hello"}'
                      }
                    }
                  ]
                }
              }
            ],
            usage: {
              prompt_tokens: 100,
              cached_tokens: 40,
              completion_tokens: 7,
              total_tokens: 107
            }
          };
        }
      }
    }
  };

  const generateResult = await client.generateText(createRequest());
  assert.equal(generateResult.provider, "kimi");
  assert.equal(generateResult.stopReason, "tool_calls");
  assert.equal(generateResult.reasoningContent, "think-step");
  assert.equal(generateResult.toolCalls[0]?.name, "knowledge_search");
  assert.equal(capturedGeneratePayload?.["model"], "kimi-k3");
  assert.equal(capturedGeneratePayload?.["prompt_cache_key"], undefined);
  assert.equal(capturedGeneratePayload?.["prompt_cache_retention"], undefined);
  assert.equal(capturedGeneratePayload?.["parallel_tool_calls"], false);
  assert.deepEqual(capturedGeneratePayload?.["messages"], [
    { role: "system", content: "Be concise." },
    { role: "user", content: "hello" },
    { role: "system", content: "Use tools when helpful." }
  ]);
  assert.deepEqual(generateResult.textUsage, {
    status: "accounted",
    entry: {
      schemaVersion: 2,
      stepType: "main_turn",
      modelRole: null,
      providerKey: "kimi",
      modelKey: "kimi-k3",
      totalInputTokens: 100,
      uncachedInputTokens: 60,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: 40,
      outputTokens: 7,
      totalTokens: 107
    }
  });

  // Multimodal image content maps to Moonshot image_url parts.
  await client.generateText({
    ...createRequest(),
    tools: [],
    skillsEnabled: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "describe" },
          {
            type: "image",
            mimeType: "image/png",
            dataBase64: "abc",
            filename: "a.png"
          }
        ]
      }
    ]
  });
  assert.deepEqual(capturedGeneratePayload?.["messages"], [
    { role: "system", content: "Be concise." },
    {
      role: "user",
      content: [
        { type: "text", text: "describe" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc" }
        }
      ]
    },
    { role: "system", content: "Use tools when helpful." }
  ]);

  // reasoning_content echo on tool history
  await client.generateText({
    ...createRequest(),
    toolHistory: [
      {
        toolCall: {
          id: "call-hist",
          name: "knowledge_search",
          arguments: { query: "q" }
        },
        toolResult: {
          toolCallId: "call-hist",
          name: "knowledge_search",
          content: '{"ok":true}',
          isError: false
        },
        reasoningContent: "prior-reason"
      }
    ]
  });
  const messages = capturedGeneratePayload?.["messages"] as Array<Record<string, unknown>>;
  const assistantWithReasoning = messages.find(
    (message) => message.role === "assistant" && message.reasoning_content === "prior-reason"
  );
  assert.ok(assistantWithReasoning);

  // Moonshot: omit reasoning_effort → default max. Absent budget must send "low".
  await client.generateText(createRequest());
  assert.equal(capturedGeneratePayload?.["reasoning_effort"], "low");
  assert.equal(capturedGeneratePayload?.["max_tokens"], undefined);

  await client.generateText({
    ...createRequest(),
    maxOutputTokens: 2048,
    thinkingBudget: 8_192
  });
  assert.equal(capturedGeneratePayload?.["reasoning_effort"], "low");
  assert.equal(capturedGeneratePayload?.["max_completion_tokens"], 2048);

  await client.generateText({
    ...createRequest(),
    thinkingBudget: 32_768
  });
  assert.equal(capturedGeneratePayload?.["reasoning_effort"], "max");

  // kimi-k2.6: omit thinking → default enabled. Budget 0 must disable.
  await client.generateText({
    ...createRequest(),
    model: "kimi-k2.6",
    thinkingBudget: 0
  });
  assert.deepEqual(capturedGeneratePayload?.["thinking"], { type: "disabled" });
  assert.equal(capturedGeneratePayload?.["reasoning_effort"], undefined);

  await client.generateText({
    ...createRequest(),
    model: "kimi-k2.6",
    thinkingBudget: 8_192
  });
  assert.deepEqual(capturedGeneratePayload?.["thinking"], {
    type: "enabled",
    keep: "all"
  });

  let capturedStreamPayload: Record<string, unknown> | null = null;
  (client as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (payload: Record<string, unknown>) => {
          capturedStreamPayload = payload;
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [
                  {
                    delta: {
                      reasoning_content: "r1",
                      content: "hello "
                    }
                  }
                ]
              };
              yield {
                choices: [
                  {
                    delta: {
                      content: "world"
                    },
                    finish_reason: "stop"
                  }
                ]
              };
              yield {
                choices: [],
                usage: {
                  prompt_tokens: 12,
                  cached_tokens: 4,
                  completion_tokens: 4,
                  total_tokens: 16
                }
              };
            }
          };
        }
      }
    }
  };

  const streamEvents = await collectStream(client.streamText(createRequest()));
  assert.equal(capturedStreamPayload?.["model"], "kimi-k3");
  assert.equal(capturedStreamPayload?.["stream"], true);
  assert.deepEqual(capturedStreamPayload?.["stream_options"], { include_usage: true });
  assert.deepEqual(
    streamEvents.map((event) => event.type),
    ["keepalive", "thinking_delta", "text_delta", "text_delta", "completed"]
  );
  const thinkingDelta = streamEvents.find((event) => event.type === "thinking_delta");
  assert.ok(thinkingDelta && thinkingDelta.type === "thinking_delta");
  assert.equal(thinkingDelta.accumulatedThinking, "r1");
  const completed = streamEvents.find((event) => event.type === "completed");
  assert.ok(completed && completed.type === "completed");
  assert.deepEqual(completed.result.usage, {
    providerKey: "kimi",
    modelKey: "kimi-k3",
    inputTokens: 12,
    cacheCreationInputTokens: null,
    cachedInputTokens: 4,
    outputTokens: 4,
    totalTokens: 16
  });
  assert.deepEqual(completed.result.textUsage, {
    status: "accounted",
    entry: {
      schemaVersion: 2,
      stepType: "main_turn",
      modelRole: null,
      providerKey: "kimi",
      modelKey: "kimi-k3",
      totalInputTokens: 12,
      uncachedInputTokens: 8,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: 4,
      outputTokens: 4,
      totalTokens: 16
    }
  });
}
