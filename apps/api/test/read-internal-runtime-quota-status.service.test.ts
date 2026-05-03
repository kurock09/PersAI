import assert from "node:assert/strict";
import { ReadInternalRuntimeQuotaStatusService } from "../src/modules/workspace-management/application/read-internal-runtime-quota-status.service";

async function run(): Promise<void> {
  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1"
  };

  const service = new ReadInternalRuntimeQuotaStatusService(
    {
      async execute() {
        return {
          assistant,
          planCode: "pro",
          tools: [
            {
              toolCode: "web_search",
              activationStatus: "active" as const,
              dailyCallLimit: 3
            },
            {
              toolCode: "image_generate",
              activationStatus: "active" as const,
              dailyCallLimit: null
            }
          ]
        };
      }
    } as never,
    {
      async checkToolDailyLimit(input: { toolCode: string; dailyCallLimit: number }) {
        return {
          allowed: true,
          currentCount: input.toolCode === "web_search" ? 2 : 0,
          limit: input.dailyCallLimit
        };
      },
      async resolveAssistantQuotaSnapshot() {
        return {
          planCode: "pro",
          buckets: [
            {
              bucketCode: "token_budget",
              displayName: "Credits",
              unit: "tokens",
              used: 12,
              limit: 100,
              percent: 12,
              usageAvailable: true,
              status: "ok"
            }
          ]
        };
      },
      async resolveAssistantMonthlyMediaQuotaSnapshot() {
        return {
          planCode: "pro",
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period",
          tools: [
            {
              toolCode: "image_generate",
              displayName: "Image generation",
              usedUnits: 3,
              reservedUnits: 1,
              settledUnits: 2,
              releasedUnits: 0,
              reconciliationRequiredUnits: 1,
              limitUnits: 30,
              remainingUnits: 27,
              usageAvailable: true,
              status: "ok"
            },
            {
              toolCode: "video_generate",
              displayName: "Video generation",
              usedUnits: 0,
              reservedUnits: 0,
              settledUnits: 0,
              releasedUnits: 0,
              reconciliationRequiredUnits: 0,
              limitUnits: 5,
              remainingUnits: 5,
              usageAvailable: true,
              status: "ok"
            }
          ]
        };
      }
    } as never
  );

  const result = await service.execute({ assistantId: "assistant-1" });

  assert.equal(result.planCode, "pro");
  assert.equal(result.tools.find((tool) => tool.toolCode === "web_search")?.currentCount, 2);
  assert.equal(
    result.tools.find((tool) => tool.toolCode === "image_generate")?.dailyCallLimit,
    null
  );
  assert.equal(result.tools.find((tool) => tool.toolCode === "image_generate")?.currentCount, 0);
  assert.equal(result.monthlyMediaQuotas.tools[0]?.toolCode, "image_generate");
  assert.equal(result.monthlyMediaQuotas.tools[0]?.usedUnits, 3);
  assert.equal(result.monthlyMediaQuotas.tools[0]?.limitUnits, 30);
  assert.equal(result.monthlyMediaQuotas.tools[1]?.toolCode, "video_generate");
  assert.equal(result.monthlyMediaQuotas.tools[1]?.remainingUnits, 5);
}

void run();
