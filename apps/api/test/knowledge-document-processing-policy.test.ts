import assert from "node:assert/strict";
import {
  DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY,
  KnowledgeDocumentProcessingPolicyError,
  resolveKnowledgeDocumentProcessorEscalation,
  resolveKnowledgeDocumentProcessorSelection
} from "../src/modules/workspace-management/application/knowledge-document-processing-policy";
import {
  FUTURE_KNOWLEDGE_LIFECYCLE_GOVERNANCE_STATUSES,
  KNOWLEDGE_PROCESSING_STATUSES
} from "../src/modules/workspace-management/application/knowledge-processing.types";

const providerAvailability = {
  local: { enabled: true, configured: true },
  mistral: { enabled: true, configured: true },
  llamaparse: { enabled: true, configured: true }
};

async function run(): Promise<void> {
  assert.deepEqual(KNOWLEDGE_PROCESSING_STATUSES, [
    "processing",
    "ready",
    "failed",
    "needs_review"
  ]);
  assert.deepEqual(FUTURE_KNOWLEDGE_LIFECYCLE_GOVERNANCE_STATUSES, [
    "draft",
    "verified",
    "stale",
    "deprecated"
  ]);
  for (const lifecycleStatus of FUTURE_KNOWLEDGE_LIFECYCLE_GOVERNANCE_STATUSES) {
    assert.equal(KNOWLEDGE_PROCESSING_STATUSES.includes(lifecycleStatus as never), false);
  }

  assert.deepEqual(
    resolveKnowledgeDocumentProcessorSelection({
      content: {
        kind: "bytes",
        buffer: Buffer.from("hello"),
        mimeType: "text/plain",
        originalFilename: "notes.txt"
      },
      providerAvailability
    }),
    {
      processorMode: "local",
      providerKey: "local",
      fallbackProviderKey: null,
      reasonCode: "simple_text_local"
    }
  );

  assert.deepEqual(
    resolveKnowledgeDocumentProcessorSelection({
      content: {
        kind: "bytes",
        buffer: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        originalFilename: "contract.pdf"
      },
      providerAvailability
    }),
    {
      processorMode: "default_provider",
      providerKey: "mistral",
      fallbackProviderKey: "llamaparse",
      reasonCode: "complex_document_default_provider"
    }
  );

  assert.deepEqual(
    resolveKnowledgeDocumentProcessorSelection({
      content: {
        kind: "bytes",
        buffer: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        originalFilename: "contract.pdf"
      },
      requestedMode: "high_quality_fallback",
      providerAvailability
    }),
    {
      processorMode: "high_quality_fallback",
      providerKey: "llamaparse",
      fallbackProviderKey: null,
      reasonCode: "manual_high_quality"
    }
  );

  assert.deepEqual(
    resolveKnowledgeDocumentProcessorEscalation({
      previousSelection: {
        processorMode: "default_provider",
        providerKey: "mistral",
        fallbackProviderKey: "llamaparse",
        reasonCode: "complex_document_default_provider"
      },
      quality: {
        status: "needs_review",
        score: 0.4,
        reasonCodes: ["garbage_text_ratio_high"],
        textChars: 400
      },
      providerAvailability
    }),
    {
      processorMode: "high_quality_fallback",
      providerKey: "llamaparse",
      fallbackProviderKey: null,
      reasonCode: "poor_extraction_high_quality_fallback"
    }
  );

  assert.throws(
    () =>
      resolveKnowledgeDocumentProcessorSelection({
        content: {
          kind: "bytes",
          buffer: Buffer.from("%PDF"),
          mimeType: "application/pdf",
          originalFilename: "contract.pdf"
        },
        policy: {
          ...DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY,
          localFallbackEnabled: false,
          autoFallbackEnabled: false
        },
        providerAvailability: {
          local: { enabled: true, configured: true },
          mistral: { enabled: true, configured: false },
          llamaparse: { enabled: true, configured: false }
        }
      }),
    (error: unknown) =>
      error instanceof KnowledgeDocumentProcessingPolicyError &&
      error.code === "needs_key" &&
      error.providerKey === "mistral"
  );
}

void run();
