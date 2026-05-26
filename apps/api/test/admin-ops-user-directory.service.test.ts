import assert from "node:assert/strict";
import { AdminOpsUserDirectoryService } from "../src/modules/workspace-management/application/admin-ops-user-directory.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { TrackWorkspaceQuotaUsageService } from "../src/modules/workspace-management/application/track-workspace-quota-usage.service";

async function run(): Promise<void> {
  const authCalls: string[] = [];
  const service = new AdminOpsUserDirectoryService(
    {
      appUser: {
        async findMany() {
          return [
            {
              id: "user-1",
              email: "admin@example.test",
              displayName: "Admin",
              createdAt: new Date("2026-05-03T00:00:00.000Z"),
              assistants: [
                {
                  id: "assistant-1",
                  draftDisplayName: "Ava",
                  draftAssistantGender: "female",
                  applyStatus: "succeeded",
                  publishedVersions: [
                    { version: 2, createdAt: new Date("2026-05-03T01:00:00.000Z") }
                  ]
                }
              ],
              workspaceLinks: [
                {
                  workspaceId: "workspace-1",
                  workspace: {
                    subscription: {
                      planCode: "pro",
                      status: "active",
                      trialEndsAt: null,
                      graceEndsAt: null,
                      currentPeriodEndsAt: new Date("2026-06-03T00:00:00.000Z")
                    },
                    quotaAccountingState: {
                      tokenBudgetUsed: BigInt(90),
                      tokenBudgetLimit: BigInt(100)
                    }
                  }
                }
              ]
            }
          ];
        },
        async count() {
          return 1;
        }
      },
      workspacePaymentIntent: {
        async groupBy() {
          return [{ currency: "RUB", _sum: { amountMinor: 99000 } }];
        }
      },
      modelCostLedgerEvent: {
        async aggregate() {
          return { _sum: { actualCostMicros: BigInt(1250000) } };
        }
      }
    } as never,
    {
      async assertCanReadAdminSurface(userId: string) {
        authCalls.push(userId);
        return {} as never;
      }
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService,
    {
      async findById(assistantId: string) {
        assert.equal(assistantId, "assistant-1");
        return {
          id: assistantId,
          userId: "user-1",
          workspaceId: "workspace-1"
        };
      }
    } as Pick<AssistantRepository, "findById"> as AssistantRepository,
    {
      async resolveAssistantTokenBudgetQuotaSnapshot() {
        return {
          usedCredits: BigInt(90),
          limitCredits: BigInt(100),
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const
        };
      }
    } as Pick<
      TrackWorkspaceQuotaUsageService,
      "resolveAssistantTokenBudgetQuotaSnapshot"
    > as TrackWorkspaceQuotaUsageService
  );

  const result = await service.execute("admin-1", { offset: 0, limit: 50 });

  assert.deepEqual(authCalls, ["admin-1"]);
  assert.equal(result.total, 1);
  assert.equal(result.users[0]?.billing.planCode, "pro");
  assert.equal(result.users[0]?.billing.usageRisk, "elevated");
  assert.equal(result.users[0]?.periodEconomics?.paidTotalMinor, 99000);
  assert.equal(result.users[0]?.periodEconomics?.paidCurrency, "RUB");
  assert.equal(result.users[0]?.periodEconomics?.modelCostUsdMicros, 1250000);
}

void run();
