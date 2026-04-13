import assert from "node:assert/strict";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { OpenAIProviderClient } from "../src/modules/providers/openai/openai-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
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
    provider: "openai",
    model: "gpt-5.4",
    systemPrompt: "Be concise.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "hello"
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
            filename: "manual.pdf"
          }
        ]
      },
      {
        role: "assistant",
        content: "hi there"
      },
      {
        role: "user",
        content: "tell me more"
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

function createImageGenerateRequest(): ProviderGatewayImageGenerateRequest {
  return {
    prompt: "Generate a serene lake at dusk",
    count: 2,
    size: "1024x1024",
    credential: {
      toolCode: "image_generate",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

export async function runOpenAIProviderClientTest(): Promise<void> {
  const client = new OpenAIProviderClient(createConfig());
  let capturedGeneratePayload: {
    input?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
    text?: unknown;
    metadata?: unknown;
  } | null = null;
  let capturedStreamPayload: {
    input?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
    text?: unknown;
    metadata?: unknown;
  } | null = null;
  let capturedTranscriptionInput: unknown = null;
  let capturedImagePayload: unknown = null;
  let capturedImageApiKey: string | undefined;
  const generateImage = async (payload: unknown) => {
    capturedImagePayload = payload;
    return {
      output_format: "png",
      data: [
        {
          b64_json: "aW1hZ2UtMQ==",
          revised_prompt: null
        },
        {
          b64_json: "aW1hZ2UtMg==",
          revised_prompt: "A serene lake at dusk with soft reflections."
        }
      ],
      usage: {
        input_tokens: 30,
        output_tokens: 60,
        total_tokens: 90
      }
    };
  };

  (client as unknown as { client: unknown }).client = {
    audio: {
      transcriptions: {
        create: async (payload: unknown) => {
          capturedTranscriptionInput = payload;
          return {
            text: "spoken words"
          };
        }
      }
    },
    images: {
      generate: generateImage
    },
    responses: {
      create: async (payload: {
        stream?: boolean;
        input: unknown;
        tools?: unknown;
        tool_choice?: unknown;
      }) => {
        if (payload.stream) {
          capturedStreamPayload = payload as unknown as Record<string, unknown>;
          if (payload.tools !== undefined) {
            return (async function* (): AsyncGenerator<unknown> {
              yield {
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  call_id: "call-stream-1",
                  name: "knowledge_search",
                  arguments: '{"source":"web","query":"pricing"}'
                }
              };
              yield {
                type: "response.completed",
                response: {
                  output: [
                    {
                      type: "function_call",
                      call_id: "call-stream-1",
                      name: "knowledge_search",
                      arguments: '{"source":"web","query":"pricing"}'
                    }
                  ],
                  output_text: "",
                  usage: {
                    input_tokens: 11,
                    output_tokens: 0,
                    total_tokens: 11
                  }
                }
              };
            })();
          }
          return (async function* (): AsyncGenerator<unknown> {
            yield {
              type: "response.output_text.delta",
              delta: "partial "
            };
            yield {
              type: "response.completed",
              response: {
                output_text: "partial done",
                usage: {
                  input_tokens: 10,
                  output_tokens: 5,
                  total_tokens: 15
                }
              }
            };
          })();
        }

        capturedGeneratePayload = payload as unknown as Record<string, unknown>;
        if (payload.tools !== undefined) {
          return {
            output: [
              {
                type: "function_call",
                call_id: "call-1",
                name: "knowledge_search",
                arguments: '{"source":"web","query":"pricing"}'
              }
            ],
            output_text: "",
            usage: {
              input_tokens: 11,
              output_tokens: 0,
              total_tokens: 11
            }
          };
        }
        return {
          output_text: "done",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15
          }
        };
      }
    }
  };
  (
    client as unknown as {
      getImageClient(apiKey?: string): {
        images: {
          generate(payload: unknown): Promise<unknown>;
        };
      };
    }
  ).getImageClient = (apiKey?: string) => {
    capturedImageApiKey = apiKey;
    return {
      images: {
        generate: generateImage
      }
    };
  };

  const request = createRequest();
  request.requestMetadata = {
    classification: "main_turn",
    runtimeRequestId: "request-1",
    runtimeSessionId: "session-1",
    toolLoopIteration: 0,
    compactionToolCode: null
  };
  const result = await client.generateText(request);
  assert.equal(result.text, "done");
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(capturedGeneratePayload!.input, [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "hello"
        },
        {
          type: "input_image",
          image_url: "data:image/png;base64,aGVsbG8=",
          detail: "auto"
        },
        {
          type: "input_file",
          filename: "manual.pdf",
          file_data: "data:application/pdf;base64,cGRmLWRhdGE="
        }
      ]
    },
    {
      role: "assistant",
      content: "hi there"
    },
    {
      role: "user",
      content: "tell me more"
    }
  ]);
  assert.deepEqual(capturedGeneratePayload!.metadata, {
    persai_request_classification: "main_turn",
    persai_runtime_request_id: "request-1",
    persai_runtime_session_id: "session-1",
    persai_tool_loop_iteration: "0",
    persai_compaction_tool_code: ""
  });
  const baselineGenerateInput = capturedGeneratePayload!.input;

  const structuredRequest: ProviderGatewayTextGenerateRequest = {
    ...request,
    outputSchema: {
      name: "shared_compaction",
      description: "Durable shared compaction output.",
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
  assert.deepEqual(capturedGeneratePayload!.text, {
    format: {
      type: "json_schema",
      name: "shared_compaction",
      description: "Durable shared compaction output.",
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

  const toolRequest: ProviderGatewayTextGenerateRequest = {
    ...request,
    tools: [
      {
        name: "knowledge_search",
        description: "Search enabled knowledge sources.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string" },
            query: { type: "string" }
          }
        }
      }
    ],
    toolChoice: "auto",
    toolHistory: [
      {
        toolCall: {
          id: "call-0",
          name: "knowledge_search",
          arguments: {
            source: "web",
            query: "hello"
          }
        },
        toolResult: {
          toolCallId: "call-0",
          name: "knowledge_search",
          content: '{"toolCode":"knowledge_search","action":"skipped"}',
          isError: false
        }
      }
    ],
    requestMetadata: {
      classification: "tool_loop_followup",
      runtimeRequestId: "request-1",
      runtimeSessionId: "session-1",
      toolLoopIteration: 1,
      compactionToolCode: null
    }
  };
  const toolResult = await client.generateText(toolRequest);
  assert.equal(toolResult.stopReason, "tool_calls");
  assert.equal(toolResult.toolCalls[0]?.name, "knowledge_search");
  assert.deepEqual(capturedGeneratePayload!.tools, [
    {
      type: "function",
      name: "knowledge_search",
      description: "Search enabled knowledge sources.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string" },
          query: { type: "string" }
        }
      },
      strict: false
    }
  ]);
  assert.equal(capturedGeneratePayload!.tool_choice, "auto");
  assert.deepEqual(capturedGeneratePayload!.metadata, {
    persai_request_classification: "tool_loop_followup",
    persai_runtime_request_id: "request-1",
    persai_runtime_session_id: "session-1",
    persai_tool_loop_iteration: "1",
    persai_compaction_tool_code: ""
  });
  assert.deepEqual(capturedGeneratePayload!.input, [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "hello"
        },
        {
          type: "input_image",
          image_url: "data:image/png;base64,aGVsbG8=",
          detail: "auto"
        },
        {
          type: "input_file",
          filename: "manual.pdf",
          file_data: "data:application/pdf;base64,cGRmLWRhdGE="
        }
      ]
    },
    {
      role: "assistant",
      content: "hi there"
    },
    {
      role: "user",
      content: "tell me more"
    },
    {
      type: "function_call",
      call_id: "call-0",
      name: "knowledge_search",
      arguments: '{"source":"web","query":"hello"}'
    },
    {
      type: "function_call_output",
      call_id: "call-0",
      output: '{"toolCode":"knowledge_search","action":"skipped"}'
    }
  ]);

  const stream = await client.streamText(request);
  const events = await collectStream(stream);
  assert.deepEqual(capturedStreamPayload!.input, baselineGenerateInput);
  assert.deepEqual(capturedStreamPayload!.metadata, {
    persai_request_classification: "main_turn",
    persai_runtime_request_id: "request-1",
    persai_runtime_session_id: "session-1",
    persai_tool_loop_iteration: "0",
    persai_compaction_tool_code: ""
  });
  assert.deepEqual(
    events.map((event) => event.type),
    ["text_delta", "completed"]
  );

  const structuredStream = await client.streamText(structuredRequest);
  const structuredStreamEvents = await collectStream(structuredStream);
  assert.deepEqual(capturedStreamPayload!.text, {
    format: {
      type: "json_schema",
      name: "shared_compaction",
      description: "Durable shared compaction output.",
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
  assert.deepEqual(
    structuredStreamEvents.map((event) => event.type),
    ["text_delta", "completed"]
  );

  const toolStream = await client.streamText(toolRequest);
  const toolStreamEvents = await collectStream(toolStream);
  assert.equal(capturedStreamPayload!.tool_choice, "auto");
  assert.deepEqual(capturedStreamPayload!.metadata, {
    persai_request_classification: "tool_loop_followup",
    persai_runtime_request_id: "request-1",
    persai_runtime_session_id: "session-1",
    persai_tool_loop_iteration: "1",
    persai_compaction_tool_code: ""
  });
  assert.deepEqual(capturedStreamPayload!.tools, [
    {
      type: "function",
      name: "knowledge_search",
      description: "Search enabled knowledge sources.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string" },
          query: { type: "string" }
        }
      },
      strict: false
    }
  ]);
  assert.deepEqual(capturedStreamPayload!.input, [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "hello"
        },
        {
          type: "input_image",
          image_url: "data:image/png;base64,aGVsbG8=",
          detail: "auto"
        },
        {
          type: "input_file",
          filename: "manual.pdf",
          file_data: "data:application/pdf;base64,cGRmLWRhdGE="
        }
      ]
    },
    {
      role: "assistant",
      content: "hi there"
    },
    {
      role: "user",
      content: "tell me more"
    },
    {
      type: "function_call",
      call_id: "call-0",
      name: "knowledge_search",
      arguments: '{"source":"web","query":"hello"}'
    },
    {
      type: "function_call_output",
      call_id: "call-0",
      output: '{"toolCode":"knowledge_search","action":"skipped"}'
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
    assert.equal(toolStreamEvent.result.toolCalls[0]?.id, "call-stream-1");
    assert.equal(toolStreamEvent.result.toolCalls[0]?.name, "knowledge_search");
    assert.deepEqual(toolStreamEvent.result.toolCalls[0]?.arguments, {
      source: "web",
      query: "pricing"
    });
  }

  const transcription = await client.transcribeAudio({
    buffer: Buffer.from("voice-data"),
    mimeType: "audio/mpeg",
    filename: "voice.mp3"
  });
  assert.equal(transcription.text, "spoken words");
  assert.equal(
    (capturedTranscriptionInput as { model?: unknown } | null)?.model,
    "gpt-4o-mini-transcribe"
  );
  assert.ok((capturedTranscriptionInput as { file?: unknown } | null)?.file);

  const imageResult = await client.generateImage(createImageGenerateRequest(), {
    apiKey: "tool-openai-key"
  });
  assert.equal(imageResult.model, "gpt-image-1");
  assert.equal(imageResult.images.length, 2);
  assert.equal(imageResult.images[0]?.mimeType, "image/png");
  assert.equal(
    imageResult.images[1]?.revisedPrompt,
    "A serene lake at dusk with soft reflections."
  );
  assert.deepEqual(capturedImagePayload, {
    model: "gpt-image-1",
    prompt: "Generate a serene lake at dusk",
    n: 2,
    output_format: "png",
    size: "1024x1024"
  });
  assert.equal(capturedImageApiKey, "tool-openai-key");
  assert.deepEqual(imageResult.usage, {
    providerKey: "openai",
    modelKey: "gpt-image-1",
    inputTokens: 30,
    outputTokens: 60,
    totalTokens: 90
  });
}
