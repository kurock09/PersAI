import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { ResolveAssistantLifecycleViewService } from "../src/modules/workspace-management/application/resolve-assistant-lifecycle-view.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";
import type { AssistantPublishedVersionRepository } from "../src/modules/workspace-management/domain/assistant-published-version.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";
import type { ResolveActiveAssistantService } from "../src/modules/workspace-management/application/resolve-active-assistant.service";

type AssistantRow = {
  id: string;
  userId: string;
  workspaceId: string;
  draftDisplayName: string | null;
  draftAvatarEmoji: string | null;
  draftAvatarUrl: string | null;
};

function createAssistant(row: AssistantRow) {
  const now = new Date("2026-05-26T14:00:00.000Z");
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    draftDisplayName: row.draftDisplayName,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: row.draftAvatarEmoji,
    draftAvatarUrl: row.draftAvatarUrl,
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

function createPlanCatalogRepository(): AssistantPlanCatalogRepository {
  return {
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
            maxAssistants: 3
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
  } as AssistantPlanCatalogRepository;
}

function makeService(options: {
  workspaceId: string;
  assistants: AssistantRow[];
  lifecycleAssistantId: string | null;
  lifecycleError?: Error;
}) {
  const assistants = options.assistants.map((assistant) => createAssistant(assistant));
  const activeAssistant =
    options.lifecycleAssistantId === null
      ? null
      : (assistants.find((assistant) => assistant.id === options.lifecycleAssistantId) ?? null);

  const service = new ResolveAssistantLifecycleViewService(
    {
      async resolveMembership(userId: string) {
        assert.equal(userId, "user-1");
        return {
          workspaceId: options.workspaceId,
          workspaceMemberId: "member-1",
          activeAssistantId: options.lifecycleAssistantId
        };
      },
      async executeOptional(input: { userId: string }) {
        assert.equal(input.userId, "user-1");
        if (options.lifecycleError) {
          throw options.lifecycleError;
        }
        if (activeAssistant === null) {
          return null;
        }
        return {
          userId: "user-1",
          workspaceId: options.workspaceId,
          workspaceMemberId: "member-1",
          assistantId: activeAssistant.id,
          assistant: activeAssistant,
          plan: null,
          assistantLimit: { maxAssistants: 3 }
        };
      }
    } as Pick<
      ResolveActiveAssistantService,
      "resolveMembership" | "executeOptional"
    > as ResolveActiveAssistantService,
    {
      async findLatestByAssistantId() {
        return null;
      }
    } as Pick<
      AssistantPublishedVersionRepository,
      "findLatestByAssistantId"
    > as AssistantPublishedVersionRepository,
    {
      async findByAssistantId() {
        return null;
      }
    } as Pick<AssistantGovernanceRepository, "findByAssistantId"> as AssistantGovernanceRepository,
    {
      async findLatestByAssistantId() {
        return null;
      }
    } as Pick<
      AssistantMaterializedSpecRepository,
      "findLatestByAssistantId"
    > as AssistantMaterializedSpecRepository,
    createPlanCatalogRepository(),
    {
      assistant: {
        async findMany(input: { where: { workspaceId: string } }) {
          assert.equal(input.where.workspaceId, options.workspaceId);
          return assistants;
        }
      },
      workspaceSubscription: {
        async findUnique(input: { where: { workspaceId: string } }) {
          assert.equal(input.where.workspaceId, options.workspaceId);
          return { planCode: "starter" };
        }
      }
    } as unknown as WorkspaceManagementPrismaService
  );

  return service;
}

async function runReturnsActiveAssistantAndDirectoryState(): Promise<void> {
  const service = makeService({
    workspaceId: "ws-1",
    lifecycleAssistantId: "assistant-2",
    assistants: [
      {
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "ws-1",
        draftDisplayName: "Alpha",
        draftAvatarEmoji: "A",
        draftAvatarUrl: "/api/avatar/hash-1"
      },
      {
        id: "assistant-2",
        userId: "user-1",
        workspaceId: "ws-1",
        draftDisplayName: "Beta",
        draftAvatarEmoji: "B",
        draftAvatarUrl: "/api/avatar/hash-2"
      }
    ]
  });

  const result = await service.execute("user-1");

  assert.equal(result.assistant?.id, "assistant-2");
  assert.equal(result.activeAssistantId, "assistant-2");
  assert.equal(result.assistants.length, 2);
  assert.deepEqual(
    result.assistants.map((assistant) => assistant.id),
    ["assistant-1", "assistant-2"]
  );
  assert.equal(result.assistantLimit.usedAssistants, 2);
  assert.equal(result.assistantLimit.maxAssistants, 3);
}

async function runAllowsBootstrapListWhenActiveAssistantSelectionRequired(): Promise<void> {
  const service = makeService({
    workspaceId: "ws-1",
    lifecycleAssistantId: null,
    lifecycleError: new ConflictException(
      "Active assistant selection is required because this workspace has multiple assistants."
    ),
    assistants: [
      {
        id: "assistant-1",
        userId: "user-1",
        workspaceId: "ws-1",
        draftDisplayName: "Alpha",
        draftAvatarEmoji: "A",
        draftAvatarUrl: "/api/avatar/hash-1"
      },
      {
        id: "assistant-2",
        userId: "user-1",
        workspaceId: "ws-1",
        draftDisplayName: "Beta",
        draftAvatarEmoji: "B",
        draftAvatarUrl: "/api/avatar/hash-2"
      }
    ]
  });

  const result = await service.execute("user-1");

  assert.equal(result.assistant, null);
  assert.equal(result.activeAssistantId, null);
  assert.equal(result.assistants.length, 2);
  assert.equal(result.assistantLimit.usedAssistants, 2);
}

async function runReturnsEmptyDirectoryWithoutAssistant(): Promise<void> {
  const service = makeService({
    workspaceId: "ws-1",
    lifecycleAssistantId: null,
    assistants: []
  });

  const result = await service.execute("user-1");

  assert.equal(result.assistant, null);
  assert.equal(result.activeAssistantId, null);
  assert.deepEqual(result.assistants, []);
  assert.equal(result.assistantLimit.usedAssistants, 0);
  assert.equal(result.assistantLimit.maxAssistants, 3);
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    [
      "returns active lifecycle state with assistant directory",
      runReturnsActiveAssistantAndDirectoryState
    ],
    [
      "returns assistant directory when active selection is still required",
      runAllowsBootstrapListWhenActiveAssistantSelectionRequired
    ],
    ["returns empty directory when no assistants exist", runReturnsEmptyDirectoryWithoutAssistant]
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
