import assert from "node:assert/strict";
import { KnowledgeIndexingJobWorkerService } from "../src/modules/workspace-management/application/knowledge-indexing-job-worker.service";
import { KnowledgeIndexingError } from "../src/modules/workspace-management/application/knowledge-indexing.service";

type Row = Record<string, unknown> & { id: string };

function createHarness(options?: {
  sourceType?:
    | "assistant_knowledge_source"
    | "global_knowledge_source"
    | "skill_document"
    | "skill_knowledge_card"
    | "product_knowledge_text_entry";
  sourceVersion?: number;
  maxAttempts?: number;
  indexingFailure?: Error;
  qualityStatus?: "ok" | "needs_review";
  startInProgressExpired?: boolean;
  lifecycleStatus?: "draft" | "active" | "stale" | "archived";
}) {
  const now = new Date("2026-05-01T12:00:00.000Z");
  const sourceType = options?.sourceType ?? "assistant_knowledge_source";
  const sourceId = `${sourceType}-1`;
  const sourceVersion = options?.sourceVersion ?? 1;
  const assistantSources = new Map<string, Row>();
  const globalSources = new Map<string, Row>();
  const skillDocuments = new Map<string, Row>();
  const skillKnowledgeCards = new Map<string, Row>();
  const productTextEntries = new Map<string, Row>();
  const assistantChunks: Row[] = [];
  const globalChunks: Row[] = [];
  const skillChunks: Row[] = [];
  const skillCardChunks: Row[] = [];
  const productTextEntryChunks: Row[] = [];
  const jobs = new Map<string, Row>();
  const vectorReplaces: unknown[] = [];
  const vectorDeletes: Array<{ sourceType: string; sourceId: string }> = [];
  const processCalls: Array<{ sourceType: string; sourceId: string; processorMode: string }> = [];
  const ledgerCalls: Array<Record<string, unknown>> = [];

  const baseSource = {
    id: sourceId,
    workspaceId: "ws-1",
    originalFilename: "source.txt",
    mimeType: "text/plain",
    sizeBytes: BigInt(32),
    storagePath: `knowledge/${sourceId}.txt`,
    status: "processing",
    currentVersion: sourceVersion,
    chunkCount: 0,
    processorProviderKey: null,
    processorMode: null,
    processingQuality: null,
    lastIndexedAt: null,
    lastReindexRequestedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now
  };
  if (sourceType === "assistant_knowledge_source") {
    assistantSources.set(sourceId, {
      ...baseSource,
      assistantId: "assistant-1",
      userId: "user-1",
      namespace: "assistant_user_workspace",
      sourceKind: "uploaded_file",
      displayName: "Assistant source"
    });
  } else if (sourceType === "global_knowledge_source") {
    globalSources.set(sourceId, {
      ...baseSource,
      createdByUserId: "admin-1",
      scope: "product",
      displayName: "Product source"
    });
  } else if (sourceType === "skill_document") {
    skillDocuments.set(sourceId, {
      ...baseSource,
      skillId: "skill-1",
      createdByUserId: "admin-1",
      displayName: "Skill source",
      description: "Skill document"
    });
  } else if (sourceType === "skill_knowledge_card") {
    skillKnowledgeCards.set(sourceId, {
      ...baseSource,
      skillId: "skill-1",
      createdByUserId: "admin-1",
      title: "Skill card",
      body: "Skill card body",
      locale: "en",
      tags: [],
      lifecycleStatus: options?.lifecycleStatus ?? "active",
      provenanceKind: "manual",
      provenanceMetadata: null,
      archivedAt: null
    });
  } else {
    productTextEntries.set(sourceId, {
      ...baseSource,
      createdByUserId: "admin-1",
      title: "Product KB entry",
      body: "Product KB body",
      category: "billing",
      locale: "en",
      tags: [],
      lifecycleStatus: options?.lifecycleStatus ?? "active",
      provenanceKind: "manual",
      provenanceMetadata: null,
      archivedAt: null
    });
  }

  jobs.set("job-1", {
    id: "job-1",
    workspaceId: "ws-1",
    assistantId: sourceType === "assistant_knowledge_source" ? "assistant-1" : null,
    skillId:
      sourceType === "skill_document" || sourceType === "skill_knowledge_card" ? "skill-1" : null,
    requestedByUserId: sourceType === "assistant_knowledge_source" ? "user-1" : "admin-1",
    sourceType,
    sourceId,
    sourceVersion,
    status: options?.startInProgressExpired ? "in_progress" : "pending",
    processorMode: "auto",
    selectedProviderKey: null,
    fallbackProviderKey: null,
    priority: 100,
    pendingDedupeKey: `${sourceType}:${sourceId}:${sourceVersion}`,
    attemptCount: 0,
    maxAttempts: options?.maxAttempts ?? 3,
    retryAfterAt: null,
    schedulerClaimToken: options?.startInProgressExpired ? "old-token" : null,
    schedulerClaimEpoch: options?.startInProgressExpired ? 1 : null,
    schedulerClaimedAt: options?.startInProgressExpired
      ? new Date("2026-05-01T11:00:00.000Z")
      : null,
    schedulerClaimExpiresAt: options?.startInProgressExpired
      ? new Date("2026-05-01T11:05:00.000Z")
      : null,
    extractionQuality: null,
    resultPayload: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  });

  const tableForSource = () =>
    sourceType === "assistant_knowledge_source"
      ? assistantSources
      : sourceType === "global_knowledge_source"
        ? globalSources
        : sourceType === "skill_document"
          ? skillDocuments
          : sourceType === "skill_knowledge_card"
            ? skillKnowledgeCards
            : productTextEntries;

  const prisma = {
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
    $queryRaw: async () =>
      [...jobs.values()]
        .filter((job) => {
          if (job.status === "pending") {
            return job.retryAfterAt === null || (job.retryAfterAt as Date) <= new Date();
          }
          return (
            job.status === "in_progress" &&
            job.schedulerClaimExpiresAt instanceof Date &&
            job.schedulerClaimExpiresAt <= new Date()
          );
        })
        .map((job) => ({
          id: job.id,
          workspaceId: job.workspaceId,
          assistantId: job.assistantId,
          skillId: job.skillId,
          requestedByUserId: job.requestedByUserId,
          sourceType: job.sourceType,
          sourceId: job.sourceId,
          sourceVersion: job.sourceVersion,
          processorMode: job.processorMode,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          claimEpoch: job.schedulerClaimEpoch
        })),
    knowledgeIndexingJob: {
      create: async ({ data }: { data: Row }) => {
        jobs.set(data.id, data);
        return data;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const existing = jobs.get(where.id);
        assert.ok(existing);
        const next = { ...existing, ...data, updatedAt: now };
        jobs.set(where.id, next);
        return next;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const existing = jobs.get(where.id as string);
        if (
          !existing ||
          (where.schedulerClaimToken !== undefined &&
            existing.schedulerClaimToken !== where.schedulerClaimToken) ||
          (where.schedulerClaimEpoch !== undefined &&
            existing.schedulerClaimEpoch !== where.schedulerClaimEpoch)
        ) {
          return { count: 0 };
        }
        jobs.set(existing.id, { ...existing, ...data, updatedAt: now });
        return { count: 1 };
      }
    },
    assistantKnowledgeSource: sourceDelegate(assistantSources),
    globalKnowledgeSource: sourceDelegate(globalSources),
    skillDocument: sourceDelegate(skillDocuments),
    skillKnowledgeCard: sourceDelegate(skillKnowledgeCards),
    productKnowledgeTextEntry: sourceDelegate(productTextEntries),
    assistantKnowledgeSourceChunk: chunkDelegate(assistantChunks, "knowledgeSourceId"),
    globalKnowledgeSourceChunk: chunkDelegate(globalChunks, "globalKnowledgeSourceId"),
    skillDocumentChunk: chunkDelegate(skillChunks, "skillDocumentId"),
    skillKnowledgeCardChunk: chunkDelegate(skillCardChunks, "skillKnowledgeCardId"),
    productKnowledgeTextEntryChunk: chunkDelegate(productTextEntryChunks, "textEntryId"),
    knowledgeVectorChunk: {
      deleteMany: async () => undefined
    }
  };

  function sourceDelegate(rows: Map<string, Row>) {
    return {
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where, select }: { where: { id: string }; select?: Row }) => {
        const row = rows.get(where.id);
        assert.ok(row);
        if (!select) {
          return row;
        }
        return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = rows.get(where.id);
        assert.ok(row);
        const next = { ...row, ...data, updatedAt: now };
        rows.set(where.id, next);
        return next;
      }
    };
  }

  function chunkDelegate(rows: Row[], parentKey: string) {
    return {
      deleteMany: async ({ where }: { where: Row }) => {
        const sourceValue = where[parentKey];
        for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
          if (rows[idx]?.[parentKey] === sourceValue) {
            rows.splice(idx, 1);
          }
        }
      },
      createMany: async ({ data }: { data: Row[] }) => {
        rows.push(...data.map((row, index) => ({ id: `${parentKey}-chunk-${index}`, ...row })));
      }
    };
  }

  const service = new KnowledgeIndexingJobWorkerService(
    prisma as never,
    {
      downloadObject: async () => ({
        buffer: Buffer.from("Indexable knowledge text"),
        contentType: "text/plain"
      })
    } as never,
    {
      buildIndexedChunksForSource: async ({
        source,
        processorMode,
        embeddingModelKey
      }: {
        source: { sourceType: string; sourceId: string };
        processorMode: string;
        embeddingModelKey?: string | null;
      }) => {
        if (options?.indexingFailure) {
          throw options.indexingFailure;
        }
        processCalls.push({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          processorMode
        });
        const quality = {
          status: options?.qualityStatus ?? "ok",
          score: options?.qualityStatus === "needs_review" ? 0.4 : 0.9,
          reasonCodes: options?.qualityStatus === "needs_review" ? ["garbage_text_ratio_high"] : [],
          textChars: 24
        };
        return {
          chunks: [
            {
              chunkIndex: 0,
              locator: "p1",
              content: "Indexable knowledge text",
              embeddingModelKey: embeddingModelKey ?? null,
              embeddingVector: embeddingModelKey === null ? null : [0.1, 0.2],
              embeddingGeneratedAt: embeddingModelKey === null ? null : now,
              metadata: { sourceType: source.sourceType },
              provider: {
                providerKey: "local",
                processorMode: "auto",
                attemptedProviderKeys: ["local"]
              },
              quality
            }
          ],
          embeddingUsage:
            embeddingModelKey === null
              ? null
              : {
                  providerKey: "openai",
                  modelKey: embeddingModelKey,
                  inputTokens: 42,
                  totalTokens: 42
                }
        };
      }
    } as never,
    {
      resolveAssistantEmbeddingModelKey: async () => "text-embedding-3-small",
      resolveAdminKnowledgeEmbeddingModelKey: async () => "text-embedding-3-small"
    } as never,
    {
      replaceSourceChunks: async (input: unknown) => {
        vectorReplaces.push(input);
      },
      deleteSource: async (input: { sourceType: string; sourceId: string }) => {
        vectorDeletes.push(input);
      },
      searchNearest: async () => []
    } as never,
    {
      async recordKnowledgeIndexingEmbeddingEvent(input: Record<string, unknown>) {
        ledgerCalls.push(input);
        return 1;
      }
    } as never
  );

  return {
    service,
    ledgerCalls,
    jobs,
    source: () => tableForSource().get(sourceId),
    assistantChunks,
    globalChunks,
    skillChunks,
    skillCardChunks,
    productTextEntryChunks,
    vectorReplaces,
    vectorDeletes,
    processCalls
  };
}

async function runSuccessfulAssistantJob(): Promise<void> {
  const harness = createHarness();
  const count = await harness.service.processDueIndexingJobsBatch(1);
  assert.equal(count, 1);
  assert.equal(harness.jobs.get("job-1")?.status, "completed");
  assert.equal(harness.jobs.get("job-1")?.attemptCount, 1);
  assert.equal(harness.jobs.get("job-1")?.schedulerClaimToken, null);
  assert.equal(harness.source()?.status, "ready");
  assert.equal(harness.source()?.chunkCount, 1);
  assert.equal(harness.assistantChunks.length, 1);
  assert.equal(harness.vectorReplaces.length, 1);
  assert.equal(harness.ledgerCalls.length, 1);
  assert.equal(harness.ledgerCalls[0]?.modelKey, "text-embedding-3-small");
  assert.equal(harness.ledgerCalls[0]?.workspaceId, "ws-1");
  assert.equal(harness.ledgerCalls[0]?.sourceEventId, "knowledge_indexing_job:job-1");
  assert.equal(harness.ledgerCalls[0]?.inputTokens, 42);
}

async function runFailureRetryAndExhaustion(): Promise<void> {
  const retryHarness = createHarness({ indexingFailure: new Error("provider timeout") });
  await retryHarness.service.processDueIndexingJobsBatch(1);
  assert.equal(retryHarness.jobs.get("job-1")?.status, "pending");
  assert.equal(retryHarness.jobs.get("job-1")?.attemptCount, 1);
  assert.ok(retryHarness.jobs.get("job-1")?.retryAfterAt instanceof Date);

  const exhaustedHarness = createHarness({
    indexingFailure: new Error("provider timeout"),
    maxAttempts: 1
  });
  await exhaustedHarness.service.processDueIndexingJobsBatch(1);
  assert.equal(exhaustedHarness.jobs.get("job-1")?.status, "failed");
  assert.equal(exhaustedHarness.source()?.status, "failed");
  assert.equal(exhaustedHarness.source()?.lastErrorCode, "indexing_failed");

  const providerFailureHarness = createHarness({
    indexingFailure: new KnowledgeIndexingError(
      "text_extract_unavailable",
      "No searchable text could be extracted.",
      {
        providerKey: "mistral",
        processorMode: "default_provider",
        attemptedProviderKeys: ["mistral", "llamaparse"]
      },
      {
        status: "poor",
        score: 0,
        reasonCodes: ["empty_text_extract"],
        textChars: 0
      }
    ),
    maxAttempts: 1
  });
  await providerFailureHarness.service.processDueIndexingJobsBatch(1);
  assert.equal(providerFailureHarness.jobs.get("job-1")?.selectedProviderKey, "mistral");
  assert.equal(providerFailureHarness.source()?.processorProviderKey, "mistral");
}

async function runNeedsReviewGate(): Promise<void> {
  const harness = createHarness({ qualityStatus: "needs_review" });
  await harness.service.processDueIndexingJobsBatch(1);
  assert.equal(harness.jobs.get("job-1")?.status, "needs_review");
  assert.equal(harness.source()?.status, "needs_review");
  assert.equal(harness.assistantChunks.length, 0);
  assert.equal(harness.vectorReplaces.length, 0);
  assert.deepEqual(harness.vectorDeletes, [
    { sourceType: "assistant_knowledge_source", sourceId: "assistant_knowledge_source-1" }
  ]);
}

async function runSkillDocumentProcessing(): Promise<void> {
  const harness = createHarness({ sourceType: "skill_document" });
  await harness.service.processDueIndexingJobsBatch(1);
  assert.equal(harness.jobs.get("job-1")?.status, "completed");
  assert.equal(harness.source()?.status, "ready");
  assert.equal(harness.skillChunks.length, 1);
  assert.equal(harness.skillChunks[0]?.embeddingModelKey, "text-embedding-3-small");
  assert.equal(harness.vectorReplaces.length, 1);
  assert.equal(harness.source()?.processorProviderKey, "local");
}

async function runAuthoredKnowledgeEntryProcessing(): Promise<void> {
  const skillCardHarness = createHarness({ sourceType: "skill_knowledge_card" });
  await skillCardHarness.service.processDueIndexingJobsBatch(1);
  assert.equal(skillCardHarness.jobs.get("job-1")?.status, "completed");
  assert.equal(skillCardHarness.source()?.status, "ready");
  assert.equal(skillCardHarness.skillCardChunks.length, 1);
  assert.equal(skillCardHarness.vectorReplaces.length, 1);

  const productEntryHarness = createHarness({ sourceType: "product_knowledge_text_entry" });
  await productEntryHarness.service.processDueIndexingJobsBatch(1);
  assert.equal(productEntryHarness.jobs.get("job-1")?.status, "completed");
  assert.equal(productEntryHarness.source()?.status, "ready");
  assert.equal(productEntryHarness.productTextEntryChunks.length, 1);
  assert.equal(productEntryHarness.vectorReplaces.length, 1);

  const draftHarness = createHarness({
    sourceType: "skill_knowledge_card",
    lifecycleStatus: "draft",
    maxAttempts: 1
  });
  await draftHarness.service.processDueIndexingJobsBatch(1);
  assert.equal(draftHarness.jobs.get("job-1")?.status, "failed");
  assert.equal(draftHarness.source()?.status, "failed");
  assert.equal(draftHarness.skillCardChunks.length, 0);
  assert.deepEqual(draftHarness.vectorDeletes, [
    { sourceType: "skill_knowledge_card", sourceId: "skill_knowledge_card-1" }
  ]);
}

async function runExpiredClaimIsReclaimed(): Promise<void> {
  const harness = createHarness({ startInProgressExpired: true });
  await harness.service.processDueIndexingJobsBatch(1);
  assert.equal(harness.jobs.get("job-1")?.status, "completed");
  assert.equal(harness.jobs.get("job-1")?.attemptCount, 1);
  assert.equal(harness.processCalls.length, 1);
}

async function main(): Promise<void> {
  await runSuccessfulAssistantJob();
  await runFailureRetryAndExhaustion();
  await runNeedsReviewGate();
  await runSkillDocumentProcessing();
  await runAuthoredKnowledgeEntryProcessing();
  await runExpiredClaimIsReclaimed();
}

void main();
