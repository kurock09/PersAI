import assert from "node:assert/strict";
import { ManageAdminKnowledgeRetrievalPolicyService } from "../src/modules/workspace-management/application/manage-admin-knowledge-retrieval-policy.service";

type Row = Record<string, unknown>;

function createHarness(options?: { embeddingModelKey?: string | null }) {
  const updates: Array<{ table: string; where: Row; data: Row }> = [];
  const jobs: Row[] = [];
  const audits: Row[] = [];
  const rolloutRequests: Row[] = [];
  const rawResponses = [
    [
      {
        id: "global-source-1",
        workspaceId: "workspace-1",
        currentVersion: 3
      }
    ],
    [
      {
        id: "skill-document-1",
        workspaceId: "workspace-1",
        skillId: "skill-1",
        currentVersion: 5
      }
    ]
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
      })
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

  return { service, updates, jobs, audits, rolloutRequests };
}

async function runPolicyBackfill(): Promise<void> {
  const harness = createHarness();
  const result = await harness.service.updatePolicy("admin-1", {
    embeddingModelKey: "text-embedding-3-small",
    retrievalModelKey: "gpt-4.1-mini"
  });

  assert.equal(result.configGeneration, 42);
  assert.equal(result.policy.embeddingModelKey, "text-embedding-3-small");
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
    productSourceCount: 1,
    skillDocumentCount: 1
  });
}

async function runNullPolicyDoesNotBackfill(): Promise<void> {
  const harness = createHarness();
  await harness.service.updatePolicy("admin-1", {
    embeddingModelKey: null,
    retrievalModelKey: null
  });
  assert.equal(harness.updates.length, 0);
  assert.equal(harness.jobs.length, 0);
  assert.equal(harness.rolloutRequests.length, 1);
}

async function main(): Promise<void> {
  await runPolicyBackfill();
  await runNullPolicyDoesNotBackfill();
}

void main();
