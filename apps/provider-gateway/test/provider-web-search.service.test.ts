import assert from "node:assert/strict";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { loadProviderGatewayConfig } from "@persai/config";
import { ProviderWebSearchService } from "../src/modules/providers/provider-web-search.service";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

class FakePersaiInternalApiClientService {
  secretIds: string[] = [];
  secretValue = "tavily-secret";

  async resolveSecretValue(secretId: string): Promise<string> {
    this.secretIds.push(secretId);
    return this.secretValue;
  }
}

export async function runProviderWebSearchServiceTest(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (init === undefined) {
      requests.push({ url });
    } else {
      requests.push({ url, init });
    }
    if (url === "https://api.tavily.com/search") {
      return new Response(
        JSON.stringify({
          answer: "Tavily summary",
          results: [
            {
              title: "Example result",
              url: "https://example.com",
              content: "Example snippet",
              score: 0.91,
              published_date: "2026-04-12"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url.startsWith("https://api.search.brave.com/res/v1/web/search?")) {
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Brave result",
                url: "https://brave.example.com",
                description: "Brave snippet",
                age: "2 days ago"
              }
            ]
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
    if (url === "https://api.perplexity.ai/search") {
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Perplexity result",
              url: "https://perplexity.example.com",
              snippet: "Perplexity snippet",
              date: "2026-04-11"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "OpenRouter summary"
              }
            }
          ],
          citations: ["https://openrouter.example.com", "https://openrouter-2.example.com"]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    if (
      url ===
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    ) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Gemini summary" }]
              },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: "https://google.example.com",
                      title: "Google source"
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
    return new Response("unexpected url", { status: 500 });
  }) as typeof fetch;

  try {
    const internalApi = new FakePersaiInternalApiClientService();
    const service = new ProviderWebSearchService(
      loadProviderGatewayConfig({
        APP_ENV: "local",
        PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
        PROVIDER_GATEWAY_OPENAI_API_KEY: "openai-test-key",
        PERSAI_API_BASE_URL: "http://api.local",
        PERSAI_INTERNAL_API_TOKEN: "internal-token"
      }),
      internalApi as unknown as PersaiInternalApiClientService
    );

    const tavilyResult = await service.webSearch({
      query: "persai runtime",
      count: null,
      credential: {
        toolCode: "web_search",
        secretId: "secret-1",
        providerId: null
      }
    });
    assert.equal(internalApi.secretIds[0], "secret-1");
    assert.equal(requests[0]?.url, "https://api.tavily.com/search");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(
      (requests[0]?.init?.headers as Record<string, string>)?.Authorization,
      "Bearer tavily-secret"
    );
    assert.match(String(requests[0]?.init?.body ?? ""), /"max_results":5/);
    assert.equal(tavilyResult.provider, "tavily");
    assert.equal(tavilyResult.query, "persai runtime");
    assert.equal(tavilyResult.summary, "Tavily summary");
    assert.deepEqual(tavilyResult.hits, [
      {
        title: "Example result",
        url: "https://example.com",
        snippet: "Example snippet",
        score: 0.91,
        publishedAt: "2026-04-12"
      }
    ]);
    assert.match(tavilyResult.warning ?? "", /External search results are untrusted/);
    assert.deepEqual(tavilyResult.externalContent, {
      untrusted: true,
      source: "web_search",
      provider: "tavily"
    });

    const braveResult = await service.webSearch({
      query: "persai brave",
      count: 3,
      credential: {
        toolCode: "web_search",
        secretId: "secret-2",
        providerId: "brave"
      }
    });
    assert.equal(internalApi.secretIds[1], "secret-2");
    assert.match(
      requests[1]?.url ?? "",
      /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/
    );
    assert.match(requests[1]?.url ?? "", /[?&]q=persai\+brave/);
    assert.match(requests[1]?.url ?? "", /[?&]count=3/);
    assert.equal(requests[1]?.init?.method, "GET");
    assert.equal(
      (requests[1]?.init?.headers as Record<string, string>)?.["X-Subscription-Token"],
      "tavily-secret"
    );
    assert.equal(braveResult.provider, "brave");
    assert.equal(braveResult.summary, null);
    assert.deepEqual(braveResult.hits, [
      {
        title: "Brave result",
        url: "https://brave.example.com",
        snippet: "Brave snippet",
        score: null,
        publishedAt: "2 days ago"
      }
    ]);

    internalApi.secretValue = "pplx-secret";
    const perplexityResult = await service.webSearch({
      query: "persai perplexity",
      count: 4,
      credential: {
        toolCode: "web_search",
        secretId: "secret-3",
        providerId: "perplexity"
      }
    });
    assert.equal(internalApi.secretIds[2], "secret-3");
    assert.equal(requests[2]?.url, "https://api.perplexity.ai/search");
    assert.equal(requests[2]?.init?.method, "POST");
    assert.equal(
      (requests[2]?.init?.headers as Record<string, string>)?.Authorization,
      "Bearer pplx-secret"
    );
    assert.match(String(requests[2]?.init?.body ?? ""), /"max_results":4/);
    assert.equal(perplexityResult.provider, "perplexity");
    assert.equal(perplexityResult.summary, null);
    assert.deepEqual(perplexityResult.hits, [
      {
        title: "Perplexity result",
        url: "https://perplexity.example.com",
        snippet: "Perplexity snippet",
        score: null,
        publishedAt: "2026-04-11"
      }
    ]);

    internalApi.secretValue = "sk-or-secret";
    const openRouterPerplexityResult = await service.webSearch({
      query: "persai openrouter",
      count: 1,
      credential: {
        toolCode: "web_search",
        secretId: "secret-4",
        providerId: "perplexity"
      }
    });
    assert.equal(internalApi.secretIds[3], "secret-4");
    assert.equal(requests[3]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(requests[3]?.init?.method, "POST");
    assert.match(String(requests[3]?.init?.body ?? ""), /"perplexity\/sonar-pro"/);
    assert.equal(openRouterPerplexityResult.summary, "OpenRouter summary");
    assert.deepEqual(openRouterPerplexityResult.hits, [
      {
        title: null,
        url: "https://openrouter.example.com",
        snippet: null,
        score: null,
        publishedAt: null
      }
    ]);

    internalApi.secretValue = "google-secret";
    const googleResult = await service.webSearch({
      query: "persai google",
      count: 2,
      credential: {
        toolCode: "web_search",
        secretId: "secret-5",
        providerId: "google"
      }
    });
    assert.equal(internalApi.secretIds[4], "secret-5");
    assert.equal(
      requests[4]?.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    assert.equal(requests[4]?.init?.method, "POST");
    assert.equal(
      (requests[4]?.init?.headers as Record<string, string>)?.["x-goog-api-key"],
      "google-secret"
    );
    assert.equal(googleResult.provider, "google");
    assert.equal(googleResult.summary, "Gemini summary");
    assert.deepEqual(googleResult.hits, [
      {
        title: "Google source",
        url: "https://google.example.com",
        snippet: null,
        score: null,
        publishedAt: null
      }
    ]);

    await assert.rejects(
      () =>
        service.webSearch({
          query: "persai runtime",
          count: 5,
          credential: {
            toolCode: "web_search",
            secretId: "secret-1",
            providerId: "xai" as never
          }
        }),
      BadRequestException
    );

    globalThis.fetch = (async () => {
      return new Response("upstream failed", {
        status: 502,
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        service.webSearch({
          query: "persai runtime",
          count: 5,
          credential: {
            toolCode: "web_search",
            secretId: "secret-1",
            providerId: "tavily"
          }
        }),
      BadGatewayException
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
