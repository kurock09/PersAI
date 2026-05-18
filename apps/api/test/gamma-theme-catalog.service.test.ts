import assert from "node:assert/strict";
import { GammaThemeCatalogService } from "../src/modules/workspace-management/application/gamma/gamma-theme-catalog.service";

async function run(): Promise<void> {
  const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  let resolveByIdCalls = 0;
  let resolveByProviderKeyCalls = 0;
  const upserts: Array<Record<string, unknown>> = [];

  try {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "theme-standard",
              name: "Standard Theme",
              type: "standard",
              colorKeywords: ["blue"],
              toneKeywords: ["calm"]
            },
            {
              id: "theme-custom",
              name: "Custom Theme",
              type: "custom",
              colorKeywords: ["red"],
              toneKeywords: ["bold"]
            }
          ],
          hasMore: false,
          nextCursor: null
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    const service = new GammaThemeCatalogService(
      {
        platformGammaThemeCatalogCache: {
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
          resolveByIdCalls += 1;
          assert.equal(secretId, "tool/document/gamma/api-key");
          return "gamma-secret";
        },
        async resolveSecretValueByProviderKey() {
          resolveByProviderKeyCalls += 1;
          throw new Error("should not use provider-key lookup for Gamma tool secret");
        }
      } as never
    );

    const themes = await service.listStandardThemes();
    assert.deepEqual(themes, [
      {
        id: "theme-standard",
        name: "Standard Theme",
        type: "standard",
        colorKeywords: ["blue"],
        toneKeywords: ["calm"]
      }
    ]);
    assert.equal(resolveByIdCalls, 1);
    assert.equal(resolveByProviderKeyCalls, 0);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0]!.url, /\/v1\.0\/themes\?limit=50$/);
    assert.equal(fetchCalls[0]!.headers["X-API-KEY"], "gamma-secret");
    assert.equal(upserts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
