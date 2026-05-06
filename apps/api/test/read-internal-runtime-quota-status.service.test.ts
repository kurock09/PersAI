import assert from "node:assert/strict";
import { ReadInternalRuntimeQuotaStatusService } from "../src/modules/workspace-management/application/read-internal-runtime-quota-status.service";

function normalizeSpacing(value: string | null | undefined): string | null {
  return typeof value === "string" ? value.replace(/\u00a0/g, " ") : null;
}

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
    } as never,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "starter",
            displayName: "Starter",
            description: "Starter plan",
            enabledToolCodes: ["web_search"],
            presentation: {
              highlighted: false,
              title: { ru: "Старт", en: "Starter" },
              subtitle: { ru: "Для начала", en: "For getting started" },
              notes: { ru: "Базовый план", en: "Base plan" },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Выбрать", en: "Choose" },
              price: {
                amount: 990,
                currency: "RUB",
                billingPeriod: "month" as const
              },
              highlightItems: {
                ru: ["Базовый поиск"],
                en: ["Basic search"]
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 100,
              activeWebChatsLimit: 2,
              imageGenerateMonthlyUnitsLimit: 0,
              imageEditMonthlyUnitsLimit: 0,
              videoGenerateMonthlyUnitsLimit: 0
            }
          },
          {
            code: "pro",
            displayName: "Pro",
            description: "Pro plan",
            enabledToolCodes: ["web_search", "image_generate"],
            presentation: {
              highlighted: true,
              title: { ru: "Про", en: "Pro" },
              subtitle: { ru: "Для работы", en: "For work" },
              notes: { ru: "Популярный план", en: "Popular plan" },
              badge: { ru: "Хит", en: "Popular" },
              ctaLabel: { ru: "Открыть", en: "Open" },
              price: {
                amount: 1990,
                currency: "RUB",
                billingPeriod: "month" as const
              },
              highlightItems: {
                ru: ["Больше лимитов"],
                en: ["Higher limits"]
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 500,
              activeWebChatsLimit: 10,
              imageGenerateMonthlyUnitsLimit: 30,
              imageEditMonthlyUnitsLimit: 10,
              videoGenerateMonthlyUnitsLimit: 5
            }
          }
        ];
      }
    } as never
  );

  const result = await service.execute({ assistantId: "assistant-1" });

  assert.equal(result.planCode, "pro");
  assert.deepEqual(result.currentPlan, {
    code: "pro",
    displayName: "Pro"
  });
  assert.equal(result.visiblePlans.length, 2);
  assert.equal(result.visiblePlans[1]?.code, "pro");
  assert.equal(result.visiblePlans[1]?.isCurrent, true);
  assert.equal(result.visiblePlans[0]?.description, "Starter plan");
  assert.equal(result.visiblePlans[0]?.amountMinor, 99000);
  assert.equal(result.visiblePlans[0]?.amountMajor, 990);
  assert.equal(normalizeSpacing(result.visiblePlans[0]?.priceLabel.ru), "990 ₽ / месяц");
  assert.equal(result.visiblePlans[1]?.amountMinor, 199000);
  assert.equal(result.visiblePlans[1]?.amountMajor, 1990);
  assert.equal(normalizeSpacing(result.visiblePlans[1]?.priceLabel.ru), "1 990 ₽ / месяц");
  assert.deepEqual(result.visiblePlans[1]?.enabledToolCodes, ["web_search", "image_generate"]);
  assert.equal(result.visiblePlans[1]?.title.ru, "Про");
  assert.equal(result.visiblePlans[1]?.highlightItems.ru[0], "Больше лимитов");
  assert.equal(result.visiblePlans[1]?.limits.videoGenerateMonthlyUnitsLimit, 5);
  assert.equal(result.tools.find((tool) => tool.toolCode === "web_search")?.currentCount, 2);
  assert.equal(
    result.tools.some((tool) => tool.toolCode === "image_generate"),
    false
  );
  assert.equal(result.monthlyMediaQuotas.tools[0]?.toolCode, "image_generate");
  assert.equal(result.monthlyMediaQuotas.tools[0]?.usedUnits, 3);
  assert.equal(result.monthlyMediaQuotas.tools[0]?.limitUnits, 30);
  assert.equal(result.monthlyMediaQuotas.tools[1]?.toolCode, "video_generate");
  assert.equal(result.monthlyMediaQuotas.tools[1]?.remainingUnits, 5);
}

void run();
