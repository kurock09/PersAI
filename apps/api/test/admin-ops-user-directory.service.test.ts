import assert from "node:assert/strict";
import { AdminOpsUserDirectoryService } from "../src/modules/workspace-management/application/admin-ops-user-directory.service";
import type { AdminAuthorizationService } from "../src/modules/workspace-management/application/admin-authorization.service";

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
              assistant: {
                id: "assistant-1",
                draftDisplayName: "Ava",
                draftAssistantGender: "female",
                applyStatus: "succeeded",
                publishedVersions: [{ version: 2, createdAt: new Date("2026-05-03T01:00:00.000Z") }]
              },
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
      }
    } as never,
    {
      async assertCanReadAdminSurface(userId: string) {
        authCalls.push(userId);
        return {} as never;
      }
    } as Pick<AdminAuthorizationService, "assertCanReadAdminSurface"> as AdminAuthorizationService
  );

  const result = await service.execute("admin-1", { offset: 0, limit: 50 });

  assert.deepEqual(authCalls, ["admin-1"]);
  assert.equal(result.total, 1);
  assert.equal(result.users[0]?.billing.planCode, "pro");
  assert.equal(result.users[0]?.billing.usageRisk, "elevated");
}

void run();
