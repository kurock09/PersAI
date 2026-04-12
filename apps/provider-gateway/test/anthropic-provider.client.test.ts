import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { AnthropicProviderClient } from "../src/modules/providers/anthropic/anthropic-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_OPENAI_API_KEY: undefined,
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: "anthropic-test-key",
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    systemPrompt: "Be concise.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "look at this"
          },
          {
            type: "image",
            mimeType: "image/jpeg",
            dataBase64: "aGVsbG8=",
            filename: "photo.jpg"
          },
          {
            type: "pdf",
            mimeType: "application/pdf",
            dataBase64: "cGRmLWRhdGE=",
            filename: "report.pdf"
          }
        ]
      },
      {
        role: "assistant",
        content: "what should I inspect?"
      },
      {
        role: "user",
        content: "the connector pins"
      }
    ]
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

export async function runAnthropicProviderClientTest(): Promise<void> {
  const client = new AnthropicProviderClient(createConfig());
  let capturedGeneratePayload: {
    messages?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
    output_config?: unknown;
  } | null = null;
  let capturedStreamPayload: {
    messages?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
    output_config?: unknown;
  } | null = null;

  (client as unknown as { client: unknown }).client = {
    messages: {
      create: async (payload: {
        stream?: boolean;
        messages: unknown;
        tools?: unknown;
        tool_choice?: unknown;
      }) => {
        if (payload.stream) {
          capturedStreamPayload = payload as unknown as Record<string, unknown>;
          if (payload.tools !== undefined) {
            return (async function* (): AsyncGenerator<unknown> {
              yield {
                type: "message_start",
                message: {
                  usage: {
                    input_tokens: 10,
                    output_tokens: 0
                  }
                }
              };
              yield {
                type: "content_block_start",
                index: 0,
                content_block: {
                  type: "tool_use",
                  id: "toolu_stream",
                  name: "knowledge_fetch",
                  input: {}
                }
              };
              yield {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "input_json_delta",
                  partial_json: '{"source":"memory","referenceId":"memory-1"}'
                }
              };
              yield {
                type: "message_delta",
                delta: {
                  stop_reason: "tool_use",
                  stop_sequence: null
                },
                usage: {
                  output_tokens: 2
                }
              };
            })();
          }
          return (async function* (): AsyncGenerator<unknown> {
            yield {
              type: "message_start",
              message: {
                usage: {
                  input_tokens: 10,
                  output_tokens: 0
                }
              }
            };
            yield {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: "partial "
              }
            };
            yield {
              type: "message_delta",
              usage: {
                output_tokens: 5
              }
            };
            yield {
              type: "message_stop"
            };
          })();
        }

        capturedGeneratePayload = payload as unknown as Record<string, unknown>;
        if (payload.tools !== undefined) {
          return {
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "knowledge_fetch",
                input: {
                  source: "memory",
                  referenceId: "memory-1"
                }
              }
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 2
            }
          };
        }
        return {
          content: [
            {
              type: "text",
              text: "done"
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5
          }
        };
      }
    }
  };

  const request = createRequest();
  const result = await client.generateText(request);
  assert.equal(result.text, "done");
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(capturedGeneratePayload!.messages, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "look at this"
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "aGVsbG8="
          }
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "cGRmLWRhdGE="
          },
          title: "report.pdf"
        }
      ]
    },
    {
      role: "assistant",
      content: "what should I inspect?"
    },
    {
      role: "user",
      content: "the connector pins"
    }
  ]);
  const baselineGenerateMessages = capturedGeneratePayload!.messages;

  const structuredRequest: ProviderGatewayTextGenerateRequest = {
    ...request,
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
  };
  const structuredResult = await client.generateText(structuredRequest);
  assert.equal(structuredResult.text, "done");
  assert.deepEqual(capturedGeneratePayload!.output_config, {
    format: {
      type: "json_schema",
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
      }
    }
  });

  const toolRequest: ProviderGatewayTextGenerateRequest = {
    ...request,
    tools: [
      {
        name: "knowledge_fetch",
        description: "Fetch one known knowledge item.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string" },
            referenceId: { type: "string" }
          }
        }
      }
    ],
    toolChoice: "auto",
    toolHistory: [
      {
        toolCall: {
          id: "toolu_prev",
          name: "knowledge_search",
          arguments: {
            source: "memory",
            query: "connector pins"
          }
        },
        toolResult: {
          toolCallId: "toolu_prev",
          name: "knowledge_search",
          content: '{"toolCode":"knowledge_search","action":"skipped"}',
          isError: false
        }
      }
    ]
  };
  const toolResult = await client.generateText(toolRequest);
  assert.equal(toolResult.stopReason, "tool_calls");
  assert.equal(toolResult.toolCalls[0]?.name, "knowledge_fetch");
  assert.deepEqual(capturedGeneratePayload!.tools, [
    {
      name: "knowledge_fetch",
      description: "Fetch one known knowledge item.",
      input_schema: {
        type: "object",
        properties: {
          source: { type: "string" },
          referenceId: { type: "string" }
        }
      }
    }
  ]);
  assert.deepEqual(capturedGeneratePayload!.tool_choice, {
    type: "auto"
  });
  assert.deepEqual(capturedGeneratePayload!.messages, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "look at this"
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "aGVsbG8="
          }
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "cGRmLWRhdGE="
          },
          title: "report.pdf"
        }
      ]
    },
    {
      role: "assistant",
      content: "what should I inspect?"
    },
    {
      role: "user",
      content: "the connector pins"
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_prev",
          name: "knowledge_search",
          input: {
            source: "memory",
            query: "connector pins"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_prev",
          content: '{"toolCode":"knowledge_search","action":"skipped"}',
          is_error: false
        }
      ]
    }
  ]);

  const stream = await client.streamText(request);
  const events = await collectStream(stream);
  assert.deepEqual(capturedStreamPayload!.messages, baselineGenerateMessages);
  assert.deepEqual(
    events.map((event) => event.type),
    ["text_delta", "completed"]
  );

  const structuredStream = await client.streamText(structuredRequest);
  const structuredStreamEvents = await collectStream(structuredStream);
  assert.deepEqual(capturedStreamPayload!.output_config, {
    format: {
      type: "json_schema",
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
      }
    }
  });
  assert.deepEqual(
    structuredStreamEvents.map((event) => event.type),
    ["text_delta", "completed"]
  );

  const toolStream = await client.streamText(toolRequest);
  const toolStreamEvents = await collectStream(toolStream);
  assert.deepEqual(capturedStreamPayload!.tools, [
    {
      name: "knowledge_fetch",
      description: "Fetch one known knowledge item.",
      input_schema: {
        type: "object",
        properties: {
          source: { type: "string" },
          referenceId: { type: "string" }
        }
      }
    }
  ]);
  assert.deepEqual(capturedStreamPayload!.tool_choice, {
    type: "auto"
  });
  assert.deepEqual(capturedStreamPayload!.messages, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "look at this"
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "aGVsbG8="
          }
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "cGRmLWRhdGE="
          },
          title: "report.pdf"
        }
      ]
    },
    {
      role: "assistant",
      content: "what should I inspect?"
    },
    {
      role: "user",
      content: "the connector pins"
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_prev",
          name: "knowledge_search",
          input: {
            source: "memory",
            query: "connector pins"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_prev",
          content: '{"toolCode":"knowledge_search","action":"skipped"}',
          is_error: false
        }
      ]
    }
  ]);
  assert.deepEqual(
    toolStreamEvents.map((event) => event.type),
    ["tool_calls"]
  );
  const toolStreamEvent = toolStreamEvents[0];
  assert.equal(toolStreamEvent?.type, "tool_calls");
  if (toolStreamEvent?.type === "tool_calls") {
    assert.equal(toolStreamEvent.result.stopReason, "tool_calls");
    assert.equal(toolStreamEvent.result.toolCalls[0]?.id, "toolu_stream");
    assert.equal(toolStreamEvent.result.toolCalls[0]?.name, "knowledge_fetch");
    assert.deepEqual(toolStreamEvent.result.toolCalls[0]?.arguments, {
      source: "memory",
      referenceId: "memory-1"
    });
  }
}
