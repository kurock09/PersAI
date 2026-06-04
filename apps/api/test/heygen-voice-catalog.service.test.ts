import assert from "node:assert/strict";
import { HeyGenVoiceCatalogService } from "../src/modules/workspace-management/application/heygen/heygen-voice-catalog.service";

const HEYGEN_CREDENTIAL_ID = "tool/video_generate/heygen/api-key";

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    // ── Test 1: Fresh cache (no row) → network call → populates shortlist ──
    {
      const upserts: Array<Record<string, unknown>> = [];
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                voice_id: "en-US-Amy",
                name: "Amy",
                language: "en-US",
                gender: "female",
                preview_audio: "https://cdn.heygen.com/preview/amy.mp3",
                tags: ["natural", "warm"]
              },
              {
                voice_id: "en-US-Brian",
                name: "Brian",
                language: "en-US",
                gender: "male",
                preview_audio: "https://cdn.heygen.com/preview/brian.mp3",
                tags: ["clear", "professional"]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
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
            assert.equal(secretId, HEYGEN_CREDENTIAL_ID);
            return "heygen-test-api-key";
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.ok(catalog, "catalog should not be null");
      assert.equal(catalog.provider, "heygen");
      assert.deepEqual(
        catalog.shortlist.map((e) => e.voiceKey),
        ["amy", "brian"]
      );
      assert.deepEqual(
        catalog.shortlist.map((e) => e.providerVoiceId),
        ["en-US-Amy", "en-US-Brian"]
      );
      assert.equal(catalog.shortlist[0]?.previewAudioUrl, "https://cdn.heygen.com/preview/amy.mp3");
      assert.equal(
        catalog.shortlist[1]?.previewAudioUrl,
        "https://cdn.heygen.com/preview/brian.mp3"
      );
      assert.equal(upserts.length, 1, "should upsert once");
      console.log("PASS: fresh cache → network call → shortlist populated");
    }

    // ── Test 2: Fresh cache row (not expired) → no network call ──
    {
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const recentFetchedAt = new Date(Date.now() - 60 * 1000); // 1 minute ago
      const cachedVoices = [
        {
          voiceKey: "cached-voice",
          providerVoiceId: "cv-001",
          displayName: "Cached Voice",
          locale: "en-US",
          gender: "female",
          description: null,
          styleTags: [],
          previewAudioUrl: null
        }
      ];

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return {
                voicesJson: cachedVoices,
                fetchedAt: recentFetchedAt
              };
            },
            async upsert() {
              throw new Error("should not upsert when cache is fresh");
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "unused-key";
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.ok(catalog);
      assert.equal(catalog.provider, "heygen");
      assert.equal(catalog.shortlist.length, 1);
      assert.equal(catalog.shortlist[0]?.voiceKey, "cached-voice");
      assert.equal(fetchCalled, false, "should not call network when cache is fresh");
      console.log("PASS: fresh cache row → no network call");
    }

    // ── Test 3: Expired cache → triggers refresh ──
    {
      const upserts: Array<Record<string, unknown>> = [];
      const expiredFetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago (expired)

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            voices: [
              {
                voice_id: "refreshed-voice",
                name: "Refreshed",
                language: "en",
                gender: "neutral"
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return {
                voicesJson: [
                  {
                    voiceKey: "old-voice",
                    providerVoiceId: "old-001",
                    displayName: "Old Voice",
                    locale: null,
                    gender: "unknown",
                    description: null,
                    styleTags: [],
                    previewAudioUrl: null
                  }
                ],
                fetchedAt: expiredFetchedAt
              };
            },
            async upsert(input: Record<string, unknown>) {
              upserts.push(input);
              return input;
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "heygen-test-api-key";
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.ok(catalog);
      assert.equal(catalog.shortlist[0]?.voiceKey, "refreshed");
      assert.equal(upserts.length, 1, "should upsert on refresh");
      console.log("PASS: expired cache → triggers refresh + upsert");
    }

    // ── Test 4: Missing credentials → returns null (no throw) ──
    {
      globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert() {
              throw new Error("should not upsert with missing credentials");
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return null;
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.equal(catalog, null, "should return null when credentials missing");
      console.log("PASS: missing credentials → returns null without throwing");
    }

    // ── Test 5: HTTP error from HeyGen → falls back to stale cached data ──
    {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        })) as typeof fetch;

      const staleVoices = [
        {
          voiceKey: "stale-voice",
          providerVoiceId: "sv-001",
          displayName: "Stale Voice",
          locale: "en",
          gender: "male",
          description: null,
          styleTags: [],
          previewAudioUrl: null
        }
      ];
      const staleFetchedAt = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return { voicesJson: staleVoices, fetchedAt: staleFetchedAt };
            },
            async upsert() {
              throw new Error("should not upsert on HTTP error");
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "heygen-test-api-key";
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.ok(catalog, "should return stale cache on HTTP error");
      assert.equal(catalog.shortlist[0]?.voiceKey, "stale-voice");
      console.log("PASS: HTTP error → falls back to stale cached data");
    }

    // ── Test 6: Defensive parser — flat array of voices ──
    {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify([
            {
              voice_id: "flat-001",
              name: "Flat Voice",
              language: "fr",
              gender: "female",
              preview_audio: "https://cdn.heygen.com/preview/flat.mp3"
            }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert(input: Record<string, unknown>) {
              return input;
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "heygen-test-api-key";
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.ok(catalog);
      assert.equal(catalog.shortlist[0]?.voiceKey, "flat-voice");
      assert.equal(catalog.shortlist[0]?.locale, "fr");
      assert.equal(
        catalog.shortlist[0]?.previewAudioUrl,
        "https://cdn.heygen.com/preview/flat.mp3"
      );
      console.log("PASS: defensive parser handles flat array response");
    }

    // ── Test 7: voiceId field alias ──
    {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                voiceId: "alias-voice-001",
                name: "Alias Voice",
                language: "de",
                gender: "male"
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert(input: Record<string, unknown>) {
              return input;
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "heygen-test-api-key";
          }
        } as never
      );

      const catalog = await service.getMaterializedVoiceCatalog();
      assert.ok(catalog);
      assert.equal(catalog.shortlist[0]?.providerVoiceId, "alias-voice-001");
      assert.equal(catalog.shortlist[0]?.previewAudioUrl, null);
      console.log("PASS: voiceId field alias resolves correctly");
    }

    console.log("\nAll HeyGen voice catalog tests PASSED");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
