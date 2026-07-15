import assert from "node:assert/strict";
import { CreateAssistantService } from "../src/modules/workspace-management/application/create-assistant.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import type { EnforceAssistantCreationLimitService } from "../src/modules/workspace-management/application/enforce-assistant-creation-limit.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const now = new Date("2026-05-07T11:40:00.000Z");
  const callOrder: string[] = [];
  const createdAssistants: Array<{ userId: string; workspaceId: string }> = [];
  const limitChecks: string[] = [];
  const workspaceMemberUpdates: Array<{
    where: { id: string };
    data: { activeAssistantId: string };
  }> = [];
  const auditEvents: Array<{ workspaceId: string; assistantId: string; actorUserId: string }> = [];
  const adminSystemEvents: Array<Record<string, unknown>> = [];

  const makeService = (usedAssistants: number) =>
    new CreateAssistantService(
      {
        async create(userId: string, workspaceId: string) {
          callOrder.push("assistant.create");
          createdAssistants.push({ userId, workspaceId });
          return {
            id: "assistant-1",
            userId,
            workspaceId,
            draftDisplayName: null,
            draftInstructions: null,
            draftTraits: null,
            draftAvatarEmoji: null,
            draftAvatarUrl: null,
            draftAssistantGender: null,
            draftVoiceProfile: null,
            draftArchetypeKey: null,
            draftUpdatedAt: null,
            applyStatus: "not_requested",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            configDirtyAt: null,
            roleId: "00000000-0000-4000-8000-000000000147",
            sandboxEgressMode: "restricted",
            createdAt: now,
            updatedAt: now
          };
        }
      } as AssistantRepository,
      {
        async createBaseline(assistantId: string) {
          return {
            id: "gov-1",
            assistantId,
            assistantPlanOverrideCode: null,
            quotaPlanCode: null,
            channelCredentialRefs: null,
            memoryControl: null,
            createdAt: now,
            updatedAt: now
          };
        }
      } as Pick<AssistantGovernanceRepository, "createBaseline"> as AssistantGovernanceRepository,
      {
        async findLatestByAssistantId() {
          return null;
        }
      } as Pick<
        AssistantMaterializedSpecRepository,
        "findLatestByAssistantId"
      > as AssistantMaterializedSpecRepository,
      {
        workspaceMember: {
          async update(input: { where: { id: string }; data: { activeAssistantId: string } }) {
            workspaceMemberUpdates.push(input);
            return null;
          }
        },
        appUser: {
          async findUnique() {
            return {
              email: "user@example.com"
            };
          }
        }
      } as unknown as WorkspaceManagementPrismaService,
      {
        async emitEvent(input: Record<string, unknown>) {
          adminSystemEvents.push(input);
          return 1;
        }
      } as { emitEvent(input: Record<string, unknown>): Promise<number> },
      {
        async execute(input: { workspaceId: string; assistantId: string; actorUserId: string }) {
          auditEvents.push({
            workspaceId: input.workspaceId,
            assistantId: input.assistantId,
            actorUserId: input.actorUserId
          });
        }
      } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService,
      {
        async execute(userId: string) {
          callOrder.push("limit.check");
          limitChecks.push(userId);
          return {
            plan: null,
            workspaceId: "ws-1",
            workspaceMemberId: "membership-1",
            usedAssistants,
            maxAssistants: 3
          };
        }
      } as Pick<
        EnforceAssistantCreationLimitService,
        "execute"
      > as EnforceAssistantCreationLimitService
    );

  const firstService = makeService(0);
  const firstAssistant = await firstService.execute("user-1");
  assert.equal(firstAssistant.id, "assistant-1");
  assert.deepEqual(callOrder, ["limit.check", "assistant.create"]);
  assert.deepEqual(limitChecks, ["user-1"]);
  assert.deepEqual(createdAssistants, [{ userId: "user-1", workspaceId: "ws-1" }]);
  assert.deepEqual(workspaceMemberUpdates, [
    {
      where: { id: "membership-1" },
      data: { activeAssistantId: "assistant-1" }
    }
  ]);
  assert.deepEqual(auditEvents, [
    {
      workspaceId: "ws-1",
      assistantId: "assistant-1",
      actorUserId: "user-1"
    }
  ]);
  assert.deepEqual(adminSystemEvents, [
    {
      eventCode: "new_user_registered",
      summary: "New user registered: user@example.com",
      details: {
        sourceWorkspaceId: "ws-1",
        sourceAssistantId: "assistant-1",
        sourceUserId: "user-1",
        email: "user@example.com",
        assistantDisplayName: null,
        isFirstAssistantInWorkspace: true
      },
      traceId: "assistant-created:assistant-1"
    }
  ]);

  callOrder.length = 0;
  createdAssistants.length = 0;
  limitChecks.length = 0;
  workspaceMemberUpdates.length = 0;
  auditEvents.length = 0;
  adminSystemEvents.length = 0;

  const additionalService = makeService(1);
  const additionalAssistant = await additionalService.execute("user-1");
  assert.equal(additionalAssistant.id, "assistant-1");
  assert.deepEqual(adminSystemEvents, [
    {
      eventCode: "assistant_created",
      summary: "User user@example.com created a new assistant",
      details: {
        sourceWorkspaceId: "ws-1",
        sourceAssistantId: "assistant-1",
        sourceUserId: "user-1",
        email: "user@example.com",
        assistantDisplayName: null,
        isFirstAssistantInWorkspace: false
      },
      traceId: "assistant-created:assistant-1"
    }
  ]);
}

void run();
