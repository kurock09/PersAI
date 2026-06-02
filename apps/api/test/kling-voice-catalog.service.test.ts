import assert from "node:assert/strict";
import { KlingVoiceCatalogService } from "../src/modules/workspace-management/application/kling/kling-voice-catalog.service";

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const upserts: Array<Record<string, unknown>> = [];

  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            voice_list: [
              {
                voice_id: "voice-1",
                voice_name: "Owen",
                voice_language: "en",
                gender: "male",
                style_tags: ["calm", "narrator"]
              },
              {
                voice_id: "voice-2",
                voice_name: "Maya",
                voice_language: "en",
                gender: "female",
                style_tags: ["warm", "friendly"]
              }
            ]
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )) as typeof fetch;

    const service = new KlingVoiceCatalogService(
      {
        platformKlingVoiceCatalogCache: {
          async findUnique() {
            return null;
          },
          async upsert(input: Record<string, unknown>) {
            upserts.push(input);
            return input;
          }
        }
      } as never,
      {
        async resolveSecretValueById(secretId: string) {
          assert.equal(secretId, "tool/video_generate/kling/api-key");
          return JSON.stringify({
            accessKey: "kling-access",
            secretKey: "kling-secret"
          });
        }
      } as never
    );

    const catalog = await service.getMaterializedVoiceCatalog();
    assert.ok(catalog);
    assert.equal(catalog?.provider, "kling");
    assert.deepEqual(
      catalog?.shortlist.map((entry) => entry.voiceKey),
      ["maya", "owen"]
    );
    assert.deepEqual(
      catalog?.shortlist.map((entry) => entry.providerVoiceId),
      ["voice-2", "voice-1"]
    );
    assert.equal(upserts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
