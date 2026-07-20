import assert from "node:assert/strict";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { loadProviderGatewayConfig } from "@persai/config";
import { ProviderWebFetchService } from "../src/modules/providers/provider-web-fetch.service";
import type { PersaiInternalApiClientService } from "../src/modules/providers/persai-internal-api.client.service";

class FakePersaiInternalApiClientService {
  secretIds: string[] = [];
  secretValue = "firecrawl-secret";

  async resolveSecretValue(secretId: string): Promise<string> {
    this.secretIds.push(secretId);
    return this.secretValue;
  }
}

export async function runProviderWebFetchServiceTest(): Promise<void> {
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
    return new Response(
      JSON.stringify({
        success: true,
        warning: "Provider note.",
        data: {
          markdown: "# Example\nA [link](https://example.com/link)\n",
          metadata: {
            title: "Example page",
            sourceURL: "https://example.com/final",
            statusCode: 200
          }
        }
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
    const internalApi = new FakePersaiInternalApiClientService();
    const service = new ProviderWebFetchService(
      loadProviderGatewayConfig({
        APP_ENV: "local",
        PROVIDER_GATEWAY_WARM_ON_BOOT: "false",
        PERSAI_API_BASE_URL: "http://api.local",
        PERSAI_INTERNAL_API_TOKEN: "internal-token"
      }),
      internalApi as unknown as PersaiInternalApiClientService
    );

    const result = await service.webFetch({
      url: "https://example.com",
      extractMode: "text",
      maxChars: null,
      credential: {
        toolCode: "web_fetch",
        secretId: "secret-1",
        providerId: "firecrawl"
      }
    });
    assert.equal(internalApi.secretIds[0], "secret-1");
    assert.equal(requests[0]?.url, "https://api.firecrawl.dev/v2/scrape");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(
      (requests[0]?.init?.headers as Record<string, string>)?.Authorization,
      "Bearer firecrawl-secret"
    );
    assert.equal(result.provider, "firecrawl");
    assert.equal(result.finalUrl, "https://example.com/final");
    assert.equal(result.title, "Example page");
    assert.equal(result.content, "Example\nA link");
    assert.equal(result.contentType, "text/plain");
    assert.equal(result.extractMode, "text");
    assert.equal(result.status, 200);
    assert.equal(result.truncated, false);
    assert.match(result.warning ?? "", /External webpage content is untrusted/);
    assert.match(result.warning ?? "", /Provider note/);
    assert.deepEqual(result.externalContent, {
      untrusted: true,
      source: "web_fetch",
      provider: "firecrawl"
    });

    await assert.rejects(
      () =>
        service.webFetch({
          url: "ftp://example.com",
          extractMode: "markdown",
          maxChars: null,
          credential: {
            toolCode: "web_fetch",
            secretId: "secret-1",
            providerId: "firecrawl"
          }
        }),
      BadRequestException
    );

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          error: "upstream failed"
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }) as typeof fetch;
    await assert.rejects(
      () =>
        service.webFetch({
          url: "https://example.com",
          extractMode: "markdown",
          maxChars: null,
          credential: {
            toolCode: "web_fetch",
            secretId: "secret-1",
            providerId: "firecrawl"
          }
        }),
      BadGatewayException
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
