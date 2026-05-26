import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { EnforceAssistantCreationLimitService } from "../src/modules/workspace-management/application/enforce-assistant-creation-limit.service";
import type { ResolveActiveAssistantService } from "../src/modules/workspace-management/application/resolve-active-assistant.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

function createPlan(maxAssistants: number) {
  return {
    id: `plan-${maxAssistants}`,
    code: `plan-${maxAssistants}`,
    displayName: `Plan ${maxAssistants}`,
    description: null,
    status: "active" as const,
    billingProviderHints: {
      assistantPolicy: {
        schema: "persai.assistantPolicy.v1",
        maxAssistants
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
}

async function runDeniesWhenPlanLimitReached(): Promise<void> {
  const service = new EnforceAssistantCreationLimitService(
    {
      async resolveMembership(userId: string) {
        assert.equal(userId, "user-1");
        return {
          workspaceId: "ws-1",
          workspaceMemberId: "member-1",
          activeAssistantId: "assistant-1"
        };
      }
    } as Pick<ResolveActiveAssistantService, "resolveMembership"> as ResolveActiveAssistantService,
    {
      async findByCode(code: string) {
        assert.equal(code, "starter");
        return createPlan(1);
      },
      async findDefaultRegistrationPlan() {
        return createPlan(1);
      }
    } as Pick<
      AssistantPlanCatalogRepository,
      "findByCode" | "findDefaultRegistrationPlan"
    > as AssistantPlanCatalogRepository,
    {
      async initializeLifecycleNow() {
        throw new Error("initializeLifecycleNow should not run when subscription already exists.");
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "initializeLifecycleNow"
    > as ResolveEffectiveSubscriptionStateService,
    {
      workspaceSubscription: {
        async findUnique() {
          return { planCode: "starter" };
        }
      },
      assistant: {
        async count() {
          return 1;
        }
      }
    } as unknown as WorkspaceManagementPrismaService
  );

  await assert.rejects(() => service.execute("user-1"), ConflictException);
}

async function runAllowsWhenPlanSupportsMultipleAssistants(): Promise<void> {
  let initializeCalls = 0;
  const service = new EnforceAssistantCreationLimitService(
    {
      async resolveMembership(userId: string) {
        assert.equal(userId, "user-2");
        return {
          workspaceId: "ws-2",
          workspaceMemberId: "member-2",
          activeAssistantId: null
        };
      }
    } as Pick<ResolveActiveAssistantService, "resolveMembership"> as ResolveActiveAssistantService,
    {
      async findByCode(code: string) {
        assert.equal(code, "team");
        return createPlan(3);
      },
      async findDefaultRegistrationPlan() {
        return createPlan(1);
      }
    } as Pick<
      AssistantPlanCatalogRepository,
      "findByCode" | "findDefaultRegistrationPlan"
    > as AssistantPlanCatalogRepository,
    {
      async initializeLifecycleNow(input: {
        workspaceId: string;
        userId: string;
        source: "system" | "admin";
      }) {
        initializeCalls += 1;
        assert.deepEqual(input, {
          workspaceId: "ws-2",
          userId: "user-2",
          source: "system"
        });
        return {
          source: "catalog_default_fallback" as const,
          status: "active" as const,
          planCode: "team",
          trialEndsAt: null,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "initializeLifecycleNow"
    > as ResolveEffectiveSubscriptionStateService,
    {
      workspaceSubscription: {
        async findUnique() {
          return null;
        }
      },
      assistant: {
        async count() {
          return 1;
        }
      }
    } as unknown as WorkspaceManagementPrismaService
  );

  const result = await service.execute("user-2");
  assert.equal(initializeCalls, 1);
  assert.equal(result.workspaceId, "ws-2");
  assert.equal(result.workspaceMemberId, "member-2");
  assert.equal(result.maxAssistants, 3);
  assert.equal(result.usedAssistants, 1);
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["denies creation when maxAssistants is reached", runDeniesWhenPlanLimitReached],
    [
      "allows creation when maxAssistants is higher than current usage",
      runAllowsWhenPlanSupportsMultipleAssistants
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
