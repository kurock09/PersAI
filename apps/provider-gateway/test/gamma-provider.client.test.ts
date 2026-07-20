import assert from "node:assert/strict";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type { ProviderGatewayDocumentGenerateRequest } from "@persai/runtime-contract";
import { GammaProviderClient } from "../src/modules/providers/gamma/gamma-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS: 5,
    PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS: 2_000,
    PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS: 10_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(
  outputFormat: "pdf" | "pptx" = "pptx"
): ProviderGatewayDocumentGenerateRequest {
  return {
    htmlContent:
      "<!DOCTYPE html><html><body><h1>PersAI deck</h1><p>Investor update with traction and roadmap.</p></body></html>",
    filename: `persai-deck.${outputFormat}`,
    timeoutMs: 120000,
    credential: {
      toolCode: "document",
      secretId: "tool/document/gamma/api-key",
      providerId: "gamma"
    },
    providerOptions: {
      outputFormat,
      presentationOptions: {
        textMode: "generate",
        numCards: 8,
        cardSplit: "auto",
        additionalInstructions:
          "Make it feel bold and visual first. Use image-led layouts and strong contrast.",
        textOptions: {
          amount: "brief",
          language: "en",
          tone: "professional, punchy",
          audience: "investors"
        },
        imageOptions: {
          source: "aiGenerated",
          style: "bold editorial, premium startup deck aesthetic",
          stylePreset: "custom"
        },
        cardOptions: {
          dimensions: "16x9"
        },
        themeId: "theme-ocean"
      }
    }
  };
}

export async function runGammaProviderClientTest(): Promise<void> {
  const client = new GammaProviderClient(createConfig());
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];

  try {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      let body: unknown = null;
      if (typeof init?.body === "string" && init.body.length > 0) {
        body = JSON.parse(init.body);
      }
      calls.push({ url, body });

      if (url.endsWith("/v1.0/generations")) {
        return new Response(JSON.stringify({ generationId: "gen-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/v1.0/generations/gen-1")) {
        return new Response(
          JSON.stringify({
            generationId: "gen-1",
            status: "completed",
            gammaId: "gamma-1",
            gammaUrl: "https://gamma.app/docs/gamma-1",
            exportUrl: "https://gamma.app/export/gamma-1.pptx"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (url === "https://gamma.app/export/gamma-1.pptx") {
        return new Response(Buffer.from("pptx-binary"), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          }
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await client.generateDocument(createRequest(), { apiKey: "secret" });
    assert.equal(result.provider, "gamma");
    assert.equal(result.outputFormat, "pptx");
    assert.equal(calls.length >= 3, true);

    const createCall = calls.find((entry) => entry.url.endsWith("/v1.0/generations"));
    assert.ok(createCall, "expected Gamma create-generation call");
    assert.deepEqual(createCall.body, {
      inputText: "PersAI deck Investor update with traction and roadmap.",
      textMode: "generate",
      format: "presentation",
      exportAs: "pptx",
      themeId: "theme-ocean",
      title: "persai-deck",
      numCards: 8,
      cardSplit: "auto",
      additionalInstructions:
        "Make it feel bold and visual first. Use image-led layouts and strong contrast.",
      textOptions: {
        amount: "brief",
        language: "en",
        tone: "professional, punchy",
        audience: "investors"
      },
      cardOptions: {
        dimensions: "16x9"
      },
      imageOptions: {
        source: "aiGenerated",
        style: "bold editorial, premium startup deck aesthetic",
        stylePreset: "custom"
      }
    });

    const pdfCalls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      let body: unknown = null;
      if (typeof init?.body === "string" && init.body.length > 0) {
        body = JSON.parse(init.body);
      }
      pdfCalls.push({ url, body });

      if (url.endsWith("/v1.0/generations")) {
        return new Response(JSON.stringify({ generationId: "gen-pdf-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/v1.0/generations/gen-pdf-1")) {
        return new Response(
          JSON.stringify({
            generationId: "gen-pdf-1",
            status: "completed",
            gammaId: "gamma-pdf-1",
            gammaUrl: "https://gamma.app/docs/gamma-pdf-1",
            exportUrl: "https://gamma.app/export/gamma-pdf-1.pdf"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (url === "https://gamma.app/export/gamma-pdf-1.pdf") {
        return new Response(Buffer.from("pdf-binary"), {
          status: 200,
          headers: { "Content-Type": "application/pdf" }
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const pdfResult = await client.generateDocument(createRequest("pdf"), { apiKey: "secret" });
    assert.equal(pdfResult.provider, "gamma");
    assert.equal(pdfResult.outputFormat, "pdf");
    const pdfCreateCall = pdfCalls.find((entry) => entry.url.endsWith("/v1.0/generations"));
    assert.ok(pdfCreateCall, "expected Gamma create-generation call for PDF");
    assert.equal((pdfCreateCall.body as { exportAs?: string }).exportAs, "pdf");
  } finally {
    globalThis.fetch = originalFetch;
  }

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1.0/generations")) {
        return new Response(JSON.stringify({ generationId: "gen-2" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/v1.0/generations/gen-2")) {
        return new Response(
          JSON.stringify({
            generationId: "gen-2",
            status: "completed",
            gammaId: "gamma-2",
            gammaUrl: "https://gamma.app/docs/gamma-2",
            exportUrl: "https://gamma.app/export/gamma-2.pptx"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (url === "https://gamma.app/export/gamma-2.pptx") {
        return new Response(Buffer.alloc(0), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          }
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => client.generateDocument(createRequest(), { apiKey: "secret" }),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        const response = error.getResponse() as {
          error?: { code?: string; providerStatus?: { status?: string } };
        };
        assert.equal(response.error?.code, "gamma_empty_export_payload");
        assert.equal(response.error?.providerStatus?.status, "export_empty");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1.0/generations")) {
        return new Response(JSON.stringify({ generationId: "gen-unsafe-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/v1.0/generations/gen-unsafe-1")) {
        return new Response(
          JSON.stringify({
            generationId: "gen-unsafe-1",
            status: "completed",
            gammaId: "gamma-unsafe-1",
            gammaUrl: "https://gamma.app/docs/gamma-unsafe-1",
            exportUrl: "https://example.com/gamma-unsafe-1.pptx"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => client.generateDocument(createRequest(), { apiKey: "secret" }),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        const response = error.getResponse() as {
          error?: { code?: string; providerStatus?: { status?: string } };
        };
        assert.equal(response.error?.code, "gamma_export_unavailable");
        assert.equal(response.error?.providerStatus?.status, "completed_missing_export");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1.0/generations")) {
        return new Response(JSON.stringify({ generationId: "gen-no-gamma-url-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.endsWith("/v1.0/generations/gen-no-gamma-url-1")) {
        return new Response(
          JSON.stringify({
            generationId: "gen-no-gamma-url-1",
            status: "completed",
            gammaId: "gamma-no-gamma-url-1",
            exportUrl: "https://gamma.app/export/gamma-no-gamma-url-1.pptx"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (url === "https://gamma.app/export/gamma-no-gamma-url-1.pptx") {
        return new Response(Buffer.from("pptx-binary"), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          }
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await client.generateDocument(createRequest(), { apiKey: "secret" });
    assert.equal(result.provider, "gamma");
    assert.equal(result.providerStatus.gammaUrl, null);
  } finally {
    globalThis.fetch = originalFetch;
  }

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1.0/generations")) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Invalid generation request",
              details: {
                field: "outline",
                apiKey: "must-not-persist"
              }
            }
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => client.generateDocument(createRequest(), { apiKey: "secret" }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          error?: {
            code?: string;
            providerStatus?: {
              responseBody?: { error?: { details?: { field?: string; apiKey?: string } } };
            };
          };
        };
        assert.equal(response.error?.code, "gamma_request_invalid");
        assert.equal(
          response.error?.providerStatus?.responseBody?.error?.details?.field,
          "outline"
        );
        assert.equal(
          response.error?.providerStatus?.responseBody?.error?.details?.apiKey,
          "[redacted]"
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void runGammaProviderClientTest();
