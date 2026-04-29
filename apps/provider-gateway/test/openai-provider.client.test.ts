import assert from "node:assert/strict";
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
}): ProviderGatewayImageEditRequest {
  return {
    prompt: "Replace the couch with a red chair",
    model: "gpt-image-2",
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
    }
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
      providerId: "openai"
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
    text?: unknown;
    metadata?: unknown;
    prompt_cache_key?: unknown;
    prompt_cache_retention?: unknown;
  } | null = null;
  let capturedStreamPayload: {
    input?: unknown;
    tools?: unknown;
    tool_choice?: unknown;
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
    prompt: "Generate a serene lake at dusk",
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
    cachedInputTokens: null,
    outputTokens: 60,
    totalTokens: 90
  });

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
    cachedInputTokens: null,
    outputTokens: 48,
    totalTokens: 72
  });

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
}
