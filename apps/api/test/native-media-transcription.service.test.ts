import assert from "node:assert/strict";
import { NativeMediaTranscriptionService } from "../src/modules/workspace-management/application/media/native-media-transcription.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-api-token";
  process.env.PERSAI_RUNTIME_BASE_URL = "http://runtime.local";

  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, init });
    return new Response(
      JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
        text: "hello from runtime",
        respondedAt: "2026-04-12T12:00:01.000Z"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  try {
    const service = new NativeMediaTranscriptionService();
    const result = await service.transcribe({
      buffer: Buffer.from("voice-data"),
      mimeType: "audio/mpeg",
      filename: "voice.mp3"
    });
    assert.equal(result.text, "hello from runtime");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "http://runtime.local/api/v1/media/transcribe");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.ok(requests[0]?.init?.body instanceof FormData);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PERSAI_RUNTIME_BASE_URL;
  }
}

void run();
