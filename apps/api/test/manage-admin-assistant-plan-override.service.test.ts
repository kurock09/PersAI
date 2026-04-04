import assert from "node:assert/strict";
import { ManageAdminAssistantPlanOverrideService } from "../src/modules/workspace-management/application/manage-admin-assistant-plan-override.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";

async function run(): Promise<void> {
  const authCalls: string[] = [];
  const overrideWrites: Array<{ assistantId: string; planCode: string | null }> = [];

  const service = new ManageAdminAssistantPlanOverrideService(
    {
      async assertCanReadAdminSurface(userId: string) {
        authCalls.push(userId);
        return {
          userId,
          workspaceId: "ws-admin",
          roles: ["ops_admin"],
          hasLegacyOwnerFallback: false,
          hasGlobalPlatformAdminScope: true
        };
      }
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService,
    {
      async findByUserId(userId: string) {
        if (userId === "missing-user") {
          return null;
        }
        return {
          id: "assistant-1",
          userId,
          workspaceId: "ws-1",
          draftDisplayName: null,
          draftInstructions: null,
          draftTraits: null,
          draftAvatarEmoji: null,
          draftAvatarUrl: null,
          draftAssistantGender: null,
          draftUpdatedAt: null,
          applyStatus: "succeeded",
          applyTargetVersionId: null,
          applyAppliedVersionId: null,
          applyRequestedAt: null,
          applyStartedAt: null,
          applyFinishedAt: null,
          applyErrorCode: null,
          applyErrorMessage: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async setAssistantPlanOverride(assistantId: string, planCode: string | null) {
        overrideWrites.push({ assistantId, planCode });
        return {
          id: "gov-1",
          assistantId,
          capabilityEnvelope: null,
          secretRefs: null,
          policyEnvelope: null,
          memoryControl: null,
          tasksControl: null,
          assistantPlanOverrideCode: planCode,
          quotaPlanCode: "starter_trial",
          quotaHook: null,
          auditHook: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    } as Pick<
      AssistantGovernanceRepository,
      "setAssistantPlanOverride"
    > as AssistantGovernanceRepository,
    {
      async findByCode(code: string) {
        if (code === "pro_tester") {
          return {
            id: "plan-1",
            code,
            displayName: "Pro tester",
            description: null,
            status: "active",
            billingProviderHints: null,
            entitlementModel: null,
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            toolActivations: []
          };
        }
        return null;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository
  );

  const setResult = await service.setOverride("admin-1", "user-1", "pro_tester");
  assert.deepEqual(setResult, { ok: true });
  assert.deepEqual(authCalls, ["admin-1"]);
  assert.deepEqual(overrideWrites[0], { assistantId: "assistant-1", planCode: "pro_tester" });

  const resetResult = await service.resetOverride("admin-1", "user-1");
  assert.deepEqual(resetResult, { ok: true });
  assert.deepEqual(overrideWrites[1], { assistantId: "assistant-1", planCode: null });
}

void run();
