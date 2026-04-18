import assert from "node:assert/strict";
import type { RuntimeConfig } from "@persai/config";
import type {
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
    RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 15_000
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
      retention: "in_memory"
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
    count: 1,
    size: "1024x1024",
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
    size: "1024x1024",
    sourceImage: {
      bytesBase64: "cmVmLWltYWdl",
      mimeType: "image/png",
      filename: "living-room.png"
    },
    referenceImage: null,
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
      providerId: "openai"
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
      return new Response(
        JSON.stringify({
          provider: "openai",
          model: "sora-2",
          prompt: "Animate a calm paper-cut forest at sunrise",
          size: "1280x720",
          seconds: 4,
          video: {
            bytesBase64: "dmlkZW8tYnl0ZXM=",
            mimeType: "video/mp4"
          },
          respondedAt: "2026-04-12T12:00:01.700Z",
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

    const payload: ProviderGatewayTextGenerateResult = {
      provider: "openai",
      model: "gpt-5.4",
      text: "generated text",
      respondedAt: "2026-04-11T12:00:01.000Z",
      usage: null,
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
      RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 20
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
    const imageGenerate = await service.generateImage(createImageGenerateRequest());
    const imageEdit = await service.editImage(createImageEditRequest());
    const videoGenerate = await service.generateVideo(createVideoGenerateRequest(), {
      timeoutMs: 180000
    });
    const speechGenerate = await service.generateSpeech(createSpeechGenerateRequest());
    const webFetch = await service.webFetch(createWebFetchRequest());
    const webSearch = await service.webSearch(createWebSearchRequest());
    const browserAction = await service.browserAction(createBrowserActionRequest(), {
      timeoutMs: 120000
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
    assert.equal(speechGenerate.model, "gpt-4o-mini-tts");
    assert.equal(speechGenerate.mimeType, "audio/ogg");
    assert.equal(webFetch.provider, "firecrawl");
    assert.equal(webSearch.provider, "tavily");
    assert.equal(browserAction.provider, "browserless");
    assert.equal(requests.length, 11);
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
    assert.equal(requests[5]?.url, "http://provider-gateway.local/api/v1/providers/edit-image");
    assert.equal(requests[5]?.init?.method, "POST");
    assert.equal(requests[6]?.url, "http://provider-gateway.local/api/v1/providers/generate-video");
    assert.equal(requests[6]?.init?.method, "POST");
    assert.equal(
      requests[7]?.url,
      "http://provider-gateway.local/api/v1/providers/generate-speech"
    );
    assert.equal(requests[7]?.init?.method, "POST");
    assert.equal(requests[8]?.url, "http://provider-gateway.local/api/v1/providers/web-fetch");
    assert.equal(requests[8]?.init?.method, "POST");
    assert.equal(requests[9]?.url, "http://provider-gateway.local/api/v1/providers/web-search");
    assert.equal(requests[9]?.init?.method, "POST");
    assert.equal(
      requests[10]?.url,
      "http://provider-gateway.local/api/v1/providers/browser-action"
    );
    assert.equal(requests[10]?.init?.method, "POST");

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
  } finally {
    globalThis.fetch = originalFetch;
  }
}
