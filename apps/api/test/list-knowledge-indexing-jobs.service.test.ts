import assert from "node:assert/strict";
import test from "node:test";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import { ListKnowledgeIndexingJobsService } from "../src/modules/workspace-management/application/list-knowledge-indexing-jobs.service";
import type { ResolveActiveAssistantService } from "../src/modules/workspace-management/application/resolve-active-assistant.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

const createdAt = new Date("2026-07-14T15:00:00.000Z");
const updatedAt = new Date("2026-07-14T15:01:00.000Z");

function jobRow(id: string) {
  return {
    id,
    workspaceId: "workspace-a",
    assistantId: "assistant-a",
    skillId: null,
    requestedByUserId: null,
    sourceType: "assistant_knowledge_source" as const,
    sourceId: "source-a",
    sourceVersion: 1,
    status: "completed" as const,
    processorMode: "auto" as const,
    selectedProviderKey: null,
    fallbackProviderKey: null,
    priority: 100,
    pendingDedupeKey: null,
    attemptCount: 1,
    maxAttempts: 3,
    retryAfterAt: null,
    schedulerClaimToken: null,
    schedulerClaimEpoch: null,
    schedulerClaimedAt: null,
    schedulerClaimExpiresAt: null,
    extractionQuality: { quality: "ok" },
    resultPayload: { indexed: true },
    lastErrorCode: null,
    lastErrorMessage: null,
    startedAt: createdAt,
    completedAt: updatedAt,
    createdAt,
    updatedAt
  };
}

type ActiveTuple = {
  assistantId: string;
  workspaceId: string;
  roleId: string;
};

function createHarness(activeTuples: ActiveTuple[], rows = [jobRow("job-a")]) {
  const resolverCalls: Array<{ userId: string }> = [];
  const findManyInputs: unknown[] = [];
  const adminCalls: string[] = [];
  let activeIndex = 0;

  const service = new ListKnowledgeIndexingJobsService(
    {
      async assertCanReadAdminSurface(userId: string) {
        adminCalls.push(userId);
      }
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService,
    {
      knowledgeIndexingJob: {
        async findMany(input: unknown) {
          findManyInputs.push(input);
          return rows;
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async execute(input: { userId: string }) {
        resolverCalls.push(input);
        const tuple = activeTuples[activeIndex];
        assert.ok(tuple, "active Assistant fixture must exist");
        activeIndex += 1;
        return {
          userId: input.userId,
          workspaceId: tuple.workspaceId,
          workspaceMemberId: `member-${tuple.assistantId}`,
          assistantId: tuple.assistantId,
          assistant: {
            id: tuple.assistantId,
            workspaceId: tuple.workspaceId,
            roleId: tuple.roleId
          },
          plan: null,
          assistantLimit: {}
        };
      }
    } as unknown as ResolveActiveAssistantService
  );

  return { service, resolverCalls, findManyInputs, adminCalls };
}

test("B2C assistant listing uses exact active Assistant and current active Role authority", async () => {
  const harness = createHarness([
    {
      assistantId: "assistant-a",
      workspaceId: "workspace-a",
      roleId: "role-a"
    }
  ]);

  const result = await harness.service.listForAssistant("user-b2b");

  assert.deepEqual(harness.resolverCalls, [{ userId: "user-b2b" }]);
  assert.deepEqual(harness.findManyInputs, [
    {
      where: {
        OR: [
          {
            assistantId: "assistant-a",
            workspaceId: "workspace-a"
          },
          {
            sourceType: {
              in: ["skill_document", "skill_knowledge_card"]
            },
            skill: {
              status: "active",
              archivedAt: null,
              roleLinks: {
                some: {
                  roleId: "role-a",
                  role: {
                    status: "active"
                  }
                }
              }
            }
          }
        ]
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50
    }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "job-a");
  assert.equal(result[0]?.createdAt, createdAt.toISOString());
  assert.deepEqual(result[0]?.resultPayload, { indexed: true });
});

test("B2B same-workspace Assistant switch changes exact Assistant and Role authority", async () => {
  const harness = createHarness(
    [
      {
        assistantId: "assistant-a",
        workspaceId: "workspace-a",
        roleId: "role-a"
      },
      {
        assistantId: "assistant-b",
        workspaceId: "workspace-a",
        roleId: "role-b"
      }
    ],
    []
  );

  await harness.service.listForAssistant("user-b2b");
  await harness.service.listForAssistant("user-b2b");

  assert.deepEqual(harness.resolverCalls, [{ userId: "user-b2b" }, { userId: "user-b2b" }]);
  const [first, second] = harness.findManyInputs as Array<{
    where: {
      OR: [
        { assistantId: string; workspaceId: string },
        { skill: { roleLinks: { some: { roleId: string } } } }
      ];
    };
  }>;
  assert.deepEqual(first.where.OR[0], {
    assistantId: "assistant-a",
    workspaceId: "workspace-a"
  });
  assert.equal(first.where.OR[1].skill.roleLinks.some.roleId, "role-a");
  assert.deepEqual(second.where.OR[0], {
    assistantId: "assistant-b",
    workspaceId: "workspace-a"
  });
  assert.equal(second.where.OR[0].workspaceId, first.where.OR[0].workspaceId);
  assert.equal(second.where.OR[1].skill.roleLinks.some.roleId, "role-b");
  assert.notEqual(second.where.OR[1].skill.roleLinks.some.roleId, "role-a");
});

test("admin listing retains authorization and filter behavior", async () => {
  const harness = createHarness([]);

  const result = await harness.service.listForAdmin("admin-user", {
    sourceType: "skill_document",
    status: "completed"
  });

  assert.deepEqual(harness.adminCalls, ["admin-user"]);
  assert.deepEqual(harness.resolverCalls, []);
  assert.deepEqual(harness.findManyInputs, [
    {
      where: {
        sourceType: "skill_document",
        status: "completed"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50
    }
  ]);
  assert.equal(result[0]?.id, "job-a");
});
