import assert from "node:assert/strict";
import {
  buildKnowledgeVectorIndexMetadata,
  serializePgvector
} from "../src/modules/workspace-management/application/knowledge-vector-index";

async function run(): Promise<void> {
  assert.equal(serializePgvector([0.1, -0.2, 3]), "[0.1,-0.2,3]");
  assert.throws(() => serializePgvector([]), /at least one dimension/);
  assert.throws(() => serializePgvector([Number.NaN]), /non-finite/);

  const metadata = buildKnowledgeVectorIndexMetadata({
    sourceType: "skill_document",
    sourceId: "source-1",
    sourceVersion: 3,
    workspaceId: null,
    skillId: "skill-1",
    assistantId: null,
    chunkId: "chunk-1",
    chunkIndex: 0,
    locator: "page:1",
    content: "Indexed text",
    provenance: {
      originKind: "skill_document",
      title: "Tax Guide",
      originalFilename: "tax-guide.pdf",
      mimeType: "application/pdf",
      createdByUserId: "admin-1",
      metadata: {
        sourceSystem: "admin-upload"
      }
    },
    metadata: {
      displayName: "Tax Guide",
      section: "intro"
    },
    provider: {
      providerKey: "llamaparse",
      processorMode: "high_quality_fallback",
      attemptedProviderKeys: ["mistral", "llamaparse"]
    },
    quality: {
      status: "ok",
      score: 0.92,
      reasonCodes: [],
      textChars: 1200
    }
  });

  assert.deepEqual(metadata, {
    sourceType: "skill_document",
    sourceId: "source-1",
    sourceVersion: 3,
    provenance: {
      originKind: "skill_document",
      title: "Tax Guide",
      originalFilename: "tax-guide.pdf",
      mimeType: "application/pdf",
      createdByUserId: "admin-1",
      metadata: {
        sourceSystem: "admin-upload"
      }
    },
    chunkMetadata: {
      displayName: "Tax Guide",
      section: "intro"
    },
    provider: {
      providerKey: "llamaparse",
      processorMode: "high_quality_fallback",
      attemptedProviderKeys: ["mistral", "llamaparse"]
    },
    quality: {
      status: "ok",
      score: 0.92,
      reasonCodes: [],
      textChars: 1200
    }
  });
  assert.equal(Object.hasOwn(metadata, "lifecycleStatus"), false);
}

void run();
