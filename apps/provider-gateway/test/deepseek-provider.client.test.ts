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
            }
          };
        }
      }
    }
  };

  const streamEvents = await collectStream(await client.streamText(createRequest()));
  assert.equal(capturedStreamPayload?.["model"], "deepseek-v4-flash");
  assert.equal(capturedStreamPayload?.["stream"], true);
  assert.equal(capturedStreamPayload?.["prompt_cache_retention"], undefined);
  assert.deepEqual(
    streamEvents.map((event) => event.type),
    ["keepalive", "text_delta", "text_delta", "completed"]
  );
}

async function run(): Promise<void> {
  await runDeepSeekProviderClientTest();
}

void run();
