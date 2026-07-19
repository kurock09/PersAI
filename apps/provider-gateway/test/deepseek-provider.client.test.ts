import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import {
  DEEPSEEK_BASE_URL,
  DeepSeekProviderClient
} from "../src/modules/providers/deepseek/deepseek-provider.client";

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
    PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    systemPrompt: "Be concise.",
    developerInstructions: "Use tools when helpful.",
    promptCache: {
      key: "persai:ordinary_chat:bundle-hash-1:b03",
      retention: "in_memory"
    },
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
    outputSchema: {
      name: "deepseek_result",
      description: "Structured result",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          answer: { type: "string" }
        },
        required: ["answer"]
      },
      strict: true
    },
    skillsEnabled: true
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

export async function runDeepSeekProviderClientTest(): Promise<void> {
  const client = new DeepSeekProviderClient(createConfig());

  let warmedApiKey: string | null = null;
  let warmedBaseUrl: string | null = null;
  (
    client as unknown as { createClient: (apiKey: string, baseURL: string) => unknown }
  ).createClient = (apiKey: string, baseURL: string) => {
    warmedApiKey = apiKey;
    warmedBaseUrl = baseURL;
    return {};
  };
  await client.warm("deepseek-managed-key");
  assert.equal(warmedApiKey, "deepseek-managed-key");
  assert.equal(warmedBaseUrl, DEEPSEEK_BASE_URL);

  let capturedGeneratePayload: Record<string, unknown> | null = null;
  (client as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (payload: Record<string, unknown>) => {
          capturedGeneratePayload = payload;
          return {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "done",
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
              prompt_tokens: 11,
              completion_tokens: 7,
              total_tokens: 18
            }
          };
        }
      }
    }
  };

  const generateResult = await client.generateText(createRequest());
  assert.equal(generateResult.provider, "deepseek");
  assert.equal(generateResult.stopReason, "tool_calls");
  assert.equal(generateResult.toolCalls[0]?.name, "knowledge_search");
  assert.equal(capturedGeneratePayload?.["model"], "deepseek-v4-flash");
  assert.deepEqual(capturedGeneratePayload?.["messages"], [
    { role: "system", content: "Be concise." },
    { role: "system", content: "Use tools when helpful." },
    { role: "user", content: "hello" }
  ]);
  assert.equal(capturedGeneratePayload?.["prompt_cache_retention"], undefined);
  assert.equal(capturedGeneratePayload?.["prompt_cache_key"], undefined);
  assert.equal(capturedGeneratePayload?.["parallel_tool_calls"], false);
  assert.deepEqual(capturedGeneratePayload?.["tools"], [
    {
      type: "function",
      function: {
        name: "knowledge_search",
        description: "Search knowledge",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" }
          },
          required: ["query"]
        }
      }
    }
  ]);
  assert.deepEqual(capturedGeneratePayload?.["response_format"], {
    type: "json_schema",
    json_schema: {
      name: "deepseek_result",
      description: "Structured result",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          answer: { type: "string" }
        },
        required: ["answer"]
      },
      strict: true
    }
  });

  const replayRequest: ProviderGatewayTextGenerateRequest = {
    ...createRequest(),
    messages: [
      {
        role: "user",
        content: "first question"
      },
      {
        role: "assistant",
        content: "historical answer",
        priorToolExchanges: [
          {
            toolCall: {
              id: "call-prior",
              name: "knowledge_search",
              arguments: { query: "prior question" }
            },
            toolResult: {
              toolCallId: "call-prior",
              name: "knowledge_search",
              content: '{"toolCode":"knowledge_search","action":"completed"}',
              isError: false
            }
          }
        ]
      },
      {
        role: "user",
        content: "current question"
      }
    ],
    toolHistory: [
      {
        toolCall: {
          id: "call-current",
          name: "knowledge_fetch",
          arguments: { source: "memory", referenceId: "memory-1" }
        },
        toolResult: {
          toolCallId: "call-current",
          name: "knowledge_fetch",
          content: '{"toolCode":"knowledge_fetch","action":"completed"}',
          isError: false
        }
      }
    ]
  };
  await client.generateText(replayRequest);
  assert.deepEqual(capturedGeneratePayload?.["messages"], [
    { role: "system", content: "Be concise." },
    { role: "system", content: "Use tools when helpful." },
    { role: "user", content: "first question" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-prior",
          type: "function",
          function: {
            name: "knowledge_search",
            arguments: '{"query":"prior question"}'
          }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call-prior",
      content: '{"toolCode":"knowledge_search","action":"completed"}'
    },
    { role: "assistant", content: "historical answer" },
    { role: "user", content: "current question" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-current",
          type: "function",
          function: {
            name: "knowledge_fetch",
            arguments: '{"source":"memory","referenceId":"memory-1"}'
          }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call-current",
      content: '{"toolCode":"knowledge_fetch","action":"completed"}'
    }
  ]);

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
                  completion_tokens: 4,
                  total_tokens: 16,
                  prompt_tokens_details: { cached_tokens: 2 }
                }
              };
            }
          };
        }
      }
    }
  };

  const streamEvents = await collectStream(await client.streamText(createRequest()));
  assert.equal(capturedStreamPayload?.["model"], "deepseek-v4-flash");
  assert.equal(capturedStreamPayload?.["stream"], true);
  assert.deepEqual(capturedStreamPayload?.["stream_options"], { include_usage: true });
  assert.equal(capturedStreamPayload?.["prompt_cache_retention"], undefined);
  assert.deepEqual(
    streamEvents.map((event) => event.type),
    ["keepalive", "text_delta", "text_delta", "completed"]
  );
  const completed = streamEvents.find((event) => event.type === "completed");
  assert.ok(completed && completed.type === "completed");
  assert.deepEqual(completed.result.usage, {
    providerKey: "deepseek",
    modelKey: "deepseek-v4-flash",
    inputTokens: 12,
    cacheCreationInputTokens: null,
    cachedInputTokens: 2,
    outputTokens: 4,
    totalTokens: 16
  });

  await runDeepSeekReasoningContentRoundTripTest(client);
}

/**
 * ADR-124 — DeepSeek V4 thinking mode emits `reasoning_content` alongside
 * `tool_calls`, and that content MUST be echoed back on the assistant tool-call
 * message in the next request or DeepSeek returns a 400. This test pins the full
 * round-trip: capture on response (non-stream + stream) and re-emit on the next
 * request built from `toolHistory`.
 */
async function runDeepSeekReasoningContentRoundTripTest(
  client: DeepSeekProviderClient
): Promise<void> {
  let capturedPayload: Record<string, unknown> | null = null;
  (client as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (payload: Record<string, unknown>) => {
          capturedPayload = payload;
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  reasoning_content: "Let me search the knowledge base first.",
                  tool_calls: [
                    {
                      id: "call-thinking-1",
                      function: {
                        name: "knowledge_search",
                        arguments: '{"query":"refund policy"}'
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
          };
        }
      }
    }
  };

  const firstTurn = await client.generateText(createRequest());
  assert.equal(firstTurn.stopReason, "tool_calls");
  assert.equal(firstTurn.reasoningContent, "Let me search the knowledge base first.");

  const followUpRequest: ProviderGatewayTextGenerateRequest = {
    ...createRequest(),
    toolChoice: "auto",
    toolHistory: [
      {
        toolCall: {
          id: "call-thinking-1",
          name: "knowledge_search",
          arguments: { query: "refund policy" }
        },
        toolResult: {
          toolCallId: "call-thinking-1",
          name: "knowledge_search",
          content: "Refunds allowed within 14 days.",
          isError: false
        },
        reasoningContent: "Let me search the knowledge base first."
      }
    ]
  };
  await client.generateText(followUpRequest);
  const followUpMessages = capturedPayload?.["messages"] as unknown as Array<
    Record<string, unknown>
  >;
  const assistantToolCallMessage = followUpMessages.find(
    (message) => message.role === "assistant" && Array.isArray(message.tool_calls)
  );
  assert.ok(assistantToolCallMessage, "assistant tool-call message must be present");
  assert.equal(
    assistantToolCallMessage?.["reasoning_content"],
    "Let me search the knowledge base first."
  );

  // A tool exchange without captured reasoning must not inject an empty field.
  const noReasoningRequest: ProviderGatewayTextGenerateRequest = {
    ...createRequest(),
    toolChoice: "auto",
    toolHistory: [
      {
        toolCall: {
          id: "call-no-reasoning",
          name: "knowledge_search",
          arguments: { query: "x" }
        },
        toolResult: {
          toolCallId: "call-no-reasoning",
          name: "knowledge_search",
          content: "ok",
          isError: false
        },
        reasoningContent: null
      }
    ]
  };
  await client.generateText(noReasoningRequest);
  const noReasoningMessages = capturedPayload?.["messages"] as unknown as Array<
    Record<string, unknown>
  >;
  const bareAssistantToolCall = noReasoningMessages.find(
    (message) => message.role === "assistant" && Array.isArray(message.tool_calls)
  );
  assert.ok(bareAssistantToolCall, "assistant tool-call message must be present");
  assert.equal("reasoning_content" in (bareAssistantToolCall ?? {}), false);

  // Streaming: reasoning_content deltas accumulate and surface on the tool_calls event.
  (client as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { choices: [{ delta: { reasoning_content: "Thinking " } }] };
            yield { choices: [{ delta: { reasoning_content: "about it." } }] };
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-stream-1",
                        function: { name: "knowledge_search", arguments: '{"query":"q"}' }
                      }
                    ]
                  },
                  finish_reason: "tool_calls"
                }
              ]
            };
          }
        })
      }
    }
  };
  const streamToolEvents = await collectStream(await client.streamText(createRequest()));
  const toolCallsEvent = streamToolEvents.find((event) => event.type === "tool_calls");
  assert.ok(toolCallsEvent, "stream must emit a tool_calls event");
  assert.equal(
    toolCallsEvent?.type === "tool_calls" ? toolCallsEvent.result.reasoningContent : null,
    "Thinking about it."
  );

  // Undici/OpenAI-compatible streams may reject with the bare message
  // "terminated" and no status/code after headers. This is a transient
  // transport failure, not an unknown permanent provider rejection.
  (client as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async () => ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error("terminated");
              }
            };
          }
        })
      }
    }
  };
  const terminatedEvents = await collectStream(await client.streamText(createRequest()));
  const terminated = terminatedEvents.find((event) => event.type === "failed");
  assert.ok(terminated, "terminated transport must emit one failed event");
  if (terminated?.type === "failed") {
    assert.equal(terminated.code, "provider_server_error");
    assert.equal(terminated.message, "terminated");
    assert.equal(terminated.providerErrorKind, "server_error");
  }
}
