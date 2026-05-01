import assert from "node:assert/strict";
import { KnowledgeDocumentProcessorService } from "../src/modules/workspace-management/application/knowledge-document-processor.service";

const policy = {
  defaultProvider: "mistral",
  highQualityFallbackProvider: "llamaparse",
  localFallbackEnabled: true,
  autoFallbackEnabled: true,
  needsReviewThreshold: 0.65
};

async function run(): Promise<void> {
  await usesMistralForPdfKnowledgeProcessing();
  await keepsLocalKnowledgeProcessingLocal();
}

async function usesMistralForPdfKnowledgeProcessing(): Promise<void> {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    if (String(url).endsWith("/v1/files")) {
      return jsonResponse({ id: "mistral-file-1" });
    }
    if (String(url).includes("/v1/files/mistral-file-1/url")) {
      return jsonResponse({ url: "https://signed.example/document.pdf" });
    }
    if (String(url).endsWith("/v1/ocr")) {
      return jsonResponse({
        pages: [{ markdown: "Parsed PDF heading" }, { markdown: "Second page text" }]
      });
    }
    return new Response("unexpected URL", { status: 500 });
  }) as typeof fetch;

  try {
    const service = new KnowledgeDocumentProcessorService(
      prismaWithPolicy() as never,
      failingMediaPreprocessor() as never,
      secretStore() as never
    );
    const result = await service.process({
      source: source(),
      content: {
        kind: "bytes",
        buffer: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        originalFilename: "guide.pdf"
      }
    });

    assert.equal(result.normalizedText, "Parsed PDF heading\n\nSecond page text");
    assert.equal(result.provider.providerKey, "mistral");
    assert.equal(result.provider.processorMode, "default_provider");
    assert.deepEqual(result.provider.attemptedProviderKeys, ["mistral"]);
    assert.equal(
      calls.some((call) => call.url.endsWith("/v1/ocr")),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function keepsLocalKnowledgeProcessingLocal(): Promise<void> {
  let receivedOptions: unknown = "not-called";
  const service = new KnowledgeDocumentProcessorService(
    prismaWithPolicy() as never,
    {
      async process(
        _buffer: Buffer,
        _mimeType: string,
        _originalFilename: string,
        options?: unknown
      ) {
        receivedOptions = options;
        return { textExtract: "local text" };
      }
    } as never,
    secretStore() as never
  );

  const result = await service.process({
    source: source(),
    requestedMode: "local",
    content: {
      kind: "bytes",
      buffer: Buffer.from("%PDF"),
      mimeType: "application/pdf",
      originalFilename: "local.pdf"
    }
  });

  assert.equal(result.normalizedText, "local text");
  assert.equal(result.provider.providerKey, "local");
  assert.equal(receivedOptions, undefined);
}

function prismaWithPolicy() {
  return {
    platformRuntimeProviderSettings: {
      findUnique: async () => ({ documentProcessingPolicy: policy })
    }
  };
}

function secretStore() {
  return {
    loadKeyMetadataByKeys: async () => ({
      document_processing_mistral: { configured: true },
      document_processing_llamaparse: { configured: true }
    }),
    resolveSecretValueByProviderKey: async (providerKey: string) => `${providerKey}-key`
  };
}

function failingMediaPreprocessor() {
  return {
    async process() {
      throw new Error("local media preprocessor should not run for provider-backed PDF");
    }
  };
}

function source() {
  return {
    sourceType: "skill_document" as const,
    sourceId: "doc-1",
    sourceVersion: 1,
    workspaceId: "ws-1",
    skillId: "skill-1",
    provenance: {
      originKind: "skill_document" as const,
      originalFilename: "guide.pdf",
      mimeType: "application/pdf"
    }
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

void run();
