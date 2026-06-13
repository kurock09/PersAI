import assert from "node:assert/strict";
import { ResolveAdminBusinessPlatformService } from "../src/modules/workspace-management/application/resolve-admin-business-platform.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const service = new ResolveAdminBusinessPlatformService(
    {
      async assertCanReadAdminSurface(userId: string) {
        assert.equal(userId, "admin-1");
        return {
          userId,
          workspaceId: "ws-admin",
          roles: ["ops_admin"],
          hasGlobalPlatformAdminScope: true
        };
      }
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService,
    {
      appUser: {
        async count() {
          return 3;
        }
      },
      assistant: {
        async findMany() {
          return [
            { id: "assistant-1", userId: "user-1", workspaceId: "ws-1", applyStatus: "succeeded" },
            { id: "assistant-2", userId: "user-2", workspaceId: "ws-2", applyStatus: "failed" }
          ];
        }
      },
      assistantChat: {
        async count(args?: { where?: { surface?: string; archivedAt?: null } }) {
          if (args?.where?.surface === "web" && args.where.archivedAt === null) {
            return 8;
          }
          return 12;
        }
      },
      assistantChatMessage: {
        async count() {
          return 40;
        }
      },
      assistantGovernance: {
        async findMany() {
          return [
            {
              assistantId: "assistant-1",
              quotaPlanCode: "starter",
              assistantPlanOverrideCode: null
            },
            {
              assistantId: "assistant-2",
              quotaPlanCode: "starter",
              assistantPlanOverrideCode: "enterprise"
            }
          ];
        }
      },
      workspaceSubscription: {
        async findMany() {
          return [
            {
              workspaceId: "ws-1",
              planCode: "pro",
              currentPeriodStartedAt: new Date("2026-05-01T00:00:00.000Z"),
              currentPeriodEndsAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ];
        }
      },
      workspaceQuotaAccountingState: {
        async findMany() {
          return [
            { workspaceId: "ws-1", tokenBudgetLimit: BigInt(100) },
            { workspaceId: "ws-2", tokenBudgetLimit: BigInt(100) },
            { workspaceId: "ws-3", tokenBudgetLimit: BigInt(100) }
          ];
        }
      },
      workspaceTokenBudgetPeriodCounter: {
        async findUnique(args: {
          where: {
            workspaceId_periodStartedAt_periodEndsAt: {
              workspaceId: string;
              periodStartedAt: Date;
              periodEndsAt: Date;
            };
          };
        }) {
          const workspaceId = args.where.workspaceId_periodStartedAt_periodEndsAt.workspaceId;
          return {
            usedCredits:
              workspaceId === "ws-1" ? BigInt(20) : workspaceId === "ws-2" ? BigInt(70) : BigInt(95)
          };
        }
      },
      assistantChannelSurfaceBinding: {
        async count(args: { where: { providerKey: string } }) {
          if (args.where.providerKey === "telegram") return 3;
          if (args.where.providerKey === "whatsapp") return 1;
          if (args.where.providerKey === "max") return 2;
          return 0;
        }
      },
      assistantAuditEvent: {
        async count(args: { where: { eventCode: string } }) {
          if (args.where.eventCode === "assistant.runtime.apply_succeeded") return 5;
          if (args.where.eventCode === "assistant.runtime.apply_degraded") return 1;
          if (args.where.eventCode === "assistant.runtime.apply_failed") return 2;
          return 0;
        }
      },
      workspacePaymentIntent: {
        async groupBy(args: { by: string[]; where?: { status?: string } }) {
          assert.equal(args.where?.status, "succeeded");
          if (args.by.join(",") === "currency") {
            return [
              {
                currency: "RUB",
                _sum: { amountMinor: 56100 },
                _count: { _all: 3 }
              }
            ];
          }
          throw new Error(`Unexpected workspacePaymentIntent groupBy: ${args.by.join(",")}`);
        }
      },
      workspaceSubscriptionBillingEvent: {
        async findMany() {
          return [
            {
              planCode: "pro",
              metadata: {
                amountMinor: 9800,
                currency: "RUB"
              }
            }
          ];
        }
      },
      planCatalogPlan: {
        async findMany() {
          return [];
        }
      },
      modelCostLedgerEvent: {
        async groupBy(args: { by: string[]; where?: { occurredAt?: { gte?: Date; lt?: Date } } }) {
          assert.ok(args.where?.occurredAt?.gte instanceof Date);
          assert.equal(args.where?.occurredAt?.gte.getTime(), 0);
          const key = args.by.join(",");
          if (key === "currency") {
            return [
              {
                currency: "USD",
                _count: { _all: 4 },
                _sum: { actualCostMicros: BigInt(4750000) }
              }
            ];
          }
          if (key === "purpose") {
            return [
              {
                purpose: "chat_main_reply",
                _count: { _all: 2 },
                _sum: { actualCostMicros: BigInt(3600000) }
              },
              {
                purpose: "background_task",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(250000) }
              },
              {
                purpose: "router",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(900000) }
              }
            ];
          }
          if (key === "surface") {
            return [
              {
                surface: "web",
                _count: { _all: 2 },
                _sum: { actualCostMicros: BigInt(3000000) }
              },
              {
                surface: "telegram",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(1500000) }
              },
              {
                surface: "background",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(250000) }
              }
            ];
          }
          if (key === "provider,model,purpose,surface,currency") {
            return [
              {
                provider: "openai",
                model: "gpt-4.1",
                purpose: "chat_main_reply",
                surface: "web",
                currency: "USD",
                _count: { _all: 2 },
                _sum: { actualCostMicros: BigInt(3600000) }
              },
              {
                provider: "openai",
                model: "gpt-4.1-mini",
                purpose: "router",
                surface: "telegram",
                currency: "USD",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(900000) }
              },
              {
                provider: "openai",
                model: "gpt-4.1-mini",
                purpose: "background_task",
                surface: "background",
                currency: "USD",
                _count: { _all: 1 },
                _sum: { actualCostMicros: BigInt(250000) }
              }
            ];
          }
          throw new Error(`Unexpected groupBy: ${key}`);
        },
        async findMany(args: { where?: { userId?: { not: null } }; select: Record<string, true> }) {
          if ("workspaceId" in args.select) {
            return [{ workspaceId: "ws-1" }, { workspaceId: "ws-2" }];
          }
          if ("userId" in args.select) {
            return [{ userId: "user-1" }, { userId: "user-2" }];
          }
          throw new Error("Unexpected findMany select");
        }
      },
      async $queryRaw() {
        return [
          {
            completed_turns: 10,
            turns_with_usage_accounting: 8,
            cached_input_hit_turns: 5,
            avg_input_tokens: 1200,
            avg_cached_input_tokens: 650,
            avg_output_tokens: 220,
            avg_total_tokens: 1420,
            avg_usage_steps_per_turn: 2,
            cached_input_share_percent: 54,
            cached_input_hit_turn_percent: 63
          }
        ];
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async listAll() {
        return [
          {
            id: "plan-starter",
            code: "starter",
            displayName: "Starter",
            description: null,
            status: "active",
            billingProviderHints: null,
            entitlementModel: null,
            isDefaultFirstRegistrationPlan: true,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            toolActivations: []
          },
          {
            id: "plan-pro",
            code: "pro",
            displayName: "Pro",
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
          },
          {
            id: "plan-enterprise",
            code: "enterprise",
            displayName: "Enterprise",
            description: null,
            status: "inactive",
            billingProviderHints: null,
            entitlementModel: null,
            isDefaultFirstRegistrationPlan: false,
            isTrialPlan: false,
            trialDurationDays: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            toolActivations: []
          }
        ];
      }
    } as Pick<AssistantPlanCatalogRepository, "listAll"> as AssistantPlanCatalogRepository
  );

  const result = await service.execute("admin-1");

  assert.equal(result.totalUsers, 3);
  assert.equal(result.totalAssistants, 2);
  assert.equal(result.activeAssistants, 1);
  assert.equal(result.totalConversations, 12);
  assert.equal(result.totalMessages, 40);
  assert.equal(result.activeWebChats, 8);
  assert.deepEqual(result.quotaPressureDistribution, { low: 1, elevated: 1, high: 1 });
  assert.deepEqual(result.channelAdoption, {
    webChat: 8,
    telegram: 3,
    whatsapp: 1,
    max: 2,
    total: 14
  });
  assert.equal(result.publishApplyHealth.applySuccessPercent, 63);
  assert.equal(result.ledgerBackedModelCost.windowLabel, "all_time");
  assert.equal(result.ledgerBackedModelCost.periodSource, "all_time");
  assert.equal(result.platformPaymentRevenueAllTime.rubTotalMinor, 65900);
  assert.equal(result.platformPaymentRevenueAllTime.rubSucceededPayments, 4);
  assert.equal(result.platformPaymentRevenueAllTime.usdTotalMinor, 0);
  assert.equal(result.ledgerBackedModelCost.coverageScope, "adr099_block1_model_priced_paths");
  assert.match(result.ledgerBackedModelCost.coverageNote, /background-task evaluator/i);
  assert.equal(result.ledgerBackedModelCost.totalEvents, 4);
  assert.equal(result.ledgerBackedModelCost.trackedWorkspaces, 2);
  assert.equal(result.ledgerBackedModelCost.trackedUsers, 2);
  assert.equal(result.ledgerBackedModelCost.currencyTotals[0]?.currency, "USD");
  assert.equal(result.ledgerBackedModelCost.currencyTotals[0]?.totalCostMicros, 4750000);
  assert.deepEqual(
    result.ledgerBackedModelCost.byPurpose.map((entry) => [
      entry.key,
      entry.eventCount,
      entry.totalCostMicros
    ]),
    [
      ["chat_main_reply", 2, 3600000],
      ["router", 1, 900000],
      ["background_task", 1, 250000]
    ]
  );
  assert.deepEqual(
    result.ledgerBackedModelCost.bySurface.map((entry) => [
      entry.key,
      entry.eventCount,
      entry.totalCostMicros
    ]),
    [
      ["web", 2, 3000000],
      ["telegram", 1, 1500000],
      ["background", 1, 250000]
    ]
  );
  assert.deepEqual(result.runtimeTurnAverages, {
    window: "last_7_days",
    completedTurns: 10,
    turnsWithUsageAccounting: 8,
    cachedInputHitTurns: 5,
    avgInputTokens: 1200,
    avgCachedInputTokens: 650,
    avgOutputTokens: 220,
    avgTotalTokens: 1420,
    avgUsageStepsPerTurn: 2,
    cachedInputSharePercent: 54,
    cachedInputHitTurnPercent: 63
  });
  assert.deepEqual(
    result.planDistribution.map((entry) => [entry.planCode, entry.userCount, entry.percent]),
    [
      ["pro", 1, 33],
      ["enterprise", 1, 33],
      ["starter", 1, 33]
    ]
  );
}

void run();
