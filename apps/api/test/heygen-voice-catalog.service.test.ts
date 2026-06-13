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

    // ── Test 2b: Admin curation gates user and model voice catalogs ─────────
    {
      globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
      const cachedVoices = [
        {
          voiceKey: "approved-voice",
          providerVoiceId: "approved-001",
          displayName: "Approved Voice",
          locale: "Multilingual",
          gender: "unknown",
          description: null,
          styleTags: [],
          previewAudioUrl: "https://cdn.heygen.com/preview/approved.mp3",
          providerVoiceType: "private",
          multilingual: true
        },
        {
          voiceKey: "pending-voice",
          providerVoiceId: "pending-001",
          displayName: "Pending Voice",
          locale: "ru",
          gender: "female",
          description: null,
          styleTags: [],
          previewAudioUrl: "https://cdn.heygen.com/preview/pending.mp3",
          providerVoiceType: "public",
          multilingual: false
        }
      ];
      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return {
                voicesJson: cachedVoices,
                fetchedAt: new Date(Date.now() - 60 * 1000)
              };
            },
            async upsert() {
              throw new Error("should not refresh fresh cache");
            }
          },
          platformHeygenVoiceCuration: {
            async findMany(input?: { where?: Record<string, unknown> }) {
              const rows = [
                {
                  providerVoiceId: "approved-001",
                  approved: true,
                  enabled: true,
                  modelShortlist: false,
                  languageBucket: "ru",
                  gender: "female",
                  updatedAt: new Date("2026-06-12T12:00:00.000Z")
                }
              ];
              return input?.where?.modelShortlist === true ? [] : rows;
            },
            async upsert() {
              throw new Error("should not update curation");
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "heygen-test-api-key";
          }
        } as never
      );

      const userCatalog = await service.getApprovedVoiceCatalogEntries();
      assert.deepEqual(
        userCatalog.map((entry) => `${entry.providerVoiceId}:${entry.locale}:${entry.gender}`),
        ["approved-001:ru:female"]
      );
      const modelCatalog = await service.getMaterializedVoiceCatalog();
      assert.deepEqual(modelCatalog?.shortlist, []);
      console.log("PASS: admin curation gates user catalog and model shortlist separately");
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

    // ── Test 3b: Paginated HeyGen response → follows token cursor and captures RU+EN ──
    {
      const seenUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.includes("type=private")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("token=token-2")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  voice_id: "ru-RU-Anna",
                  name: "Anna",
                  language: "Russian",
                  gender: "female"
                }
              ],
              has_more: false
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                voice_id: "en-US-Amy",
                name: "Amy",
                language: "English",
                gender: "female"
              }
            ],
            has_more: true,
            next_token: "token-2"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

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
      assert.equal(catalog.shortlist.length, 2);
      assert.ok(
        catalog.shortlist.some((entry) => entry.providerVoiceId === "en-US-Amy"),
        "must keep EN voice from first page"
      );
      assert.ok(
        catalog.shortlist.some((entry) => entry.providerVoiceId === "ru-RU-Anna"),
        "must keep RU voice from next page"
      );
      assert.equal(
        seenUrls.length,
        4,
        "must fetch public pages, private page, and legacy previews"
      );
      assert.match(seenUrls[0] ?? "", /limit=100/);
      assert.match(seenUrls[0] ?? "", /type=public/);
      assert.ok(
        seenUrls.some((url) => url.includes("token=token-2")),
        "must follow the public pagination token"
      );
      console.log("PASS: paginated response follows token cursor and merges pages");
    }

    // ── Test 3d: Pagination cap is 100 pages ────────────────────────────────
    {
      const seenUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify({
            data: [
              {
                voice_id: `voice-${String(seenUrls.length)}`,
                name: `Voice ${String(seenUrls.length)}`,
                language: "English",
                gender: "female"
              }
            ],
            next_token: `token-${String(seenUrls.length + 1)}`
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

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
      assert.equal(
        seenUrls.length,
        201,
        "must fetch up to 100 pages per voice type before legacy preview enrichment"
      );
      console.log("PASS: pagination cap expanded to 100 pages");
    }

    // ── Test 3e: Unusable/provider-incompatible rows are filtered ───────────
    {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                voice_id: "good-avatar-v",
                name: "Good Avatar V",
                language: "English",
                gender: "female",
                type: "public",
                status: "ready",
                supported_api_engines: ["avatar_v"]
              },
              {
                voice_id: "private-voice",
                name: "Private Voice",
                language: "English",
                gender: "male",
                type: "private"
              },
              {
                voice_id: "failed-voice",
                name: "Failed Voice",
                language: "English",
                gender: "male",
                status: "failed"
              },
              {
                voice_id: "disabled-voice",
                name: "Disabled Voice",
                language: "English",
                gender: "male",
                is_available: false
              },
              {
                voice_id: "starfish-only",
                name: "Starfish Only",
                language: "English",
                gender: "male",
                supported_api_engines: ["starfish"]
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
      assert.deepEqual(catalog.shortlist.map((entry) => entry.providerVoiceId).sort(), [
        "good-avatar-v",
        "private-voice"
      ]);
      console.log(
        "PASS: unusable/provider-incompatible HeyGen voices are filtered, private imports remain"
      );
    }

    // ── Test 3e2: Private imported voices are retained as quality ElevenLabs voices ──
    {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v2/voices")) {
          return new Response(
            JSON.stringify({
              data: {
                voices: [
                  {
                    voice_id: "private-imported",
                    name: "Elena Gromova — Podcasts & Conversation",
                    preview_audio: "https://resource2.heygen.ai/voice_preview/private-imported.mp3"
                  }
                ]
              }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        const isPrivate = url.includes("type=private");
        return new Response(
          JSON.stringify({
            data: isPrivate
              ? [
                  {
                    voice_id: "private-imported",
                    name: "Elena Gromova — Podcasts & Conversation",
                    language: "unknown",
                    gender: "unknown",
                    type: "private",
                    support_pause: true
                  }
                ]
              : []
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert(input: Record<string, unknown>) {
              const create = input.create as { voicesJson?: unknown };
              const voices = create.voicesJson as Array<{
                providerVoiceId: string;
                locale: string;
                source: string;
                qualityTags: string[];
                previewAudioUrl: string | null;
              }>;
              assert.deepEqual(
                voices
                  .map((entry) => `${entry.providerVoiceId}:${entry.locale}:${entry.source}`)
                  .sort(),
                ["private-imported:en:elevenlabs", "private-imported:ru:elevenlabs"]
              );
              assert.ok(voices.every((entry) => entry.qualityTags.includes("professional")));
              assert.ok(
                voices.every(
                  (entry) =>
                    entry.previewAudioUrl ===
                    "https://resource2.heygen.ai/voice_preview/private-imported.mp3"
                )
              );
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

      const fullCatalogEntries = await service.getFullVoiceCatalogEntries();
      assert.deepEqual(
        fullCatalogEntries
          .map(
            (entry) =>
              `${entry.providerVoiceId}:${entry.locale}:${entry.source}:${entry.previewAudioUrl}`
          )
          .sort(),
        [
          "private-imported:en:elevenlabs:https://resource2.heygen.ai/voice_preview/private-imported.mp3",
          "private-imported:ru:elevenlabs:https://resource2.heygen.ai/voice_preview/private-imported.mp3"
        ]
      );
      console.log(
        "PASS: private imported HeyGen voices are retained and enriched with legacy previews"
      );
    }

    // ── Test 3e3: Private ElevenLabs-backed voices fall back to ElevenLabs preview by name ──
    {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v2/voices")) {
          return new Response(
            JSON.stringify({
              data: {
                voices: []
              }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        const isPrivate = url.includes("type=private");
        return new Response(
          JSON.stringify({
            data: isPrivate
              ? [
                  {
                    voice_id: "private-elevenlabs-missing-preview",
                    name: "Adam - Dominant, Firm",
                    language: "unknown",
                    gender: "unknown",
                    type: "private",
                    support_pause: true
                  }
                ]
              : []
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const service = new HeyGenVoiceCatalogService(
        {
          platformHeygenVoiceCatalogCache: {
            async findUnique() {
              return null;
            },
            async upsert(input: Record<string, unknown>) {
              const create = input.create as { voicesJson?: unknown };
              const voices = create.voicesJson as Array<{
                providerVoiceId: string;
                locale: string;
                source: string;
                previewAudioUrl: string | null;
                previewAvailable?: boolean;
              }>;
              assert.deepEqual(
                voices
                  .map(
                    (entry) =>
                      `${entry.providerVoiceId}:${entry.locale}:${entry.source}:${entry.previewAudioUrl}`
                  )
                  .sort(),
                [
                  "private-elevenlabs-missing-preview:en:elevenlabs:https://cdn.elevenlabs.io/preview/adam.mp3",
                  "private-elevenlabs-missing-preview:ru:elevenlabs:https://cdn.elevenlabs.io/preview/adam.mp3"
                ]
              );
              assert.ok(voices.every((entry) => entry.previewAvailable === true));
              return input;
            }
          },
          platformElevenlabsVoiceCatalogCache: {
            async findMany() {
              return [
                {
                  voicesJson: [
                    {
                      voiceId: "pNInz6obpgDQGcFmaJgB",
                      name: "Adam - Dominant, Firm",
                      previewUrl: "https://cdn.elevenlabs.io/preview/adam.mp3"
                    }
                  ],
                  fetchedAt: new Date("2026-06-13T00:00:00.000Z")
                }
              ];
            }
          }
        } as never,
        {
          async resolveSecretValueById() {
            return "heygen-test-api-key";
          }
        } as never
      );

      const fullCatalogEntries = await service.getFullVoiceCatalogEntries();
      assert.deepEqual(
        fullCatalogEntries
          .map(
            (entry) =>
              `${entry.providerVoiceId}:${entry.locale}:${entry.source}:${entry.previewAudioUrl}`
          )
          .sort(),
        [
          "private-elevenlabs-missing-preview:en:elevenlabs:https://cdn.elevenlabs.io/preview/adam.mp3",
          "private-elevenlabs-missing-preview:ru:elevenlabs:https://cdn.elevenlabs.io/preview/adam.mp3"
        ]
      );
      console.log(
        "PASS: private ElevenLabs-backed HeyGen voices fall back to ElevenLabs preview URLs by name"
      );
    }

    // ── Test 3f: Multilingual voices project into both RU and EN ─────────────
    {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                voice_id: "multi-voice",
                name: "Multi Voice",
                language: "Multilingual",
                gender: "female"
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
              const create = input.create as { voicesJson?: unknown };
              const voices = create.voicesJson as Array<{
                providerVoiceId: string;
                locale: string;
              }>;
              assert.deepEqual(
                voices.map((entry) => `${entry.providerVoiceId}:${entry.locale}`).sort(),
                ["multi-voice:en", "multi-voice:ru"]
              );
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

      const fullCatalogEntries = await service.getFullVoiceCatalogEntries();
      assert.deepEqual(
        fullCatalogEntries.map((entry) => `${entry.providerVoiceId}:${entry.locale}`).sort(),
        ["multi-voice:en", "multi-voice:ru"]
      );
      console.log("PASS: multilingual voices are available in RU and EN without a Multi bucket");
    }

    // ── Test 3g: Quality metadata ranks ElevenLabs / pro voices above broken previews ──
    {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                voice_id: "gemini-broken",
                name: "Gacrux",
                language: "Multilingual",
                gender: "female",
                preview_audio_url: "https://static.heygen.ai/voice_preview/gemini/gacrux.wav",
                support_pause: false
              },
              {
                voice_id: "heygen-pro-ru",
                name: "Dariya - Professional",
                language: "Russian",
                gender: "female",
                preview_audio_url: "https://resource.heygen.ai/text_to_speech/dariya.wav",
                support_pause: true
              },
              {
                voice_id: "eleven-ru",
                name: "Nadia",
                language: "Russian",
                gender: "female",
                preview_audio_url:
                  "https://resource.heygen.ai/text_to_speech/locale=ru-RUmodel=eleven_multilingual_v2id=voice.mp3",
                support_pause: true
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
      assert.deepEqual(
        catalog.shortlist.map((entry) => entry.providerVoiceId),
        ["eleven-ru", "heygen-pro-ru", "gemini-broken"]
      );
      assert.equal(catalog.shortlist[0]?.source, "elevenlabs");
      assert.deepEqual(catalog.shortlist[1]?.qualityTags, ["professional"]);
      assert.equal(catalog.shortlist[2]?.source, "gemini");
      assert.equal(catalog.shortlist[2]?.previewAvailable, false);
      console.log("PASS: quality metadata ranks good voices above broken Gemini previews");
    }

    // ── Test 3c: Repeated token from upstream → stop early without looping forever ──
    {
      const seenUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify({
            data: [
              {
                voice_id: "en-US-Amy",
                name: "Amy",
                language: "English",
                gender: "female"
              }
            ],
            has_more: true,
            next_token: "stuck-token"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

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
      assert.equal(catalog.shortlist.length, 1);
      assert.equal(
        seenUrls.length,
        5,
        "must stop once upstream repeats the cursor per voice type before legacy preview enrichment"
      );
      assert.match(seenUrls[0] ?? "", /limit=100/);
      assert.ok(
        seenUrls.some((url) => url.includes("token=stuck-token")),
        "must request the repeated cursor before stopping"
      );
      console.log("PASS: repeated token stops pagination early");
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
