import assert from "node:assert/strict";
import { ManageAdminKnowledgeRetrievalPolicyService } from "../src/modules/workspace-management/application/manage-admin-knowledge-retrieval-policy.service";

type Row = Record<string, unknown>;

function createHarness(options?: {
  embeddingModelKey?: string | null;
  alreadyIndexedCount?: number;
}) {
  const updates: Array<{ table: string; where: Row; data: Row }> = [];
  const jobs: Row[] = [];
  const audits: Row[] = [];
  const rolloutRequests: Row[] = [];
  const dangerousActions: Row[] = [];
  const rawResponses = [
    [
      {
        id: "global-source-1",
        workspaceId: null,
        currentVersion: 3,
        chunkCount: 4,
        sizeBytes: 1200
      }
    ],
    [],
    [
      {
        id: "skill-document-1",
        workspaceId: "workspace-1",
        skillId: "skill-1",
        currentVersion: 5,
        chunkCount: 6,
        sizeBytes: 2400
      }
    ],
    [],
    [],
    [{ count: String(options?.alreadyIndexedCount ?? 3) }]
  ];

  const prisma = {
    $queryRaw: async () => rawResponses.shift() ?? [],
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
    platformRuntimeProviderSettings: {
      upsert: async () => ({}),
      findUnique: async () => ({
        adminKnowledgeRetrievalPolicy: {
          embeddingModelKey: options?.embeddingModelKey ?? null,
          retrievalModelKey: null
        }
      })
    },
    globalKnowledgeSource: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        updates.push({ table: "globalKnowledgeSource", where, data });
        return { count: 1 };
      }
    },
    skillDocument: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        updates.push({ table: "skillDocument", where, data });
        return { count: 1 };
      }
    },
    knowledgeIndexingJob: {
      create: async ({ data }: { data: Row }) => {
        jobs.push(data);
        return data;
      }
    }
  };

  const service = new ManageAdminKnowledgeRetrievalPolicyService(
    prisma as never,
    {
      assertCanReadAdminSurface: async () => ({ userId: "admin-1", workspaceId: "workspace-1" }),
      assertCanWriteGlobalKnowledge: async () => ({
        userId: "admin-1",
        workspaceId: "workspace-1"
      }),
      assertCanPerformDangerousAdminAction: async () => {
        dangerousActions.push({ userId: "admin-1" });
        return {
          userId: "admin-1",
          workspaceId: "workspace-1"
        };
      }
    } as never,
    { execute: async () => 42 } as never,
    {
      execute: async (input: Row) => {
        audits.push(input);
      }
    } as never,
    {
      createAutomaticGlobalRollout: async (input: Row) => {
        rolloutRequests.push(input);
      }
    } as never
  );

  return { service, updates, jobs, audits, rolloutRequests, dangerousActions };
}

async function runPolicyBackfill(): Promise<void> {
  const harness = createHarness();
  const result = await harness.service.updatePolicy(
    "admin-1",
    {
      embeddingModelKey: "text-embedding-3-small",
      retrievalModelKey: "gpt-4.1-mini"
    },
    "step-up-token"
  );

  assert.equal(result.configGeneration, 42);
  assert.equal(result.policy.embeddingModelKey, "text-embedding-3-small");
  assert.equal(result.policy.embeddingChangeImpact?.affectedSourceCount, 2);
  assert.equal(result.policy.embeddingChangeImpact?.alreadyIndexedSourceCount, 3);
  assert.equal("candidates" in (result.policy.embeddingChangeImpact?.sources[0] ?? {}), false);
  assert.equal(harness.dangerousActions.length, 1);
  assert.deepEqual(harness.rolloutRequests, [
    {
      actorUserId: "admin-1",
      workspaceId: "workspace-1",
      rolloutType: "system_prompt_change",
      triggerSource: "prompt_settings",
      scopeType: "affected_policy",
      criticality: "soft",
      targetGeneration: 42,
      scopeMetadata: {
        reason: "admin.knowledge_retrieval_policy.update",
        embeddingModelKey: "text-embedding-3-small",
        retrievalModelKey: "gpt-4.1-mini",
        authoringModelKey: undefined
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a knowledge retrieval policy materialization rollout."
    }
  ]);
  assert.deepEqual(
    harness.updates.map((update) => [update.table, update.data.status, update.data.currentVersion]),
    [
      ["globalKnowledgeSource", "processing", 4],
      ["skillDocument", "processing", 6]
    ]
  );
  assert.deepEqual(
    harness.jobs.map((job) => [
      job.sourceType,
      job.sourceId,
      job.sourceVersion,
      job.skillId ?? null,
      job.pendingDedupeKey
    ]),
    [
      [
        "global_knowledge_source",
        "global-source-1",
        4,
        null,
        "global_knowledge_source:global-source-1:4"
      ],
      ["skill_document", "skill-document-1", 6, "skill-1", "skill_document:skill-document-1:6"]
    ]
  );
  assert.deepEqual((harness.audits[0]?.details as Row).embeddingBackfill, {
    alreadyIndexedSourceCount: 3,
    affectedSourceCount: 2,
    affectedChunkCount: 10,
    affectedBytes: 3600,
    bySource: [
      {
        sourceType: "global_knowledge_source",
        affectedSourceCount: 1,
        totalChunks: 4,
        totalBytes: 1200
      },
      {
        sourceType: "skill_document",
        affectedSourceCount: 1,
        totalChunks: 6,
        totalBytes: 2400
      }
    ]
  });
}

async function runNullPolicyDoesNotBackfill(): Promise<void> {
  const harness = createHarness();
  await harness.service.updatePolicy(
    "admin-1",
    {
      embeddingModelKey: null,
      retrievalModelKey: null
    },
    "step-up-token"
  );
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.jobs.length, 0);
  assert.equal(harness.rolloutRequests.length, 1);
}

async function runGetPolicyDoesNotFabricateDisableImpact(): Promise<void> {
  const harness = createHarness({ embeddingModelKey: "text-embedding-3-small" });
  const policy = await harness.service.getPolicy("admin-1");
  assert.equal(policy.embeddingModelKey, "text-embedding-3-small");
  assert.equal(policy.embeddingChangeImpact, null);
  assert.equal(harness.jobs.length, 0);
  assert.equal(harness.dangerousActions.length, 0);
}

async function runPreviewShowsProposedImpact(): Promise<void> {
  const harness = createHarness({ embeddingModelKey: "text-embedding-3-small" });
  const impact = await harness.service.previewEmbeddingChange("admin-1", {
    embeddingModelKey: "text-embedding-3-large"
  });
  assert.equal(impact.fromEmbeddingModelKey, "text-embedding-3-small");
  assert.equal(impact.toEmbeddingModelKey, "text-embedding-3-large");
  assert.equal(impact.requiresDangerousConfirmation, true);
  assert.equal(impact.affectedSourceCount, 2);
  assert.equal(impact.alreadyIndexedSourceCount, 3);
  assert.equal("candidates" in (impact.sources[0] ?? {}), false);
  assert.equal(JSON.stringify(impact).includes("global-source-1"), false);
  assert.equal(JSON.stringify(impact).includes("workspace-1"), false);
  assert.equal(harness.jobs.length, 0);
  assert.equal(harness.dangerousActions.length, 0);
}

async function runSameModelSaveDoesNotRequireDangerousConfirmation(): Promise<void> {
  const harness = createHarness({ embeddingModelKey: "text-embedding-3-small" });
  const result = await harness.service.updatePolicy(
    "admin-1",
    {
      embeddingModelKey: "text-embedding-3-small",
      retrievalModelKey: "gpt-4.1-mini"
    },
    null
  );
  assert.equal(result.policy.embeddingChangeImpact, null);
  assert.equal(harness.dangerousActions.length, 0);
  assert.equal(harness.jobs.length, 0);
}

async function main(): Promise<void> {
  await runGetPolicyDoesNotFabricateDisableImpact();
  await runPreviewShowsProposedImpact();
  await runPolicyBackfill();
  await runNullPolicyDoesNotBackfill();
  await runSameModelSaveDoesNotRequireDangerousConfirmation();
}

void main();
