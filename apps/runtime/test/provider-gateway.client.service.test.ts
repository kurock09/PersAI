import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayBrowserActionRequest,
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewayWebSearchRequest,
  ProviderGatewayWebFetchRequest,
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import {
  ProviderGatewayClientService,
  ProviderGatewayHttpError,
  ProviderGatewaySafetyRejectedError,
  type ProviderGatewayDependencyReadiness
} from "../src/modules/turns/provider-gateway.client.service";

function createConfig(
  baseUrl: string | undefined = "http://provider-gateway.local"
): RuntimeConfig {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://persai:persai@localhost:5432/persai",
    PORT: 3012,
    LOG_LEVEL: "info",
    RUNTIME_STATE_REDIS_URL: "redis://localhost:6379",
    RUNTIME_BUNDLE_CACHE_MAX_ENTRIES: 32,
    RUNTIME_STATE_REDIS_KEY_PREFIX: "persai:test-runtime",
    RUNTIME_SESSION_LEASE_TTL_SECONDS: 45,
    RUNTIME_TURN_RECEIPT_TTL_SECONDS: 3600,
    RUNTIME_BUNDLE_MARKER_TTL_SECONDS: 7200,
    RUNTIME_PROVIDER_GATEWAY_BASE_URL: baseUrl,
    RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS: 5_000,
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000,
    RUNTIME_SANDBOX_TIMEOUT_MS: 30_000,
    RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS: 240_000,
    PERSAI_MEDIA_OBJECT_PREFIX: "assistant-media",
    ORPHAN_RECEIPT_GRACE_MS: 1_200_000
  };
}

function createUnconfiguredConfig(): RuntimeConfig {
  return {
    ...createConfig(),
    RUNTIME_PROVIDER_GATEWAY_BASE_URL: undefined
  };
}

function createGenerateTextRequest(): ProviderGatewayTextGenerateRequest {
  return {
    provider: "openai",
    model: "gpt-5.4",
    systemPrompt: "Be helpful.",
    promptCache: {
      key: "persai:ordinary_chat:bundle-hash-1:b03",
      openaiPolicy: { mode: "automatic", retention: "in_memory" }
    },
    messages: [
      {
        role: "user",
        content: "hello"
      }
    ]
  };
}

function createCompletedTextResult(model: string): ProviderGatewayTextGenerateResult {
  return {
    provider: "openai",
    model,
    text: "generated text",
    respondedAt: "2026-04-11T12:00:01.000Z",
    usage: null,
    textUsage: { status: "usage_unavailable", reason: "test_fixture" },
    stopReason: "completed",
    toolCalls: []
  };
}

function createWebFetchRequest(): ProviderGatewayWebFetchRequest {
  return {
    url: "https://example.com",
    extractMode: "markdown",
    maxChars: null,
    credential: {
      toolCode: "web_fetch",
      secretId: "secret-1",
      providerId: "firecrawl"
    }
  };
}

function createWebSearchRequest(): ProviderGatewayWebSearchRequest {
  return {
    query: "persai runtime",
    count: 5,
    credential: {
      toolCode: "web_search",
      secretId: "secret-1",
      providerId: "tavily"
    }
  };
}

function createImageGenerateRequest(): ProviderGatewayImageGenerateRequest {
  return {
    prompt: "Draw a calm blue horizon",
    model: "gpt-image-1.5",
    count: 1,
    size: "1024x1024",
    background: "transparent",
    credential: {
      toolCode: "image_generate",
      secretId: "secret-1",
      providerId: "openai"
    }
  };
}

function createImageEditRequest(): ProviderGatewayImageEditRequest {
  return {
    prompt: "Replace the couch with a red chair",
    model: "gpt-image-2",
    count: 1,
    size: "1024x1024",
    background: "opaque",
    sourceImage: {
      bytesBase64: "cmVmLWltYWdl",
      mimeType: "image/png",
      filename: "living-room.png"
    },
    referenceImages: null,
    credential: {
      toolCode: "image_edit",
      secretId: "secret-1",
      providerId: "openai"
    }
  };
}

function createVideoGenerateRequest(): ProviderGatewayVideoGenerateRequest {
  return {
    prompt: "Animate a calm paper-cut forest at sunrise",
    model: null,
    size: "1280x720",
    seconds: 4,
    referenceImage: {
      bytesBase64: "cmVmLXZpZGVvLWltYWdl",
      mimeType: "image/png",
      filename: "forest.png"
    },
    credential: {
      toolCode: "video_generate",
      secretId: "secret-1",
      providerId: "openai"
    }
  };
}

function createProviderVideoResponse(
  provider: "openai" | "runway" | "kling" | "heygen",
  model: string,
  seconds = 4
) {
  return {
    provider,
    model,
    prompt: "Animate a calm paper-cut forest at sunrise",
    size: "1280x720",
    seconds,
    video: {
      bytesBase64: "dmlkZW8tYnl0ZXM=",
      mimeType: "video/mp4"
    },
    respondedAt: "2026-04-12T12:00:01.700Z",
    usage: null,
    warning: null
  };
}

function createSpeechGenerateRequest(): ProviderGatewaySpeechGenerateRequest {
  return {
    text: "Привет, это тестовый voice note.",
    locale: "ru-RU",
    toneTag: "warm",
    deliveryKind: "voice_note",
    assistantGender: "female",
    traits: {
      warmth: 80
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
        role: "friendly"
      },
      openai: {
        voice: "marin"
      }
    },
    credential: {
      toolCode: "tts",
      secretId: "secret-1",
      providerId: "openai",
      modelKey: "gpt-4o-mini-tts"
    }
  };
}

function createDocumentGenerateRequest(): ProviderGatewayDocumentGenerateRequest {
  return {
    htmlContent: "<!DOCTYPE html><html><body><h1>Brief</h1></body></html>",
    filename: "brief.pdf",
    credential: {
      toolCode: "document",
      secretId: "secret-1",
      providerId: "gamma"
    },
    providerOptions: {
      outputFormat: "pdf"
    }
  };
}

function createBrowserActionRequest(): ProviderGatewayBrowserActionRequest {
  return {
    action: "snapshot",
    url: "https://example.com",
    maxChars: 5000,
    operations: [],
    timeoutMs: 120000,
    credential: {
      toolCode: "browser",
      secretId: "secret-1",
      providerId: "browserless"
    }
  };
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

export async function runProviderGatewayClientServiceTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === "string" ? init.body : null;
    const isPayloadTooLargeRequest = bodyText?.includes('"model":"payload-too-large"') ?? false;
    if (init === undefined) {
      requests.push({ url });
    } else {
      requests.push({ url, init });
    }

    if (url.endsWith("/ready")) {
      const readiness: ProviderGatewayDependencyReadiness = {
        ready: true,
        providerCacheReady: true
      };
      return new Response(JSON.stringify(readiness), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    if (url.endsWith("/api/v1/providers/stream-text")) {
      if (isPayloadTooLargeRequest) {
        return new Response(
          JSON.stringify({
            error: {
              message: "request entity too large"
            }
          }),
          {
            status: 413,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      const requestBody = bodyText === null ? null : JSON.parse(bodyText);
      if (requestBody?.model === "delayed-keepalive") {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(encoder.encode(`${JSON.stringify({ type: "keepalive" })}\n`));
              }, 10);
              setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `${JSON.stringify({
                      type: "completed",
                      result: createCompletedTextResult("delayed-keepalive")
                    })}\n`
                  )
                );
              }, 25);
              setTimeout(() => controller.close(), 30);
            }
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/x-ndjson"
            }
          }
        );
      }
      return new Response(
        [
          JSON.stringify({
            type: "keepalive"
          }),
          JSON.stringify({
            type: "text_delta",
            delta: "generated",
            accumulatedText: "generated"
          }),
          JSON.stringify({
            type: "completed",
            result: createCompletedTextResult("gpt-5.4")
          })
        ].join("\n"),
        {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/transcribe-audio")) {
      return new Response(
        JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
          text: "hello from audio",
          respondedAt: "2026-04-12T12:00:01.000Z"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/generate-image")) {
      return new Response(
        JSON.stringify({
          provider: "openai",
          model: "gpt-image-1",
          prompt: "Draw a calm blue horizon",
          size: "1024x1024",
          images: [
            {
              bytesBase64: "aW1hZ2UtYnl0ZXM=",
              mimeType: "image/png",
              revisedPrompt: null
            }
          ],
          respondedAt: "2026-04-12T12:00:01.500Z",
          usage: null,
          warning: null
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/edit-image")) {
      return new Response(
        JSON.stringify({
          provider: "openai",
          model: "gpt-image-1",
          prompt: "Replace the couch with a red chair",
          size: "1024x1024",
          images: [
            {
              bytesBase64: "ZWRpdGVkLWJ5dGVz",
              mimeType: "image/png",
              revisedPrompt: "Replace the couch with a red chair while keeping the room layout."
            }
          ],
          respondedAt: "2026-04-12T12:00:01.625Z",
          usage: null,
          warning: null
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/generate-video")) {
      const requestBody = bodyText === null ? null : JSON.parse(bodyText);
      const providerId = requestBody?.credential?.providerId;
      return new Response(
        JSON.stringify(
          createProviderVideoResponse(
            providerId === "runway" || providerId === "kling" || providerId === "heygen"
              ? providerId
              : "openai",
            providerId === "runway"
              ? "gen4_turbo"
              : providerId === "kling"
                ? "kling-v3"
                : providerId === "heygen"
                  ? "avatar_v"
                  : "sora-2",
            providerId === "runway" ? 5 : providerId === "heygen" ? 8.5 : 4
          )
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/generate-speech")) {
      return new Response(
        JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini-tts",
          deliveryKind: "voice_note",
          bytesBase64: "dm9pY2UtYnl0ZXM=",
          mimeType: "audio/ogg",
          respondedAt: "2026-04-12T12:00:01.750Z",
          usage: null,
          warning: null
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/generate-document")) {
      return new Response(
        JSON.stringify({
          provider: "gamma",
          outputFormat: "pdf",
          documentId: "gamma-doc-1",
          templateId: null,
          filename: "brief.pdf",
          bytesBase64: "JVBERi0xLjQK",
          mimeType: "application/pdf",
          respondedAt: "2026-05-15T18:00:01.000Z",
          warning: null,
          providerStatus: {
            provider: "gamma",
            state: "success",
            generationId: "gen-1",
            gammaId: "gamma-1",
            gammaUrl: null,
            exportUrl: "https://example.com/document.pdf",
            filename: "brief.pdf",
            outputType: "pdf",
            status: "completed",
            updatedAt: null
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/web-fetch")) {
      return new Response(
        JSON.stringify({
          provider: "firecrawl",
          url: "https://example.com",
          finalUrl: "https://example.com/final",
          title: "Example",
          content: "# Example\nBody",
          contentType: "text/markdown",
          extractMode: "markdown",
          status: 200,
          truncated: false,
          fetchedAt: "2026-04-12T12:00:02.000Z",
          tookMs: 321,
          warning: "External content is untrusted.",
          externalContent: {
            untrusted: true,
            source: "web_fetch",
            provider: "firecrawl"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/web-search")) {
      return new Response(
        JSON.stringify({
          provider: "tavily",
          query: "persai runtime",
          summary: null,
          hits: [
            {
              title: "Example",
              url: "https://example.com",
              snippet: "Example snippet",
              score: 0.9,
              publishedAt: "2026-04-12"
            }
          ],
          tookMs: 210,
          warning: "External results are untrusted.",
          externalContent: {
            untrusted: true,
            source: "web_search",
            provider: "tavily"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/browser-action")) {
      return new Response(
        JSON.stringify({
          provider: "browserless",
          action: "snapshot",
          initialUrl: "https://example.com",
          finalUrl: "https://example.com/final",
          title: "Example",
          content: "Rendered browser content",
          truncated: false,
          elements: [
            {
              selector: "#search",
              tagName: "input",
              text: null,
              role: null,
              type: "search",
              href: null,
              placeholder: "Search",
              disabled: false
            }
          ],
          observedAt: "2026-04-13T12:00:00.000Z",
          tookMs: 450,
          warning: "Browser content is untrusted.",
          externalContent: {
            untrusted: true,
            source: "browser",
            provider: "browserless"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (isPayloadTooLargeRequest) {
      return new Response(
        JSON.stringify({
          error: {
            message: "request entity too large"
          }
        }),
        {
          status: 413,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/v1/providers/generate-text")) {
      const requestBody = bodyText === null ? null : JSON.parse(bodyText);
      if (requestBody?.model === "quota-structured") {
        return new Response(
          JSON.stringify({
            error: {
              code: "insufficient_quota",
              message: "Quota exceeded for the selected account.",
              providerErrorKind: "billing_quota",
              providerErrorCode: "insufficient_quota",
              providerErrorType: "billing_error",
              providerErrorStatus: 429
            }
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      if (requestBody?.model === "provider-invalid-request") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unsupported_parameter",
              message: "Unsupported parameter: prompt_cache_retention.",
              providerErrorKind: "invalid_request",
              providerErrorCode: "unsupported_parameter",
              providerErrorType: "invalid_request_error",
              providerErrorStatus: 400
            }
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    const payload: ProviderGatewayTextGenerateResult = {
      provider: "openai",
      model: "gpt-5.4",
      text: "generated text",
      respondedAt: "2026-04-11T12:00:01.000Z",
      usage: null,
      textUsage: { status: "usage_unavailable", reason: "test_fixture" },
      stopReason: "completed",
      toolCalls: []
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }) as typeof fetch;

  try {
    const service = new ProviderGatewayClientService(createConfig());
    const idleResetService = new ProviderGatewayClientService({
      ...createConfig(),
      RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 20,
      RUNTIME_SANDBOX_TIMEOUT_MS: 30_000
    });
    const readiness = await service.getReadiness();
    assert.deepEqual(readiness, {
      ready: true,
      providerCacheReady: true
    });

    const result = await service.generateText(createGenerateTextRequest());
    assert.equal(result.text, "generated text");
    const stream = await service.streamText(createGenerateTextRequest());
    const streamEvents = await collectStreamEvents(stream);
    const transcription = await service.transcribeAudio({
      buffer: Buffer.from("voice-data"),
      mimeType: "audio/mpeg",
      filename: "voice.mp3"
    });
    const imageGenerate = await service.generateImage(createImageGenerateRequest(), {
      timeoutMs: 300000
    });
    const imageEdit = await service.editImage(createImageEditRequest(), {
      timeoutMs: 300000
    });
    const videoGenerate = await service.generateVideo(createVideoGenerateRequest(), {
      timeoutMs: 600000
    });
    const runwayVideoGenerate = await service.generateVideo({
      ...createVideoGenerateRequest(),
      model: "gen4_turbo",
      credential: {
        toolCode: "video_generate",
        secretId: "secret-runway",
        providerId: "runway"
      }
    });
    const klingVideoGenerate = await service.generateVideo({
      ...createVideoGenerateRequest(),
      model: "kling-v3",
      credential: {
        toolCode: "video_generate",
        secretId: "secret-kling",
        providerId: "kling"
      }
    });
    const speechGenerate = await service.generateSpeech(createSpeechGenerateRequest());
    const documentGenerate = await service.generateDocument(createDocumentGenerateRequest());
    const documentFailure = await service.generateDocumentOutcome(createDocumentGenerateRequest());
    const webFetch = await service.webFetch(createWebFetchRequest());
    const webSearch = await service.webSearch(createWebSearchRequest());
    const browserAction = await service.browserAction(createBrowserActionRequest(), {
      timeoutMs: 120000
    });
    // ADR-109 Slice 3: structurally widened request must carry the talking-avatar
    // fields through to the JSON body sent to the provider gateway. The runtime
    // tool service only forwards them when mode === "talking_avatar" (a runtime
    // test asserts cinematic does NOT carry them); here we just verify the
    // gateway client serializes them faithfully. We use providerId="openai" so
    // the existing fake-fetch happy path / response validator accepts the stub
    // response — the new fields are pure pass-through and provider-agnostic.
    const talkingAvatarVideoGenerate = await service.generateVideo({
      ...createVideoGenerateRequest(),
      mode: "talking_avatar",
      speechText: "Hello, welcome to PersAI.",
      speechLanguage: "en-US",
      personaId: "persona-anya",
      portraitImageAlias: null,
      voiceKey: "anya-warm"
    });
    // ADR-109 Slice 6: new HeyGen-specific fields are JSON-serialized into the body.
    const heygenFieldsVideoGenerate = await service.generateVideo({
      ...createVideoGenerateRequest(),
      mode: "talking_avatar",
      speechText: "HeyGen field test.",
      speechLanguage: "en-US",
      personaId: null,
      cachedHeygenAvatarId: null,
      portraitImageBytesBase64: "cG9ydHJhaXQtYnl0ZXM=",
      portraitImageMimeType: "image/jpeg",
      voiceKey: "voice-heygen-ru-1",
      credential: {
        toolCode: "video_generate",
        secretId: "secret-heygen",
        providerId: "heygen"
      }
    });
    assert.equal(transcription.text, "hello from audio");
    assert.equal(imageGenerate.model, "gpt-image-1");
    assert.equal(imageGenerate.images[0]?.mimeType, "image/png");
    assert.equal(imageEdit.model, "gpt-image-1");
    assert.equal(
      imageEdit.images[0]?.revisedPrompt,
      "Replace the couch with a red chair while keeping the room layout."
    );
    assert.equal(videoGenerate.model, "sora-2");
    assert.equal(videoGenerate.video.mimeType, "video/mp4");
    assert.equal(runwayVideoGenerate.provider, "runway");
    assert.equal(runwayVideoGenerate.model, "gen4_turbo");
    assert.equal(runwayVideoGenerate.seconds, 5);
    assert.equal(klingVideoGenerate.provider, "kling");
    assert.equal(klingVideoGenerate.model, "kling-v3");
    assert.equal(talkingAvatarVideoGenerate.provider, "openai");
    assert.equal(heygenFieldsVideoGenerate.provider, "heygen");
    assert.equal(heygenFieldsVideoGenerate.seconds, 8.5);
    assert.equal(speechGenerate.model, "gpt-4o-mini-tts");
    assert.equal(speechGenerate.mimeType, "audio/ogg");
    assert.equal(documentGenerate.provider, "gamma");
    assert.equal(documentGenerate.mimeType, "application/pdf");
    assert.equal(documentFailure.ok, true);
    assert.equal(webFetch.provider, "firecrawl");
    assert.equal(webSearch.provider, "tavily");
    assert.equal(browserAction.provider, "browserless");
    assert.equal(requests.length, 17);
    assert.equal(requests[0]?.url, "http://provider-gateway.local/ready");
    assert.equal(requests[1]?.url, "http://provider-gateway.local/api/v1/providers/generate-text");
    assert.equal(requests[1]?.init?.method, "POST");
    assert.deepEqual(
      JSON.parse(String(requests[1]?.init?.body ?? "{}")).promptCache,
      createGenerateTextRequest().promptCache
    );
    assert.deepEqual(
      streamEvents.map((event) => event.type),
      ["keepalive", "text_delta", "completed"]
    );
    assert.equal(requests[2]?.url, "http://provider-gateway.local/api/v1/providers/stream-text");
    assert.equal(requests[2]?.init?.method, "POST");
    assert.deepEqual(
      JSON.parse(String(requests[2]?.init?.body ?? "{}")).promptCache,
      createGenerateTextRequest().promptCache
    );
    assert.equal(
      requests[3]?.url,
      "http://provider-gateway.local/api/v1/providers/transcribe-audio"
    );
    assert.equal(requests[3]?.init?.method, "POST");
    assert.ok(requests[3]?.init?.body instanceof FormData);
    assert.equal(requests[4]?.url, "http://provider-gateway.local/api/v1/providers/generate-image");
    assert.equal(requests[4]?.init?.method, "POST");
    assert.equal(JSON.parse(String(requests[4]?.init?.body ?? "{}")).timeoutMs, 300000);
    assert.equal(requests[5]?.url, "http://provider-gateway.local/api/v1/providers/edit-image");
    assert.equal(requests[5]?.init?.method, "POST");
    assert.equal(JSON.parse(String(requests[5]?.init?.body ?? "{}")).timeoutMs, 300000);
    assert.equal(requests[6]?.url, "http://provider-gateway.local/api/v1/providers/generate-video");
    assert.equal(requests[6]?.init?.method, "POST");
    assert.equal(requests[7]?.url, "http://provider-gateway.local/api/v1/providers/generate-video");
    assert.equal(requests[7]?.init?.method, "POST");
    assert.equal(requests[8]?.url, "http://provider-gateway.local/api/v1/providers/generate-video");
    assert.equal(requests[8]?.init?.method, "POST");
    assert.equal(
      requests[9]?.url,
      "http://provider-gateway.local/api/v1/providers/generate-speech"
    );
    assert.equal(requests[9]?.init?.method, "POST");
    assert.equal(
      JSON.parse(String(requests[9]?.init?.body ?? "{}")).credential?.modelKey,
      "gpt-4o-mini-tts"
    );
    assert.equal(
      requests[10]?.url,
      "http://provider-gateway.local/api/v1/providers/generate-document"
    );
    assert.equal(requests[10]?.init?.method, "POST");
    assert.equal(
      requests[11]?.url,
      "http://provider-gateway.local/api/v1/providers/generate-document"
    );
    assert.equal(requests[11]?.init?.method, "POST");
    assert.equal(requests[12]?.url, "http://provider-gateway.local/api/v1/providers/web-fetch");
    assert.equal(requests[12]?.init?.method, "POST");
    assert.equal(requests[13]?.url, "http://provider-gateway.local/api/v1/providers/web-search");
    assert.equal(requests[13]?.init?.method, "POST");
    assert.equal(
      requests[14]?.url,
      "http://provider-gateway.local/api/v1/providers/browser-action"
    );
    assert.equal(requests[14]?.init?.method, "POST");
    assert.equal(
      requests[15]?.url,
      "http://provider-gateway.local/api/v1/providers/generate-video"
    );
    assert.equal(requests[15]?.init?.method, "POST");
    const talkingAvatarBody = JSON.parse(String(requests[15]?.init?.body ?? "{}"));
    assert.equal(talkingAvatarBody.mode, "talking_avatar");
    assert.equal(talkingAvatarBody.speechText, "Hello, welcome to PersAI.");
    assert.equal(talkingAvatarBody.speechLanguage, "en-US");
    assert.equal(talkingAvatarBody.personaId, "persona-anya");
    assert.equal(talkingAvatarBody.portraitImageAlias, null);
    assert.equal(talkingAvatarBody.voiceKey, "anya-warm");
    // ADR-109 Slice 6: new HeyGen-specific fields serialized into HTTP body.
    assert.equal(
      requests[16]?.url,
      "http://provider-gateway.local/api/v1/providers/generate-video"
    );
    assert.equal(requests[16]?.init?.method, "POST");
    const heygenFieldsBody = JSON.parse(String(requests[16]?.init?.body ?? "{}"));
    assert.equal(heygenFieldsBody.cachedHeygenAvatarId, null);
    assert.equal(heygenFieldsBody.portraitImageBytesBase64, "cG9ydHJhaXQtYnl0ZXM=");
    assert.equal(heygenFieldsBody.portraitImageMimeType, "image/jpeg");
    assert.equal(heygenFieldsBody.voiceKey, "voice-heygen-ru-1");

    const unconfiguredService = new ProviderGatewayClientService(createUnconfiguredConfig());
    const unconfiguredReadiness = await unconfiguredService.getReadiness();
    assert.deepEqual(unconfiguredReadiness, {
      ready: false,
      providerCacheReady: false
    });
    await assert.rejects(
      () => unconfiguredService.generateText(createGenerateTextRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.webFetch(createWebFetchRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.generateImage(createImageGenerateRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.editImage(createImageEditRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.generateVideo(createVideoGenerateRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.generateSpeech(createSpeechGenerateRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.generateDocument(createDocumentGenerateRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.webSearch(createWebSearchRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () => unconfiguredService.browserAction(createBrowserActionRequest()),
      /base URL is not configured/
    );
    await assert.rejects(
      () =>
        service.generateText({
          ...createGenerateTextRequest(),
          model: "payload-too-large"
        }),
      /Current-turn file payload is too large for direct model input/
    );
    await assert.rejects(async () => {
      const oversizedStream = await service.streamText({
        ...createGenerateTextRequest(),
        model: "payload-too-large"
      });
      await collectStreamEvents(oversizedStream);
    }, /Current-turn file payload is too large for direct model input/);
    const delayedKeepaliveStream = await idleResetService.streamText({
      ...createGenerateTextRequest(),
      model: "delayed-keepalive"
    });
    const delayedKeepaliveEvents = await collectStreamEvents(delayedKeepaliveStream);
    assert.deepEqual(
      delayedKeepaliveEvents.map((event) => event.type),
      ["keepalive", "completed"]
    );
    await assert.rejects(
      () =>
        service.generateText({
          ...createGenerateTextRequest(),
          model: "quota-structured"
        }),
      (error) => {
        assert.ok(error instanceof ProviderGatewayHttpError);
        assert.equal(error.httpStatus, 429);
        assert.equal(error.providerErrorKind, "billing_quota");
        assert.equal(error.providerErrorCode, "insufficient_quota");
        assert.equal(error.providerErrorType, "billing_error");
        assert.equal(error.providerErrorStatus, 429);
        return true;
      }
    );
    await assert.rejects(
      () =>
        service.generateText({
          ...createGenerateTextRequest(),
          model: "provider-invalid-request"
        }),
      (error) => {
        assert.ok(error instanceof ProviderGatewayHttpError);
        assert.equal(error.httpStatus, 400);
        assert.equal(error.providerErrorKind, "invalid_request");
        assert.equal(error.providerErrorCode, "unsupported_parameter");
        assert.equal(error.providerErrorType, "invalid_request_error");
        assert.equal(error.providerErrorStatus, 400);
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/providers/generate-document")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "gamma_auth_failed",
              message: "Gamma rejected the configured credential.",
              retryable: false,
              providerStatus: {
                provider: "gamma",
                state: "failed",
                status: "http_401",
                httpStatus: 401,
                retryable: false
              }
            }
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const failureOutcome = await service.generateDocumentOutcome(createDocumentGenerateRequest());
    assert.deepEqual(failureOutcome, {
      ok: false,
      status: 401,
      code: "gamma_auth_failed",
      message: "Gamma rejected the configured credential.",
      retryable: false,
      providerStatus: {
        provider: "gamma",
        state: "failed",
        status: "http_401",
        httpStatus: 401,
        retryable: false
      }
    });

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (
        url.endsWith("/api/v1/providers/generate-image") ||
        url.endsWith("/api/v1/providers/edit-image")
      ) {
        return new Response(
          JSON.stringify({
            error: {
              code: "image_provider_safety_rejected",
              message:
                "OpenAI image request was rejected by the provider safety system (request id req_safety_123).",
              retryable: false,
              providerStatus: {
                provider: "openai",
                requestId: "req_safety_123"
              }
            }
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => service.generateImage(createImageGenerateRequest()),
      (error) => {
        assert.ok(error instanceof ProviderGatewaySafetyRejectedError);
        assert.equal(error.code, "image_provider_safety_rejected");
        assert.equal(error.requestId, "req_safety_123");
        assert.match(error.message, /safety system/i);
        return true;
      }
    );

    await assert.rejects(
      () => service.editImage(createImageEditRequest()),
      (error) => {
        assert.ok(error instanceof ProviderGatewaySafetyRejectedError);
        assert.equal(error.code, "image_provider_safety_rejected");
        assert.equal(error.requestId, "req_safety_123");
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/providers/generate-video")) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Kling video generation request failed with status 500."
            }
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => service.generateVideo(createVideoGenerateRequest()),
      (error) => {
        assert.ok(error instanceof ProviderGatewayHttpError);
        assert.equal(error.httpStatus, 500);
        assert.match(error.message, /status 500/);
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/providers/generate-video")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "accepted_primary_unconfirmed",
              message:
                "Provider task was accepted, but polling continuity was lost before terminal status.",
              providerStatus: {
                providerTaskId: "task_kling_accepted_1",
                provider: "kling",
                model: "kling-v3",
                acceptedAt: "2026-06-02T12:00:00.000Z",
                providerStage: "accepted"
              }
            }
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => service.generateVideo(createVideoGenerateRequest()),
      (error) => {
        assert.ok(error instanceof ServiceUnavailableException);
        const response = (error as ServiceUnavailableException).getResponse() as {
          error?: { code?: string; providerStatus?: { providerTaskId?: string } };
        };
        assert.equal(response.error?.code, "accepted_primary_unconfirmed");
        assert.equal(response.error?.providerStatus?.providerTaskId, "task_kling_accepted_1");
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/providers/generate-video")) {
        return new Response(JSON.stringify(createProviderVideoResponse("openai", "sora-2")), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        service.generateVideo({
          ...createVideoGenerateRequest(),
          credential: {
            toolCode: "video_generate",
            secretId: "secret-runway",
            providerId: "runway"
          }
        }),
      /invalid video generation response/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
