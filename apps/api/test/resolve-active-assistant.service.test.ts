import assert from "node:assert/strict";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ResolveActiveAssistantService } from "../src/modules/workspace-management/application/resolve-active-assistant.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

type AssistantRow = {
  id: string;
  userId: string;
  workspaceId: string;
};

function createAssistant(row: AssistantRow) {
  const now = new Date("2026-05-26T14:00:00.000Z");
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftArchetypeKey: null,
    draftUpdatedAt: null,
    applyStatus: "not_requested" as const,
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    sandboxEgressMode: "restricted",
    createdAt: now,
    updatedAt: now
  };
}

function makeService(options: {
  membership: {
    id: string;
    workspaceId: string;
    activeAssistantId: string | null;
  };
  assistants: AssistantRow[];
}) {
  const workspaceMemberUpdates: Array<{
    where: { id: string };
    data: { activeAssistantId: string };
  }> = [];
  const assistantsById = new Map(options.assistants.map((assistant) => [assistant.id, assistant]));

  const service = new ResolveActiveAssistantService(
    {
      async findById(id: string) {
        const assistant = assistantsById.get(id);
        return assistant ? createAssistant(assistant) : null;
      }
    } as Pick<AssistantRepository, "findById"> as AssistantRepository,
    {
      async findByCode() {
        return {
          id: "plan-1",
          code: "starter",
          displayName: "Starter",
          description: null,
          status: "active",
          billingProviderHints: {
            assistantPolicy: {
              schema: "persai.assistantPolicy.v1",
              maxAssistants: 2
            }
          },
          entitlementModel: null,
          toolActivations: [],
          isDefaultFirstRegistrationPlan: false,
          isTrialPlan: false,
          trialDurationDays: null,
          createdAt: new Date("2026-05-26T12:00:00.000Z"),
          updatedAt: new Date("2026-05-26T12:00:00.000Z")
        };
      },
      async findDefaultRegistrationPlan() {
        return {
          id: "plan-default",
          code: "default",
          displayName: "Default",
          description: null,
          status: "active",
          billingProviderHints: {
            assistantPolicy: {
              schema: "persai.assistantPolicy.v1",
              maxAssistants: 1
            }
          },
          entitlementModel: null,
          toolActivations: [],
          isDefaultFirstRegistrationPlan: true,
          isTrialPlan: false,
          trialDurationDays: null,
          createdAt: new Date("2026-05-26T12:00:00.000Z"),
          updatedAt: new Date("2026-05-26T12:00:00.000Z")
        };
      }
    } as Pick<
      AssistantPlanCatalogRepository,
      "findByCode" | "findDefaultRegistrationPlan"
    > as AssistantPlanCatalogRepository,
    {
      workspaceMember: {
        async findFirst() {
          return options.membership;
        },
        async update(input: { where: { id: string }; data: { activeAssistantId: string } }) {
          workspaceMemberUpdates.push(input);
          return null;
        }
      },
      assistant: {
        async findFirst(input: { where: { id: string; workspaceId: string } }) {
          const assistant = assistantsById.get(input.where.id);
          if (!assistant || assistant.workspaceId !== input.where.workspaceId) {
            return null;
          }
          return { id: assistant.id };
        },
        async findMany(input: { where: { workspaceId: string }; take: number }) {
          return options.assistants
            .filter((assistant) => assistant.workspaceId === input.where.workspaceId)
            .slice(0, input.take)
            .map((assistant) => ({ id: assistant.id }));
        }
      },
      workspaceSubscription: {
        async findUnique() {
          return { planCode: "starter" };
        }
      }
    } as unknown as WorkspaceManagementPrismaService
  );

  return {
    service,
    workspaceMemberUpdates
  };
}

async function runExplicitAssistantWins(): Promise<void> {
  const { service, workspaceMemberUpdates } = makeService({
    membership: {
      id: "member-1",
      workspaceId: "ws-1",
      activeAssistantId: "assistant-1"
    },
    assistants: [
      { id: "assistant-1", userId: "user-1", workspaceId: "ws-1" },
      { id: "assistant-2", userId: "user-1", workspaceId: "ws-1" }
    ]
  });

  const result = await service.execute({
    userId: "user-1",
    assistantId: "assistant-2"
  });

  assert.equal(result.assistantId, "assistant-2");
  assert.equal(result.assistant.id, "assistant-2");
  assert.equal(result.assistantLimit.maxAssistants, 2);
  assert.deepEqual(workspaceMemberUpdates, []);
}

async function runActivePointerUsedByDefault(): Promise<void> {
  const { service } = makeService({
    membership: {
      id: "member-1",
      workspaceId: "ws-1",
      activeAssistantId: "assistant-1"
    },
    assistants: [
      { id: "assistant-1", userId: "user-1", workspaceId: "ws-1" },
      { id: "assistant-2", userId: "user-1", workspaceId: "ws-1" }
    ]
  });

  const result = await service.execute({ userId: "user-1" });
  assert.equal(result.assistantId, "assistant-1");
}

async function runSingleAssistantFallbackSetsActivePointer(): Promise<void> {
  const { service, workspaceMemberUpdates } = makeService({
    membership: {
      id: "member-1",
      workspaceId: "ws-1",
      activeAssistantId: null
    },
    assistants: [{ id: "assistant-1", userId: "user-1", workspaceId: "ws-1" }]
  });

  const result = await service.execute({ userId: "user-1" });
  assert.equal(result.assistantId, "assistant-1");
  assert.deepEqual(workspaceMemberUpdates, [
    {
      where: { id: "member-1" },
      data: { activeAssistantId: "assistant-1" }
    }
  ]);
}

async function runInvalidActivePointerSelfHealsForSingleAssistant(): Promise<void> {
  const { service, workspaceMemberUpdates } = makeService({
    membership: {
      id: "member-1",
      workspaceId: "ws-1",
      activeAssistantId: "deleted-assistant"
    },
    assistants: [{ id: "assistant-1", userId: "user-1", workspaceId: "ws-1" }]
  });

  const result = await service.execute({ userId: "user-1" });
  assert.equal(result.assistantId, "assistant-1");
  assert.deepEqual(workspaceMemberUpdates, [
    {
      where: { id: "member-1" },
      data: { activeAssistantId: "assistant-1" }
    }
  ]);
}

async function runMultipleAssistantsWithoutPointerFailsHonestly(): Promise<void> {
  const { service } = makeService({
    membership: {
      id: "member-1",
      workspaceId: "ws-1",
      activeAssistantId: null
    },
    assistants: [
      { id: "assistant-1", userId: "user-1", workspaceId: "ws-1" },
      { id: "assistant-2", userId: "user-1", workspaceId: "ws-1" }
    ]
  });

  await assert.rejects(() => service.execute({ userId: "user-1" }), ConflictException);
}

async function runCrossWorkspaceExplicitAssistantRejected(): Promise<void> {
  const { service } = makeService({
    membership: {
      id: "member-1",
      workspaceId: "ws-1",
      activeAssistantId: "assistant-1"
    },
    assistants: [
      { id: "assistant-1", userId: "user-1", workspaceId: "ws-1" },
      { id: "assistant-2", userId: "user-1", workspaceId: "ws-2" }
    ]
  });

  await assert.rejects(
    () =>
      service.execute({
        userId: "user-1",
        assistantId: "assistant-2"
      }),
    NotFoundException
  );
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["explicit assistant id wins after validation", runExplicitAssistantWins],
    [
      "active pointer is used when no explicit assistant id is passed",
      runActivePointerUsedByDefault
    ],
    [
      "single-assistant fallback sets and uses the active pointer",
      runSingleAssistantFallbackSetsActivePointer
    ],
    [
      "invalid active pointer self-heals for a single-assistant workspace",
      runInvalidActivePointerSelfHealsForSingleAssistant
    ],
    [
      "multiple assistants without active pointer fails honestly",
      runMultipleAssistantsWithoutPointerFailsHonestly
    ],
    [
      "explicit assistant id from another workspace is rejected",
      runCrossWorkspaceExplicitAssistantRejected
    ]
  ];

  let failures = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`fail - ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exitCode = 1;
  }
}

void main();
