import assert from "node:assert/strict";
import { CreateAssistantService } from "../src/modules/workspace-management/application/create-assistant.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantMaterializedSpecRepository } from "../src/modules/workspace-management/domain/assistant-materialized-spec.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const now = new Date("2026-05-07T11:40:00.000Z");
  const callOrder: string[] = [];
  const createdAssistants: Array<{ userId: string; workspaceId: string }> = [];
  const lifecycleInitCalls: Array<{ workspaceId: string; userId: string; source: string }> = [];
  const auditEvents: Array<{ workspaceId: string; assistantId: string; actorUserId: string }> = [];
  const adminSystemEvents: Array<Record<string, unknown>> = [];

  const makeService = (options?: { subscriptionExists?: boolean }) =>
    new CreateAssistantService(
      {
        async findByUserId() {
          return null;
        },
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
          async findFirst() {
            return {
              id: "membership-1",
              workspaceId: "ws-1"
            };
          }
        },
        appUser: {
          async findUnique() {
            return {
              email: "user@example.com"
            };
          }
        },
        workspaceSubscription: {
          async findUnique() {
            return options?.subscriptionExists ? { id: "sub-1" } : null;
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
        async initializeLifecycleNow(input: {
          workspaceId: string;
          userId: string;
          source: "system" | "admin";
        }) {
          callOrder.push("lifecycle.initialize");
          lifecycleInitCalls.push(input);
          return {
            source: "catalog_default_fallback",
            status: "trialing",
            planCode: "starter_trial",
            trialEndsAt: "2026-05-10T11:40:00.000Z",
            graceStartedAt: null,
            graceEndsAt: null,
            currentPeriodEndsAt: "2026-05-10T11:40:00.000Z",
            cancelAtPeriodEnd: false
          };
        }
      } as Pick<
        ResolveEffectiveSubscriptionStateService,
        "initializeLifecycleNow"
      > as ResolveEffectiveSubscriptionStateService
    );

  const serviceWithoutSubscription = makeService();
  const assistant = await serviceWithoutSubscription.execute("user-1");
  assert.equal(assistant.id, "assistant-1");
  assert.deepEqual(lifecycleInitCalls, [
    {
      workspaceId: "ws-1",
      userId: "user-1",
      source: "system"
    }
  ]);
  assert.deepEqual(callOrder, ["lifecycle.initialize", "assistant.create"]);
  assert.deepEqual(createdAssistants, [{ userId: "user-1", workspaceId: "ws-1" }]);
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
        email: "user@example.com"
      },
      traceId: "assistant-created:assistant-1"
    }
  ]);

  callOrder.length = 0;
  createdAssistants.length = 0;
  lifecycleInitCalls.length = 0;
  auditEvents.length = 0;
  adminSystemEvents.length = 0;

  const serviceWithExistingSubscription = makeService({ subscriptionExists: true });
  await serviceWithExistingSubscription.execute("user-2");
  assert.deepEqual(lifecycleInitCalls, []);
  assert.deepEqual(callOrder, ["assistant.create"]);
  assert.deepEqual(createdAssistants, [{ userId: "user-2", workspaceId: "ws-1" }]);
  assert.deepEqual(adminSystemEvents, [
    {
      eventCode: "new_user_registered",
      summary: "New user registered: user@example.com",
      details: {
        sourceWorkspaceId: "ws-1",
        sourceAssistantId: "assistant-1",
        sourceUserId: "user-2",
        email: "user@example.com"
      },
      traceId: "assistant-created:assistant-1"
    }
  ]);
}

void run();
