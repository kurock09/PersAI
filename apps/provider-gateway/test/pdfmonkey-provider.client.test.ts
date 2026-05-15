import assert from "node:assert/strict";
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type { ProviderGatewayDocumentGenerateRequest } from "@persai/runtime-contract";
import { PdfMonkeyProviderClient } from "../src/modules/providers/pdfmonkey/pdfmonkey-provider.client";

function createConfig(): ProviderGatewayConfig {
  return {
    APP_ENV: "local",
    PORT: 3011,
    LOG_LEVEL: "info",
    PROVIDER_GATEWAY_WARM_ON_BOOT: false,
    PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS: 5_000,
    PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_STREAM_TIMEOUT_MS: 90_000,
    PROVIDER_GATEWAY_BROWSERLESS_BASE_URL: "https://production-sfo.browserless.io",
    PROVIDER_GATEWAY_OPENAI_API_KEY: undefined,
    PROVIDER_GATEWAY_ANTHROPIC_API_KEY: undefined,
    PROVIDER_GATEWAY_OPENAI_MODELS: ["gpt-5.4"],
    PROVIDER_GATEWAY_ANTHROPIC_MODELS: ["claude-sonnet-4-5"]
  };
}

function createRequest(): ProviderGatewayDocumentGenerateRequest {
  return {
    htmlContent: "<!DOCTYPE html><html><body><h1>Brief</h1></body></html>",
    filename: "brief.pdf",
    timeoutMs: 120000,
    credential: {
      toolCode: "document",
      secretId: "tool/document/pdfmonkey/api-key",
      providerId: "pdfmonkey"
    },
    providerOptions: {
      pdfmonkeyTemplateId: "template-123",
      outputFormat: "pdf"
    }
  };
}

export async function runPdfMonkeyProviderClientTest(): Promise<void> {
  const client = new PdfMonkeyProviderClient(createConfig());
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/documents/sync")) {
        return new Response(
          JSON.stringify({
            errors: {
              document_template_id: ["Template was not found."]
            }
          }),
          {
            status: 404,
            headers: {
              "Content-Type": "application/json"
            }
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
            retryable?: boolean;
            providerStatus?: { httpStatus?: number; documentTemplateId?: string };
          };
        };
        assert.equal(response.error?.code, "pdfmonkey_template_not_found");
        assert.equal(response.error?.retryable, false);
        assert.equal(response.error?.providerStatus?.httpStatus, 404);
        assert.equal(response.error?.providerStatus?.documentTemplateId, "template-123");
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/documents/sync")) {
        return new Response(
          JSON.stringify({
            errors: {
              api_key: ["Unauthorized"]
            }
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      () => client.generateDocument(createRequest(), { apiKey: "secret" }),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedException);
        const response = error.getResponse() as {
          error?: { code?: string; retryable?: boolean };
        };
        assert.equal(response.error?.code, "pdfmonkey_auth_failed");
        assert.equal(response.error?.retryable, false);
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/documents/sync")) {
        return new Response("upstream unavailable", {
          status: 503,
          headers: {
            "Content-Type": "text/plain"
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
          error?: { code?: string; retryable?: boolean };
        };
        assert.equal(response.error?.code, "pdfmonkey_unavailable");
        assert.equal(response.error?.retryable, true);
        return true;
      }
    );

    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/documents/sync")) {
        return new Response(
          JSON.stringify({
            document_card: {
              id: "pdf-doc-1",
              document_template_id: "template-123",
              download_url: "https://files.example.com/document.pdf",
              failure_cause: null,
              filename: "brief.pdf",
              preview_url: "https://files.example.com/preview",
              output_type: "pdf",
              status: "success",
              updated_at: "2026-05-15T18:00:01.000Z"
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
      if (url === "https://files.example.com/document.pdf") {
        return new Response("missing", {
          status: 404,
          headers: {
            "Content-Type": "text/plain"
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
          error?: {
            code?: string;
            retryable?: boolean;
            providerStatus?: { status?: string; httpStatus?: number; documentId?: string };
          };
        };
        assert.equal(response.error?.code, "pdfmonkey_download_unavailable");
        assert.equal(response.error?.retryable, true);
        assert.equal(response.error?.providerStatus?.status, "download_failed");
        assert.equal(response.error?.providerStatus?.httpStatus, 404);
        assert.equal(response.error?.providerStatus?.documentId, "pdf-doc-1");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
