import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayVideoGenerateRequest,
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
    promptCache: {
      key: "persai:ordinary_chat:bundle-hash-1:b03",
      retention: "in_memory"
    },
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

function delayOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createImageGenerateRequest(): ProviderGatewayImageGenerateRequest {
  return {
    prompt: "Generate a serene lake at dusk",
    model: "gpt-image-1.5",
    count: 2,
    size: "1024x1024",
    background: "transparent",
    credential: {
      toolCode: "image_generate",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

function createImageEditRequest(options?: {
  includeReference?: boolean;
  count?: number;
}): ProviderGatewayImageEditRequest {
  return {
    prompt: "Replace the couch with a red chair",
    model: "gpt-image-2",
    count: options?.count ?? 1,
    size: "1024x1024",
    background: "opaque",
    sourceImage: {
      bytesBase64: "cmVmLWltYWdl",
      mimeType: "image/png",
      filename: "living-room.png"
    },
    referenceImage: options?.includeReference
      ? {
          bytesBase64: "cmVmLWNhci1pbWFnZQ==",
          mimeType: "image/png",
          filename: "red-car.png"
        }
      : null,
    credential: {
      toolCode: "image_edit",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    }
  };
}

function createVideoGenerateRequest(options?: {
  includeReference?: boolean;
  model?: "sora-2" | "sora-2-pro" | null;
  acceptedTask?: ProviderGatewayVideoGenerateRequest["acceptedTask"];
}): ProviderGatewayVideoGenerateRequest {
  return {
    prompt: "Animate a calm paper-cut forest at sunrise",
    model: options?.model ?? null,
    size: "1280x720",
    seconds: 4,
    referenceImage: options?.includeReference
      ? {
          bytesBase64: "cmVmLXZpZGVvLWltYWdl",
          mimeType: "image/png",
          filename: "forest.png"
        }
      : null,
    credential: {
      toolCode: "video_generate",
      secretId: "tool/image_generate/api-key",
      providerId: "openai"
    },
    acceptedTask: options?.acceptedTask ?? null
  };
}

function createSpeechGenerateRequest(): ProviderGatewaySpeechGenerateRequest {
  return {
    text: "Привет, это тестовый голосовой ответ.",
    locale: "ru-RU",
    toneTag: "warm",
    deliveryKind: "voice_note",
    assistantGender: "female",
    traits: {
      warmth: 80,
      formality: 45,
      playfulness: 30
    },
    voiceProfile: {
      schema: "persai.assistantVoiceProfile.v1",
      defaultLocale: "ru-RU",
      deliveryKind: "voice_note",
      elevenlabs: {
        voiceId: "voice-eleven"
      },
      yandex: {
        voice: "jane",
        role: null
      },
      openai: {
        voice: "marin"
      }
    },
    credential: {
      toolCode: "tts",
      secretId: "tool/tts/openai",
      providerId: "openai",
      modelKey: "gpt-4o-mini-tts"
    }
  };
}

export async function runOpenAIProviderClientTest(): Promise<void> {
  const client = new OpenAIProviderClient(createConfig());
  const sharp = (await import("sharp")).default;
  let capturedGeneratePayload: {
    input?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
    parallel_tool_calls?: unknown;
    text?: unknown;
    metadata?: unknown;
    prompt_cache_key?: unknown;
    prompt_cache_retention?: unknown;
  } | null = null;
  let capturedStreamPayload: {
    input?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
    parallel_tool_calls?: unknown;
    text?: unknown;
    metadata?: unknown;
    prompt_cache_key?: unknown;
    prompt_cache_retention?: unknown;
  } | null = null;
  let capturedTranscriptionInput: unknown = null;
  let capturedImagePayload: unknown = null;
  let capturedImageEditPayload: unknown = null;
  let capturedSpeechPayload: unknown = null;
  let capturedVideoPayload: {
    model: FormDataEntryValue | null;
    prompt: FormDataEntryValue | null;
    size: FormDataEntryValue | null;
    seconds: FormDataEntryValue | null;
    inputReference: FormDataEntryValue | null;
  } | null = null;
  let capturedToolApiKey: string | undefined;
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
  const editImage = async (payload: unknown) => {
    capturedImageEditPayload = payload;
    return {
      output_format: "png",
      data: [
        {
          b64_json: "ZWRpdGVkLWltYWdlLTE=",
          revised_prompt: "Replace the couch with a red chair while keeping the same room."
        }
      ],
      usage: {
        input_tokens: 24,
        output_tokens: 48,
        total_tokens: 72
      }
    };
  };
  const generateSpeech = async (payload: unknown) => {
    capturedSpeechPayload = payload;
    return {
      arrayBuffer: async () => Buffer.from("speech-bytes")
    };
  };

  (client as unknown as { client: unknown }).client = {
    audio: {
      speech: {
        create: generateSpeech
      },
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
      generate: generateImage,
      edit: editImage
    },
    responses: {
      create: async (
        payload: {
          stream?: boolean;
          input: unknown;
          tools?: unknown;
          tool_choice?: unknown;
          parallel_tool_calls?: unknown;
          model?: string;
        },
        options?: { signal?: AbortSignal }
      ) => {
        if (payload.stream) {
          capturedStreamPayload = payload as unknown as Record<string, unknown>;
          if (payload.model === "gpt-5.4-delayed") {
            return (async function* (): AsyncGenerator<unknown> {
              await delayOrAbort(10, options?.signal);
              yield {
                type: "keepalive"
              };
              await delayOrAbort(15, options?.signal);
              yield {
                type: "response.completed",
                response: {
                  output_text: "delayed done",
                  usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    total_tokens: 15
                  }
                }
              };
            })();
          }
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
              type: "keepalive"
            };
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
      getApiClient(apiKey?: string): {
        images: {
          generate(payload: unknown): Promise<unknown>;
          edit(payload: unknown): Promise<unknown>;
        };
        audio: {
          speech: {
            create(payload: unknown): Promise<unknown>;
          };
        };
      };
    }
  ).getApiClient = (apiKey?: string) => {
    capturedToolApiKey = apiKey;
    return {
      images: {
        generate: generateImage,
        edit: editImage
      },
      audio: {
        speech: {
          create: generateSpeech
        }
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
  assert.equal(capturedGeneratePayload!.prompt_cache_key, "persai:ordinary_chat:bundle-hash-1:b03");
  assert.equal(capturedGeneratePayload!.prompt_cache_retention, "in_memory");
  const baselineGenerateInput = capturedGeneratePayload!.input as unknown[];

  await client.generateText({
    ...request,
    developerInstructions: "Volatile working files and presence context.",
    messages: [
      {
        role: "assistant",
        content:
          "[Relevant memories retrieved for this turn — may vary between turns]\n- Per-turn memory result that changes with the latest user input.",
        cacheRole: "volatile_context"
      },
      ...request.messages
    ]
  });
  // The flagged volatile-context block is moved out of the cached prefix and projected as a `user`
  // block immediately before the current user question (symmetric with Anthropic). Developer
  // instructions stay a provider-native `developer` suffix at the very end.
  assert.deepEqual(capturedGeneratePayload!.input, [
    baselineGenerateInput[0],
    baselineGenerateInput[1],
    {
      role: "developer",
      content:
        "<persai_contextual_memory>\n" +
        "These are PersAI memories retrieved as silent background context for this provider call. " +
        "They are not the user's latest request; use them only to inform your answer to the existing " +
        "conversation. Never mention, quote, list, repeat, or describe this block, these tags, or the " +
        "fact that memory was retrieved. Do not talk about your memory, retrieval, or context unless the " +
        "user explicitly asks about them.\n\n" +
        "[Relevant memories retrieved for this turn — may vary between turns]\n" +
        "- Per-turn memory result that changes with the latest user input." +
        "\n</persai_contextual_memory>"
    },
    baselineGenerateInput[2],
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: "Volatile working files and presence context."
        }
      ]
    }
  ]);

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
  assert.equal(capturedGeneratePayload!.parallel_tool_calls, true);
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
  assert.equal(capturedStreamPayload!.prompt_cache_key, "persai:ordinary_chat:bundle-hash-1:b03");
  assert.equal(capturedStreamPayload!.prompt_cache_retention, "in_memory");
  assert.deepEqual(
    events.map((event) => event.type),
    ["keepalive", "text_delta", "completed"]
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
    ["keepalive", "text_delta", "completed"]
  );

  const delayedClient = new OpenAIProviderClient({
    ...createConfig(),
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 20
  });
  (delayedClient as unknown as { client: unknown }).client = (
    client as unknown as { client: unknown }
  ).client;
  const delayedStream = await delayedClient.streamText({
    ...request,
    model: "gpt-5.4-delayed"
  });
  const delayedStreamEvents = await collectStream(delayedStream);
  assert.deepEqual(
    delayedStreamEvents.map((event) => event.type),
    ["keepalive", "completed"]
  );
  const delayedCompletedEvent = delayedStreamEvents[1];
  assert.equal(delayedCompletedEvent?.type, "completed");
  if (delayedCompletedEvent?.type === "completed") {
    assert.equal(delayedCompletedEvent.result.text, "delayed done");
  }

  const toolStream = await client.streamText(toolRequest);
  const toolStreamEvents = await collectStream(toolStream);
  assert.equal(capturedStreamPayload!.tool_choice, "auto");
  assert.equal(capturedStreamPayload!.parallel_tool_calls, true);
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
  assert.equal(imageResult.model, "gpt-image-1.5");
  assert.equal(imageResult.images.length, 2);
  assert.equal(imageResult.images[0]?.mimeType, "image/png");
  assert.equal(
    imageResult.images[1]?.revisedPrompt,
    "A serene lake at dusk with soft reflections."
  );
  assert.deepEqual(capturedImagePayload, {
    model: "gpt-image-1.5",
    prompt:
      "Return 2 distinct standalone images. Each returned image must be one final image. Do not make a collage, grid, contact sheet, diptych, triptych, or multi-panel composition unless the user explicitly asked for that format. User request: Generate a serene lake at dusk",
    n: 2,
    output_format: "png",
    background: "transparent",
    size: "1024x1024"
  });
  assert.equal(capturedToolApiKey, "tool-openai-key");
  assert.deepEqual(imageResult.usage, {
    providerKey: "openai",
    modelKey: "gpt-image-1.5",
    inputTokens: 30,
    cacheCreationInputTokens: null,
    cachedInputTokens: null,
    outputTokens: 60,
    totalTokens: 90
  });
  assert.deepEqual(imageResult.billingFacts, {
    providerKey: "openai",
    modelKey: "gpt-image-1.5",
    capability: "image",
    occurredAt: imageResult.billingFacts?.occurredAt,
    metering: {
      meteringKind: "token_metered",
      inputTokens: 30,
      cacheCreationInputTokens: null,
      cachedInputTokens: null,
      outputTokens: 60,
      totalTokens: 90,
      dimensions: {
        operation: "generate",
        size: "1024x1024",
        background: "transparent"
      }
    }
  });

  let capturedImageEditTimeoutMs: number | null = null;
  const originalCreateTimedSignal = (
    client as unknown as {
      createTimedSignal(
        timeoutMs: number,
        externalSignal?: AbortSignal
      ): {
        signal: AbortSignal;
        reset: () => void;
        dispose: () => void;
      };
    }
  ).createTimedSignal.bind(client);
  (
    client as unknown as {
      createTimedSignal(
        timeoutMs: number,
        externalSignal?: AbortSignal
      ): {
        signal: AbortSignal;
        reset: () => void;
        dispose: () => void;
      };
    }
  ).createTimedSignal = (timeoutMs: number, externalSignal?: AbortSignal) => {
    capturedImageEditTimeoutMs = timeoutMs;
    return originalCreateTimedSignal(timeoutMs, externalSignal);
  };

  const imageEditResult = await client.editImage(
    createImageEditRequest({ includeReference: true }),
    {
      apiKey: "tool-openai-key"
    }
  );
  assert.equal(imageEditResult.model, "gpt-image-2");
  assert.equal(imageEditResult.images.length, 1);
  assert.equal(imageEditResult.prompt, "Replace the couch with a red chair");
  assert.equal(
    imageEditResult.images[0]?.revisedPrompt,
    "Replace the couch with a red chair while keeping the same room."
  );
  assert.equal((capturedImageEditPayload as { model?: string } | null)?.model, "gpt-image-2");
  assert.equal(
    (capturedImageEditPayload as { output_format?: string } | null)?.output_format,
    "png"
  );
  assert.equal((capturedImageEditPayload as { background?: string } | null)?.background, "opaque");
  assert.equal((capturedImageEditPayload as { size?: string } | null)?.size, "1024x1024");
  assert.equal(capturedImageEditTimeoutMs, 420_000);
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /Edit only the first\/source image/
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /Use the second\/reference image only as visual guidance/
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /User request: Replace the couch with a red chair/
  );
  assert.ok(Array.isArray((capturedImageEditPayload as { image?: unknown } | null)?.image));
  assert.equal(((capturedImageEditPayload as { image?: unknown[] } | null)?.image ?? []).length, 2);
  assert.deepEqual(imageEditResult.usage, {
    providerKey: "openai",
    modelKey: "gpt-image-2",
    inputTokens: 24,
    cacheCreationInputTokens: null,
    cachedInputTokens: null,
    outputTokens: 48,
    totalTokens: 72
  });
  assert.deepEqual(imageEditResult.billingFacts, {
    providerKey: "openai",
    modelKey: "gpt-image-2",
    capability: "image",
    occurredAt: imageEditResult.billingFacts?.occurredAt,
    metering: {
      meteringKind: "token_metered",
      inputTokens: 24,
      cacheCreationInputTokens: null,
      cachedInputTokens: null,
      outputTokens: 48,
      totalTokens: 72,
      dimensions: {
        operation: "edit",
        size: "1024x1024",
        background: "opaque"
      }
    }
  });
  // DEFECT 2: edit payload must include n === 1 for the default (count=1) case
  assert.equal(
    (capturedImageEditPayload as { n?: number } | null)?.n,
    1,
    "editImage payload must include n=1 for count=1"
  );

  // DEFECT 2 + 3: count>1 with reference image — payload n===count, prompt uses multi-output wording
  capturedImageEditPayload = null;
  await client.editImage(createImageEditRequest({ includeReference: true, count: 3 }), {
    apiKey: "tool-openai-key"
  });
  assert.equal(
    (capturedImageEditPayload as { n?: number } | null)?.n,
    3,
    "editImage payload must include n=count for count>1"
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /return 3 distinct edited variations/,
    "multi-output prompt must state count-specific cardinality"
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /Each returned image must be one standalone final image/,
    "multi-output edit prompt must forbid collage/grid outputs unless explicitly requested"
  );
  assert.doesNotMatch(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /return one edited version/,
    "multi-output prompt must not say 'one edited version'"
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /Use the second\/reference image only as visual guidance/,
    "reference guidance must be preserved in multi-output prompt"
  );

  // DEFECT 3: count>1 without reference image — prompt states cardinality
  capturedImageEditPayload = null;
  await client.editImage(createImageEditRequest({ includeReference: false, count: 2 }), {
    apiKey: "tool-openai-key"
  });
  assert.equal(
    (capturedImageEditPayload as { n?: number } | null)?.n,
    2,
    "editImage payload without reference must include n=count"
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /Return 2 distinct edited variations/,
    "no-reference multi-output prompt must state count-specific cardinality"
  );
  assert.match(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt ?? "",
    /Each returned image must be one standalone final image/,
    "no-reference multi-output prompt must forbid collage/grid outputs unless explicitly requested"
  );

  // DEFECT 3: count===1 without reference — prompt is pass-through (no cardinality injection)
  capturedImageEditPayload = null;
  await client.editImage(createImageEditRequest({ includeReference: false, count: 1 }), {
    apiKey: "tool-openai-key"
  });
  assert.equal(
    (capturedImageEditPayload as { prompt?: string } | null)?.prompt,
    "Replace the couch with a red chair",
    "no-reference single-output prompt must be pass-through"
  );

  const speechResult = await client.generateSpeech(createSpeechGenerateRequest(), {
    apiKey: "tool-openai-key"
  });
  assert.equal(speechResult.model, "gpt-4o-mini-tts");
  assert.equal(speechResult.mimeType, "audio/ogg");
  assert.deepEqual(capturedSpeechPayload, {
    model: "gpt-4o-mini-tts",
    voice: "marin",
    input: "Привет, это тестовый голосовой ответ.",
    response_format: "opus",
    instructions:
      "Speak naturally in ru-RU. Keep the delivery warm, close, and human. Use a feminine vocal character. Sound caring, kind, and emotionally present. Avoid sounding playful or joking."
  });

  capturedSpeechPayload = null;
  const customSpeechResult = await client.generateSpeech(
    {
      ...createSpeechGenerateRequest(),
      credential: {
        ...createSpeechGenerateRequest().credential,
        modelKey: "gpt-4o-tts"
      }
    },
    {
      apiKey: "tool-openai-key"
    }
  );
  assert.equal(customSpeechResult.model, "gpt-4o-tts");
  assert.deepEqual(capturedSpeechPayload, {
    model: "gpt-4o-tts",
    voice: "marin",
    input: "Привет, это тестовый голосовой ответ.",
    response_format: "opus",
    instructions:
      "Speak naturally in ru-RU. Keep the delivery warm, close, and human. Use a feminine vocal character. Sound caring, kind, and emotionally present. Avoid sounding playful or joking."
  });

  capturedSpeechPayload = null;
  const foreignModelSpeechResult = await client.generateSpeech(
    {
      ...createSpeechGenerateRequest(),
      credential: {
        ...createSpeechGenerateRequest().credential,
        modelKey: "eleven_multilingual_v2"
      }
    },
    {
      apiKey: "tool-openai-key"
    }
  );
  assert.equal(foreignModelSpeechResult.model, "gpt-4o-mini-tts");
  assert.equal((capturedSpeechPayload as { model?: string } | null)?.model, "gpt-4o-mini-tts");

  const originalFetch = globalThis.fetch;
  const videoRequests: Array<{ url: string; init?: RequestInit }> = [];
  const squareReferenceBuffer = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: { r: 200, g: 120, b: 80 }
    }
  })
    .jpeg()
    .toBuffer();
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      videoRequests.push({ url });
    } else {
      videoRequests.push({ url, init });
    }
    if (url === "https://api.openai.com/v1/videos") {
      assert.ok(init?.body instanceof FormData);
      const formData = init.body as FormData;
      capturedVideoPayload = {
        model: formData.get("model"),
        prompt: formData.get("prompt"),
        size: formData.get("size"),
        seconds: formData.get("seconds"),
        inputReference: formData.get("input_reference")
      };
      return new Response(
        JSON.stringify({
          id: "video_123",
          status: "completed",
          model:
            typeof capturedVideoPayload?.model === "string" ? capturedVideoPayload.model : "sora-2"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://api.openai.com/v1/videos/video_123/content") {
      return new Response(Buffer.from("video-bytes"), {
        status: 200,
        headers: {
          "Content-Type": "video/mp4"
        }
      });
    }
    throw new Error(`Unexpected fetch URL in OpenAI provider client test: ${url}`);
  }) as typeof fetch;

  try {
    const videoResult = await client.generateVideo(
      {
        ...createVideoGenerateRequest({ includeReference: true, model: "sora-2-pro" }),
        referenceImage: {
          bytesBase64: squareReferenceBuffer.toString("base64"),
          mimeType: "image/jpeg",
          filename: "forest-square.jpg"
        }
      },
      {
        apiKey: "tool-openai-key"
      }
    );
    const recordedVideoPayload = capturedVideoPayload as {
      model: FormDataEntryValue | null;
      prompt: FormDataEntryValue | null;
      size: FormDataEntryValue | null;
      seconds: FormDataEntryValue | null;
      inputReference: FormDataEntryValue | null;
    } | null;
    assert.equal(videoResult.model, "sora-2-pro");
    assert.deepEqual(videoResult.billingFacts, {
      providerKey: "openai",
      modelKey: "sora-2-pro",
      capability: "video",
      occurredAt: videoResult.billingFacts?.occurredAt,
      metering: {
        meteringKind: "time_metered",
        durationMs: 4000,
        durationSeconds: 4
      }
    });
    assert.equal(videoResult.video.mimeType, "video/mp4");
    assert.equal(videoResult.video.bytesBase64, Buffer.from("video-bytes").toString("base64"));
    assert.ok(recordedVideoPayload !== null);
    assert.equal(recordedVideoPayload.model, "sora-2-pro");
    assert.equal(recordedVideoPayload.prompt, "Animate a calm paper-cut forest at sunrise");
    assert.equal(recordedVideoPayload.size, "1280x720");
    assert.equal(recordedVideoPayload.seconds, "4");
    assert.ok(recordedVideoPayload.inputReference instanceof Blob);
    const normalizedReferenceBlob = recordedVideoPayload.inputReference as Blob;
    assert.equal(normalizedReferenceBlob.type, "image/png");
    const normalizedReferenceBuffer = Buffer.from(await normalizedReferenceBlob.arrayBuffer());
    const normalizedReferenceMetadata = await sharp(normalizedReferenceBuffer).metadata();
    assert.equal(normalizedReferenceMetadata.width, 1280);
    assert.equal(normalizedReferenceMetadata.height, 720);
    assert.equal(videoRequests.length, 2);
    assert.equal(videoRequests[0]?.url, "https://api.openai.com/v1/videos");
    assert.equal(videoRequests[1]?.url, "https://api.openai.com/v1/videos/video_123/content");
    assert.equal(
      (videoRequests[0]?.init?.headers as Record<string, string> | undefined)?.Authorization,
      "Bearer tool-openai-key"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const transientPollRequests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      transientPollRequests.push({ url });
    } else {
      transientPollRequests.push({ url, init });
    }
    if (url === "https://api.openai.com/v1/videos") {
      return new Response(
        JSON.stringify({
          id: "video_504",
          status: "queued",
          model: "sora-2"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://api.openai.com/v1/videos/video_504") {
      const pollCount = transientPollRequests.filter(
        (entry) => entry.url === "https://api.openai.com/v1/videos/video_504"
      ).length;
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({
            error: { message: "Gateway timeout" }
          }),
          {
            status: 504,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response(
        JSON.stringify({
          id: "video_504",
          status: "completed",
          model: "sora-2"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://api.openai.com/v1/videos/video_504/content") {
      return new Response(Buffer.from("video-after-retry"), {
        status: 200,
        headers: {
          "Content-Type": "video/mp4"
        }
      });
    }
    throw new Error(`Unexpected fetch URL in transient OpenAI video test: ${url}`);
  }) as typeof fetch;

  try {
    const videoRetryResult = await client.generateVideo(createVideoGenerateRequest(), {
      apiKey: "tool-openai-key"
    });
    assert.equal(
      videoRetryResult.video.bytesBase64,
      Buffer.from("video-after-retry").toString("base64")
    );
    assert.equal(
      transientPollRequests.filter(
        (entry) => entry.url === "https://api.openai.com/v1/videos/video_504"
      ).length,
      2
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const thrownPollRequests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      thrownPollRequests.push({ url });
    } else {
      thrownPollRequests.push({ url, init });
    }
    if (url === "https://api.openai.com/v1/videos") {
      return new Response(
        JSON.stringify({
          id: "video_fetch_failed",
          status: "queued",
          model: "sora-2"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://api.openai.com/v1/videos/video_fetch_failed") {
      const pollCount = thrownPollRequests.filter((entry) => entry.url === url).length;
      if (pollCount === 1) {
        throw new Error("fetch failed");
      }
      return new Response(
        JSON.stringify({
          id: "video_fetch_failed",
          status: "completed",
          model: "sora-2"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://api.openai.com/v1/videos/video_fetch_failed/content") {
      return new Response(Buffer.from("video-after-thrown-retry"), {
        status: 200,
        headers: {
          "Content-Type": "video/mp4"
        }
      });
    }
    throw new Error(`Unexpected fetch URL in thrown OpenAI video test: ${url}`);
  }) as typeof fetch;

  try {
    const thrownRetryResult = await client.generateVideo(createVideoGenerateRequest(), {
      apiKey: "tool-openai-key"
    });
    assert.equal(
      thrownRetryResult.video.bytesBase64,
      Buffer.from("video-after-thrown-retry").toString("base64")
    );
    assert.equal(
      thrownPollRequests.filter(
        (entry) => entry.url === "https://api.openai.com/v1/videos/video_fetch_failed"
      ).length,
      2
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const acceptedOnlyRequests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      acceptedOnlyRequests.push({ url });
    } else {
      acceptedOnlyRequests.push({ url, init });
    }
    if (url === "https://api.openai.com/v1/videos/video_accepted_only") {
      return new Response(
        JSON.stringify({
          id: "video_accepted_only",
          status: "completed",
          model: "sora-2"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://api.openai.com/v1/videos/video_accepted_only/content") {
      return new Response(Buffer.from("video-accepted-only"), {
        status: 200,
        headers: {
          "Content-Type": "video/mp4"
        }
      });
    }
    throw new Error(`Unexpected fetch URL in accepted-only OpenAI video test: ${url}`);
  }) as typeof fetch;

  try {
    const acceptedOnlyResult = await client.generateVideo(
      createVideoGenerateRequest({
        acceptedTask: {
          provider: "openai",
          model: "sora-2",
          providerTaskId: "video_accepted_only",
          acceptedAt: "2026-06-02T12:00:00.000Z",
          providerStage: "accepted",
          taskKind: null
        }
      }),
      {
        apiKey: "tool-openai-key"
      }
    );
    assert.equal(
      acceptedOnlyResult.video.bytesBase64,
      Buffer.from("video-accepted-only").toString("base64")
    );
    assert.equal(
      acceptedOnlyRequests.some((entry) => entry.url === "https://api.openai.com/v1/videos"),
      false
    );
    assert.equal(
      acceptedOnlyRequests.some(
        (entry) => entry.url === "https://api.openai.com/v1/videos/video_accepted_only"
      ),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const safetyClient = new OpenAIProviderClient(createConfig());
  (
    safetyClient as unknown as {
      getApiClient(apiKey?: string): {
        images: {
          generate(payload: unknown): Promise<unknown>;
          edit(payload: unknown): Promise<unknown>;
        };
      };
    }
  ).getApiClient = () => ({
    images: {
      generate: async () => {
        const error = new Error("Your request was rejected by the safety system.");
        Object.assign(error, {
          status: 400,
          request_id: "req_generate_safety",
          error: {
            code: "content_policy_violation",
            type: "invalid_request_error",
            message: "Your request was rejected by the safety system.",
            safety_violations: ["abuse"]
          }
        });
        throw error;
      },
      edit: async () => {
        const error = new Error("Your request was rejected by the safety system.");
        Object.assign(error, {
          status: 400,
          request_id: "req_edit_safety",
          error: {
            code: "content_policy_violation",
            type: "invalid_request_error",
            message: "Your request was rejected by the safety system."
          }
        });
        throw error;
      }
    }
  });

  await assert.rejects(
    () => safetyClient.generateImage(createImageGenerateRequest()),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        error?: { code?: string; message?: string; providerStatus?: Record<string, unknown> };
      };
      assert.equal(response.error?.code, "image_provider_safety_rejected");
      assert.match(response.error?.message ?? "", /req_generate_safety/);
      assert.equal(response.error?.providerStatus?.requestId, "req_generate_safety");
      return true;
    }
  );

  await assert.rejects(
    () => safetyClient.editImage(createImageEditRequest({ includeReference: false })),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        error?: { code?: string; message?: string; providerStatus?: Record<string, unknown> };
      };
      assert.equal(response.error?.code, "image_provider_safety_rejected");
      assert.match(response.error?.message ?? "", /req_edit_safety/);
      assert.equal(response.error?.providerStatus?.requestId, "req_edit_safety");
      return true;
    }
  );
}
