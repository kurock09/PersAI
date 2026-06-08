import assert from "node:assert/strict";
import { ElevenLabsVoiceCatalogService } from "../src/modules/workspace-management/application/elevenlabs/elevenlabs-voice-catalog.service";

const ELEVENLABS_PROVIDER_KEY = "tool_tts_elevenlabs";

function secretStore(options: { configured?: boolean; apiKey?: string | null }): never {
  const configured = options.configured ?? true;
  const apiKey = options.apiKey ?? "eleven-test-api-key";
  return {
    async loadKeyMetadataByKeys(keys: string[]) {
      assert.deepEqual(keys, [ELEVENLABS_PROVIDER_KEY]);
      return configured
        ? { [ELEVENLABS_PROVIDER_KEY]: { configured: true, lastFour: "1234", updatedAt: "" } }
        : {};
    },
    async resolveSecretValueByProviderKey(providerKey: string) {
      assert.equal(providerKey, ELEVENLABS_PROVIDER_KEY);
      return apiKey;
    }
  } as never;
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    // ── Test 1: No cache → shared voices fetch → curated normalized voices + upsert ──
    {
      const upserts: Array<Record<string, unknown>> = [];
      const requestedUrls: string[] = [];
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        requestedUrls.push(url);
        return new Response(
          JSON.stringify({
            voices: [
              {
                voice_id: "ru-anna",
                name: "Anna",
                category: "professional",
                preview_url: "https://cdn.elevenlabs.io/anna.mp3",
                labels: { language: "ru" },
                featured: true,
                liked_by_count: 10,
                cloned_by_count: 3
              },
              {
                voice_id: "en-brian",
                name: "Brian",
                category: "professional",
                labels: { gender: "male", language: "en" },
                featured: false,
                liked_by_count: 8,
                cloned_by_count: 20
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const service = new ElevenLabsVoiceCatalogService(
        {
          platformElevenlabsVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert(input: Record<string, unknown>) {
              upserts.push(input);
              return input;
            }
          }
        } as never,
        secretStore({})
      );

      const catalog = await service.getCatalog();
      assert.equal(catalog.loadState, "ready");
      assert.equal(catalog.configured, true);
      assert.equal(catalog.voices.length, 2);
      assert.equal(catalog.warning, null);
      assert.equal(upserts.length, 1, "should upsert once after a live fetch");
      assert.ok(
        requestedUrls.every((url) => url.startsWith("https://api.elevenlabs.io/v1/shared-voices?")),
        "should use ElevenLabs shared voices API"
      );
      assert.ok(
        requestedUrls.some((url) => url.includes("featured=true")),
        "should request featured voices separately"
      );
      assert.ok(
        requestedUrls.some((url) => !url.includes("featured=true")),
        "should request a popularity candidate pool"
      );

      const anna = catalog.voices.find((entry) => entry.voiceId === "ru-anna");
      assert.ok(anna);
      assert.equal(anna.languageBucket, "ru");
      assert.equal(anna.gender, "female");
      assert.equal(anna.previewUrl, "https://cdn.elevenlabs.io/anna.mp3");
      assert.deepEqual(catalog.voices.map((entry) => entry.voiceId).sort(), [
        "en-brian",
        "ru-anna"
      ]);
      console.log("PASS: no cache → shared voices fetch → curated normalized voices");
    }

    // ── Test 2: Fresh cache row → no network call ──
    {
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const service = new ElevenLabsVoiceCatalogService(
        {
          platformElevenlabsVoiceCatalogCache: {
            async findUnique() {
              return {
                voicesJson: [
                  {
                    voiceId: "cached-voice",
                    name: "Cached",
                    gender: "neutral",
                    category: null,
                    language: "en",
                    languageBucket: "en",
                    previewUrl: null
                  }
                ],
                fetchedAt: new Date(Date.now() - 60 * 1000)
              };
            },
            async upsert() {
              throw new Error("should not upsert when cache is fresh");
            }
          }
        } as never,
        secretStore({})
      );

      const catalog = await service.getCatalog();
      assert.equal(catalog.loadState, "ready");
      assert.equal(catalog.voices.length, 1);
      assert.equal(catalog.voices[0]?.voiceId, "cached-voice");
      assert.equal(fetchCalled, false, "should not call network when cache is fresh");
      console.log("PASS: fresh cache row → no network call");
    }

    // ── Test 3: Not configured → not_configured (no network) ──
    {
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const service = new ElevenLabsVoiceCatalogService(
        {
          platformElevenlabsVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert() {
              throw new Error("should not upsert when not configured");
            }
          }
        } as never,
        secretStore({ configured: false })
      );

      const catalog = await service.getCatalog();
      assert.equal(catalog.loadState, "not_configured");
      assert.equal(catalog.configured, false);
      assert.equal(catalog.voices.length, 0);
      assert.equal(fetchCalled, false, "should not call network when not configured");
      console.log("PASS: missing credentials → not_configured without network");
    }

    // ── Test 4: HTTP error + no cache → unavailable with warning ──
    {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })) as typeof fetch;

      const service = new ElevenLabsVoiceCatalogService(
        {
          platformElevenlabsVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert() {
              throw new Error("should not upsert on HTTP error");
            }
          }
        } as never,
        secretStore({})
      );

      const catalog = await service.getCatalog();
      assert.equal(catalog.loadState, "unavailable");
      assert.equal(catalog.configured, true);
      assert.equal(catalog.voices.length, 0);
      assert.ok(catalog.warning, "should surface a warning when unavailable");
      console.log("PASS: HTTP error + no cache → unavailable with warning");
    }

    // ── Test 5: Expired cache + HTTP error → serve stale cache with warning ──
    {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: "Service down" }), { status: 503 })) as typeof fetch;

      const service = new ElevenLabsVoiceCatalogService(
        {
          platformElevenlabsVoiceCatalogCache: {
            async findUnique() {
              return {
                voicesJson: [
                  {
                    voiceId: "stale-voice",
                    name: "Stale",
                    gender: "female",
                    category: null,
                    language: "en",
                    languageBucket: "en",
                    previewUrl: null
                  }
                ],
                fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
              };
            },
            async upsert() {
              throw new Error("should not upsert on HTTP error");
            }
          }
        } as never,
        secretStore({})
      );

      const catalog = await service.getCatalog();
      assert.equal(catalog.loadState, "ready");
      assert.equal(catalog.voices[0]?.voiceId, "stale-voice");
      assert.ok(catalog.warning, "stale cache should carry a refresh-failed warning");
      console.log("PASS: expired cache + HTTP error → serves stale cache with warning");
    }

    console.log("\nAll ElevenLabs voice catalog tests PASSED");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
