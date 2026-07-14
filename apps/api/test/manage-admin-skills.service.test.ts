import assert from "node:assert/strict";
import { ManageAdminSkillsService } from "../src/modules/workspace-management/application/manage-admin-skills.service";

type MockRow = Record<string, unknown> & {
  id: string;
  workspaceId?: string;
  skillId?: string;
  sourceType?: string;
  sourceId?: string;
  documents?: MockRow[];
};

function createHarness(activeRoleLink = false) {
  const now = new Date("2026-05-01T12:00:00.000Z");
  const skills = new Map<string, MockRow>();
  const documents = new Map<string, MockRow>();
  const cards = new Map<string, MockRow>();
  const jobs = new Map<string, MockRow>();
  const assignments: Array<{
    assistantId: string;
    skillId: string;
    status: string;
    archivedAt: Date | null;
    skillStatus: string;
  }> = [];
  const vectorDeletes: Array<{ sourceType: string; sourceId: string }> = [];
  const assistantChatUpdates: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  const deletedObjects: string[] = [];
  let nextSkill = 1;
  let nextDocument = 1;
  let nextCard = 1;
  let nextJob = 1;

  const tx = {
    $queryRaw: async <T>(query: { strings?: readonly string[] }): Promise<T> => {
      const sql = (query.strings ?? []).join("?").replace(/\s+/g, " ");
      if (sql.includes('FROM "assistant_roles"') && activeRoleLink) {
        return [{ id: "role-active", key: "active", status: "active" }] as T;
      }
      return [] as T;
    },
    assistantRole: {
      findMany: async () => (activeRoleLink ? [{ id: "role-active" }] : [])
    },
    skill: {
      findUnique: async ({ where }: { where: { id: string } }) => skills.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const skill = skills.get(where.id);
        const next = { ...skill, ...data, updatedAt: now };
        skills.set(where.id, next);
        return {
          ...next,
          documents: [...documents.values()].filter((doc) => doc.skillId === where.id),
          knowledgeCards: [...cards.values()].filter((card) => card.skillId === where.id)
        };
      }
    },
    assistantRoleSkill: {
      findFirst: async () => (activeRoleLink ? { roleId: "role-active" } : null)
    },
    skillDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const document = {
          id: `document-${nextDocument++}`,
          ...data,
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
        documents.set(document.id, document);
        return document;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const document = documents.get(where.id);
        const next = { ...document, ...data, updatedAt: now };
        documents.set(where.id, next);
        return next;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const document = documents.get(where.id);
        documents.delete(where.id);
        return document;
      }
    },
    skillKnowledgeCard: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const card = {
          id: `card-${nextCard++}`,
          ...data,
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
        cards.set(card.id, card);
        return card;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const card = cards.get(where.id);
        const next = { ...card, ...data, updatedAt: now };
        cards.set(where.id, next);
        return next;
      }
    },
    skillKnowledgeCardChunk: {
      deleteMany: async ({ where }: { where: { skillKnowledgeCardId: string } }) => {
        void where;
      }
    },
    knowledgeIndexingJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const job = {
          id: `job-${nextJob++}`,
          ...data,
          selectedProviderKey: null,
          fallbackProviderKey: null,
          priority: 100,
          attemptCount: 0,
          maxAttempts: 3,
          retryAfterAt: null,
          schedulerClaimToken: null,
          schedulerClaimEpoch: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          extractionQuality: null,
          resultPayload: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now
        };
        jobs.set(job.id, job);
        return job;
      },
      deleteMany: async ({ where }: { where: { sourceType: string; sourceId: string } }) => {
        for (const [id, job] of jobs) {
          if (job.sourceType === where.sourceType && job.sourceId === where.sourceId) {
            jobs.delete(id);
          }
        }
      }
    },
    knowledgeVectorChunk: {
      deleteMany: async ({ where }: { where: { sourceType: string; sourceId: string } }) => {
        vectorDeletes.push(where);
      }
    }
  };

  const prisma = {
    skill: {
      findMany: async () =>
        [...skills.values()].map((skill) => ({
          ...skill,
          documents: [...documents.values()].filter((document) => document.skillId === skill.id),
          knowledgeCards: [...cards.values()].filter((card) => card.skillId === skill.id)
        })),
      findFirst: async ({ where }: { where: { id: string } }) => {
        const skill = skills.get(where.id);
        return skill ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const skill = {
          id: `skill-${nextSkill++}`,
          ...data,
          documents: [],
          createdAt: now,
          updatedAt: now
        };
        skills.set(skill.id, skill);
        return skill;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const skill = skills.get(where.id);
        const next = { ...skill, ...data, updatedAt: now };
        skills.set(where.id, next);
        return {
          ...next,
          documents: [...documents.values()].filter((doc) => doc.skillId === where.id)
        };
      }
    },
    skillDocument: {
      findFirst: async ({ where }: { where: { id: string; skillId: string } }) => {
        const document = documents.get(where.id);
        return document && document.skillId === where.skillId ? document : null;
      },
      delete: tx.skillDocument.delete
    },
    skillKnowledgeCard: {
      findFirst: async ({ where }: { where: { id: string; skillId: string } }) => {
        const card = cards.get(where.id);
        return card && card.skillId === where.skillId ? card : null;
      }
    },
    knowledgeIndexingJob: {
      deleteMany: tx.knowledgeIndexingJob.deleteMany
    },
    assistantSkillAssignment: {
      updateMany: async ({
        where,
        data
      }: {
        where: { skillId?: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const assignment of assignments) {
          if (
            (where.skillId === undefined || assignment.skillId === where.skillId) &&
            (where.status === undefined || assignment.status === where.status)
          ) {
            Object.assign(assignment, data);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async ({ where }: { where: { skillId: string } }) =>
        assignments
          .filter((assignment) => assignment.skillId === where.skillId)
          .map((assignment) => ({ assistantId: assignment.assistantId })),
      groupBy: async ({
        where
      }: {
        where: {
          assistantId: { in: string[] };
          status: string;
          skill: { status: string; archivedAt: null };
        };
      }) =>
        where.assistantId.in
          .map((assistantId) => ({
            assistantId,
            _count: {
              assistantId: assignments.filter(
                (assignment) =>
                  assignment.assistantId === assistantId &&
                  assignment.status === where.status &&
                  assignment.skillStatus === where.skill.status &&
                  assignment.archivedAt === where.skill.archivedAt
              ).length
            }
          }))
          .filter((row) => row._count.assistantId > 0)
    },
    assistant: {
      updateMany: async () => ({ count: 0 }),
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const idFilter = where.id as { in?: string[] } | undefined;
        if (idFilter?.in !== undefined) {
          return assignments
            .filter(
              (assignment) =>
                idFilter.in?.includes(assignment.assistantId) === true &&
                assignment.skillStatus === "active" &&
                assignment.archivedAt === null
            )
            .map((assignment) => ({ id: assignment.assistantId }));
        }
        const role = where.role as { skillLinks?: { some?: { skillId?: string } } } | undefined;
        const skillId = role?.skillLinks?.some?.skillId;
        return assignments
          .filter((assignment) => assignment.skillId === skillId)
          .map((assignment) => ({ id: assignment.assistantId }));
      }
    },
    assistantChat: {
      updateMany: async ({
        where,
        data
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        assistantChatUpdates.push({ where, data });
        return { count: 1 };
      }
    },
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx)
  };

  const service = new ManageAdminSkillsService(
    {
      assertCanReadAdminSurface: async () => ({ userId: "admin-1", workspaceId: "ws-1" }),
      assertCanWriteGlobalKnowledge: async () => ({ userId: "admin-1", workspaceId: "ws-1" })
    } as never,
    prisma as never,
    {
      buildSkillDocumentObjectKey: ({
        skillId,
        originalFilename
      }: {
        skillId: string;
        originalFilename: string;
      }) => `knowledge/skills/${skillId}/${originalFilename}`,
      saveObject: async ({
        objectKey,
        buffer,
        mimeType
      }: {
        objectKey: string;
        buffer: Buffer;
        mimeType: string;
      }) => ({
        objectKey,
        sizeBytes: buffer.length,
        mimeType
      }),
      deleteObject: async (objectKey: string) => {
        deletedObjects.push(objectKey);
      }
    } as never
  );

  return {
    service,
    documents,
    cards,
    jobs,
    assignments,
    assistantChatUpdates,
    deletedObjects,
    vectorDeletes
  };
}

const skillInput = {
  name: { en: "Accountant", ru: "Бухгалтер" },
  description: { en: "Accounting support" },
  category: "finance",
  tags: ["tax", "books"],
  instructionCard: {
    title: "Accounting mode",
    body: "Use accounting knowledge carefully.",
    guardrails: ["No legal guarantees"],
    examples: ["Explain tax categories"]
  },
  iconEmoji: "A",
  color: "blue",
  displayOrder: 10,
  status: "active" as const
};

async function run(): Promise<void> {
  const harness = createHarness();
  const created = await harness.service.create("admin-1", skillInput);
  assert.equal(created.status, "active");
  assert.equal(created.name.en, "Accountant");
  harness.assignments.push({
    assistantId: "assistant-1",
    skillId: created.id,
    status: "active",
    archivedAt: null,
    skillStatus: "active"
  });

  const upload = await harness.service.uploadDocument({
    userId: "admin-1",
    skillId: created.id,
    input: { displayName: "Tax notes", description: "Short guide" },
    file: {
      buffer: Buffer.from("skill knowledge"),
      mimetype: "text/plain",
      originalname: "tax-notes.txt"
    }
  });
  assert.equal(upload.document.status, "processing");
  assert.equal(upload.indexingJob.sourceType, "skill_document");
  assert.equal(upload.indexingJob.sourceId, upload.document.id);
  assert.equal(upload.indexingJob.status, "pending");
  assert.equal(harness.jobs.get(upload.indexingJob.id)?.workspaceId, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.assistantChatUpdates.at(-1)?.data ?? {},
      "skillRetrievalState"
    ),
    true
  );

  const reindexed = await harness.service.reindexDocument(
    "admin-1",
    created.id,
    upload.document.id
  );
  assert.equal(reindexed.document.currentVersion, 2);
  assert.equal(reindexed.indexingJob.sourceVersion, 2);

  const draftCard = await harness.service.createKnowledgeCard("admin-1", created.id, {
    title: "Draft card",
    body: "Draft knowledge that is not runtime eligible.",
    locale: "en",
    tags: ["draft"],
    lifecycleStatus: "draft",
    provenanceKind: "manual",
    provenanceMetadata: null
  });
  assert.equal(draftCard.card.lifecycleStatus, "draft");
  assert.equal(draftCard.indexingJob, null);

  const activeCard = await harness.service.updateKnowledgeCard(
    "admin-1",
    created.id,
    draftCard.card.id,
    {
      title: "Active card",
      body: "Active knowledge that is runtime eligible.",
      locale: "en",
      tags: ["active"],
      lifecycleStatus: "active",
      provenanceKind: "manual",
      provenanceMetadata: null
    }
  );
  assert.equal(activeCard.card.lifecycleStatus, "active");
  assert.equal(activeCard.indexingJob?.sourceType, "skill_knowledge_card");
  assert.equal(harness.jobs.get(activeCard.indexingJob?.id ?? "")?.workspaceId, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.assistantChatUpdates.at(-1)?.data ?? {},
      "skillDecisionState"
    ),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.assistantChatUpdates.at(-1)?.data ?? {},
      "skillRetrievalState"
    ),
    true
  );

  await harness.service.archiveKnowledgeCard("admin-1", created.id, draftCard.card.id);
  assert.equal(harness.cards.get(draftCard.card.id)?.lifecycleStatus, "archived");
  assert.deepEqual(harness.vectorDeletes.at(-1), {
    sourceType: "skill_knowledge_card",
    sourceId: draftCard.card.id
  });

  await harness.service.deleteDocument("admin-1", created.id, upload.document.id);
  assert.equal(harness.documents.has(upload.document.id), false);
  assert.equal(harness.deletedObjects.length, 1);
  assert.deepEqual(harness.vectorDeletes, [
    { sourceType: "skill_knowledge_card", sourceId: draftCard.card.id },
    { sourceType: "skill_document", sourceId: upload.document.id }
  ]);

  const linkedHarness = createHarness(true);
  const linkedSkill = await linkedHarness.service.create("admin-1", skillInput);
  await assert.rejects(
    () => linkedHarness.service.archive("admin-1", linkedSkill.id),
    /linked to an active Assistant Role/
  );
}

void run();
