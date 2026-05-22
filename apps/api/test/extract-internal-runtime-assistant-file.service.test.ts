import assert from "node:assert/strict";
import { ExtractInternalRuntimeAssistantFileService } from "../src/modules/workspace-management/application/extract-internal-runtime-assistant-file.service";

async function run(): Promise<void> {
  let fileRecord = {
    fileRef: "file-1",
    displayName: "Project Spec.pdf",
    relativePath: "uploads/thread-1/Project Spec.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    objectKey: "assistant-media/uploads/thread-1/Project Spec.pdf",
    metadata: null as Record<string, unknown> | null
  };
  let findCalls = 0;
  let downloadCalls = 0;
  let updateCalls = 0;
  let extractCalls = 0;

  const assistantFileRegistryService = {
    async findAssistantFile() {
      findCalls += 1;
      return fileRecord;
    },
    async downloadAssistantFile() {
      downloadCalls += 1;
      return {
        file: fileRecord,
        buffer: Buffer.from("%PDF-1.7 cached extract"),
        contentType: "application/pdf"
      };
    },
    async updateInternalRuntimeExtractionCache(input: {
      cache: {
        text: string;
        markdown: string | null;
        note: string | null;
        provider: Record<string, unknown>;
        quality: string;
      };
    }) {
      updateCalls += 1;
      fileRecord = {
        ...fileRecord,
        metadata: {
          internalRuntimeFileExtractionCache: {
            schema: "persai.internalRuntimeFileExtractionCache.v1",
            cachedAt: "2026-05-22T18:30:00.000Z",
            text: input.cache.text,
            markdown: input.cache.markdown,
            note: input.cache.note,
            provider: input.cache.provider,
            quality: input.cache.quality
          }
        }
      };
      return fileRecord;
    }
  };

  const documentExtractionService = {
    async extract() {
      extractCalls += 1;
      return {
        normalizedText: "Deep extracted project specification text.",
        markdown: "# Project Spec",
        note: null,
        provider: {
          providerKey: "mistral",
          processorMode: "high_quality_fallback",
          attemptedProviderKeys: ["mistral"]
        },
        quality: {
          status: "ok",
          score: 0.98,
          reasonCodes: [],
          textChars: 42
        }
      };
    }
  };

  const service = new ExtractInternalRuntimeAssistantFileService(
    assistantFileRegistryService as never,
    documentExtractionService as never
  );

  const first = await service.execute({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    fileRef: "file-1"
  });
  assert.equal(first.extracted, true);
  if (first.extracted) {
    assert.equal(first.text, "Deep extracted project specification text.");
    assert.equal(first.markdown, "# Project Spec");
    assert.deepEqual(first.provider, {
      providerKey: "mistral",
      processorMode: "high_quality_fallback",
      attemptedProviderKeys: ["mistral"]
    });
    assert.deepEqual(first.quality, {
      status: "ok",
      score: 0.98,
      reasonCodes: [],
      textChars: 42
    });
  }
  assert.equal(findCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(extractCalls, 1);

  const second = await service.execute({
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    fileRef: "file-1"
  });
  assert.equal(second.extracted, true);
  if (second.extracted) {
    assert.equal(second.text, "Deep extracted project specification text.");
    assert.equal(second.markdown, "# Project Spec");
    assert.deepEqual(second.provider, {
      providerKey: "mistral",
      processorMode: "high_quality_fallback",
      attemptedProviderKeys: ["mistral"]
    });
    assert.deepEqual(second.quality, {
      status: "ok",
      score: 0.98,
      reasonCodes: [],
      textChars: 42
    });
  }
  assert.equal(findCalls, 2);
  assert.equal(downloadCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(extractCalls, 1);
}

void run();
