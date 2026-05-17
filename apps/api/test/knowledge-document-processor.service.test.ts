import assert from "node:assert/strict";
import { DocumentExtractionService } from "../src/modules/workspace-management/application/document-extraction.service";
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
  await keepsSimpleTextKnowledgeProcessingLocal();
  await knowledgeProcessorFacadeDelegatesToSharedExtractionService();
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
    const service = new DocumentExtractionService(
      prismaWithPolicy() as never,
      failingMediaPreprocessor() as never,
      secretStore() as never
    );
    const result = await service.extract({
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

async function keepsSimpleTextKnowledgeProcessingLocal(): Promise<void> {
  const service = new DocumentExtractionService(
    prismaWithPolicy() as never,
    failingMediaPreprocessor() as never,
    secretStore() as never
  );

  const result = await service.extract({
    source: source(),
    content: {
      kind: "bytes",
      buffer: Buffer.from(" local text "),
      mimeType: "text/plain",
      originalFilename: "local.txt"
    }
  });

  assert.equal(result.normalizedText, "local text");
  assert.equal(result.provider.providerKey, "local");
  assert.deepEqual(result.provider.attemptedProviderKeys, ["local"]);
}

async function knowledgeProcessorFacadeDelegatesToSharedExtractionService(): Promise<void> {
  const calls: unknown[] = [];
  const service = new KnowledgeDocumentProcessorService({
    async extract(input: unknown) {
      calls.push(input);
      return {
        normalizedText: "facade text",
        markdown: null,
        provider: {
          providerKey: "local",
          processorMode: "local",
          attemptedProviderKeys: ["local"]
        },
        quality: {
          status: "ok",
          score: 0.8,
          reasonCodes: [],
          textChars: 11
        }
      };
    }
  } as never);

  const result = await service.process({
    source: source(),
    content: {
      kind: "text",
      text: "facade text"
    }
  });

  assert.equal(result.normalizedText, "facade text");
  assert.equal(calls.length, 1);
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
