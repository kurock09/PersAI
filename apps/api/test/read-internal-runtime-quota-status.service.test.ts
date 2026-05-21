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
              displayName: "Web Search",
              activationStatus: "active" as const,
              dailyCallLimit: 3
            },
            {
              toolCode: "image_generate",
              displayName: "Image generation",
              activationStatus: "active" as const,
              dailyCallLimit: null
            },
            {
              toolCode: "video_generate",
              displayName: "Video generation",
              activationStatus: "inactive" as const,
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
          limit: input.dailyCallLimit,
          periodStartedAt: "2026-05-08T00:00:00.000Z",
          periodEndsAt: "2026-05-09T00:00:00.000Z",
          periodSource: "utc_day" as const
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
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
              status: "ok"
            }
          ]
        };
      },
      async resolveAssistantTokenBudgetQuotaSnapshot() {
        return {
          usedCredits: BigInt(12),
          limitCredits: BigInt(100),
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const
        };
      },
      async resolveAssistantMonthlyToolQuotaSnapshot() {
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
              percent: 10,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
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
              percent: 0,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: false,
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
              videoGenerateMonthlyUnitsLimit: 5,
              documentMonthlyUnitsLimit: 8
            }
          }
        ];
      }
    } as never,
    {
      notificationIntent: {
        async findMany() {
          return [];
        }
      }
    } as never,
    {
      async listPublic() {
        return [
          {
            id: "pkg-image-1",
            packageType: "image_generate",
            units: 10,
            amountMinor: 9900,
            currency: "RUB",
            isActive: true,
            displayOrder: 0,
            highlighted: false,
            title: { ru: "10 генераций", en: "10 generations" },
            subtitle: { ru: "", en: "" },
            ctaLabel: { ru: "Купить", en: "Buy" },
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z"
          },
          {
            id: "pkg-document-1",
            packageType: "document",
            units: 5,
            amountMinor: 14900,
            currency: "RUB",
            isActive: true,
            displayOrder: 1,
            highlighted: false,
            title: { ru: "5 документов", en: "5 documents" },
            subtitle: { ru: "", en: "" },
            ctaLabel: { ru: "Купить", en: "Buy" },
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z"
          }
        ];
      }
    } as never,
    {
      async findByCode() {
        return null;
      }
    } as never
  );

  const result = await service.execute({
    assistantId: "assistant-1",
    channel: "web",
    externalThreadKey: "chat-thread-1"
  });

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
  assert.equal(result.visiblePlans[1]?.limits.videoGenerateMonthlyUnitsLimit, null);
  assert.equal(result.tools.find((tool) => tool.toolCode === "web_search")?.currentCount, 2);
  assert.equal(
    result.tools.find((tool) => tool.toolCode === "web_search")?.displayName,
    "Web Search"
  );
  assert.equal(
    result.tools.find((tool) => tool.toolCode === "web_search")?.periodSource,
    "utc_day"
  );
  assert.equal(
    result.tools.some((tool) => tool.toolCode === "image_generate"),
    false
  );
  assert.equal(
    result.tools.some((tool) => tool.toolCode === "video_generate"),
    false
  );
  assert.equal(result.monthlyToolQuotas.tools[0]?.toolCode, "image_generate");
  assert.equal(result.monthlyToolQuotas.tools[0]?.usedUnits, 3);
  assert.equal(result.monthlyToolQuotas.tools[0]?.limitUnits, 30);
  assert.equal(result.monthlyToolQuotas.tools[1], undefined);
  assert.equal(result.packagesAvailableByTool.image_generate, true);
  assert.equal(result.packagesAvailableByTool.image_edit, false);
  assert.equal(result.packagesAvailableByTool.document, false);
  assert.equal(result.packageOffers.packagesPurchase?.path, "/app/packages");
  assert.equal(result.packageOffers.tools[0]?.offerableNow, true);
  assert.equal(result.packageOffers.tools[0]?.offers[0]?.id, "pkg-image-1");
  assert.equal(
    result.packageOffers.tools.find((tool) => tool.toolCode === "document")?.offers[0]?.id,
    "pkg-document-1"
  );
  const documentOffer = result.packageOffers.tools.find((tool) => tool.toolCode === "document")
    ?.offers[0];
  assert.equal(documentOffer?.amountMinor, 14900);
  assert.equal(documentOffer?.amountMajor, 149);
  assert.equal(normalizeSpacing(documentOffer?.priceLabel.ru), "149 ₽");
  assert.equal(result.advisoryCandidates.length, 0);

  const hiddenFreePlanService = new ReadInternalRuntimeQuotaStatusService(
    {
      async execute() {
        return {
          assistant,
          planCode: "hidden_free",
          tools: []
        };
      }
    } as never,
    {
      async resolveAssistantQuotaSnapshot() {
        return {
          planCode: "hidden_free",
          buckets: [
            {
              bucketCode: "token_budget",
              displayName: "Credits",
              unit: "tokens",
              used: 100,
              limit: 100,
              percent: 100,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: true,
              status: "limit_reached"
            }
          ]
        };
      },
      async resolveAssistantTokenBudgetQuotaSnapshot() {
        return {
          usedCredits: BigInt(100),
          limitCredits: BigInt(100),
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const
        };
      },
      async resolveAssistantMonthlyToolQuotaSnapshot() {
        return {
          planCode: "hidden_free",
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period",
          tools: []
        };
      }
    } as never,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "pro",
            displayName: "Pro",
            description: "Pro plan",
            enabledToolCodes: ["web_search"],
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
    } as never,
    {
      notificationIntent: {
        async findMany() {
          return [];
        }
      }
    } as never,
    {
      async listPublic() {
        return [];
      }
    } as never,
    {
      async findByCode() {
        return {
          billingProviderHints: {
            presentation: {
              price: {
                amount: 0,
                currency: "RUB",
                billingPeriod: "month"
              }
            }
          }
        };
      }
    } as never
  );

  const hiddenFreePlanResult = await hiddenFreePlanService.execute({
    assistantId: "assistant-1",
    channel: "web",
    externalThreadKey: "chat-thread-1"
  });

  assert.equal(hiddenFreePlanResult.advisories.isFreePlan, true);
  assert.equal(hiddenFreePlanResult.advisories.tokenBudget.paidLightModeEligible, false);
  assert.equal(hiddenFreePlanResult.advisories.tokenBudget.paidLightModeActive, false);
  assert.equal(hiddenFreePlanResult.advisories.higherPaidPlanAvailable, true);

  const alreadySentService = new ReadInternalRuntimeQuotaStatusService(
    {
      async execute() {
        return {
          assistant,
          planCode: "pro",
          tools: []
        };
      }
    } as never,
    {
      async resolveAssistantQuotaSnapshot() {
        return {
          planCode: "pro",
          buckets: [
            {
              bucketCode: "token_budget",
              displayName: "Credits",
              unit: "tokens",
              used: 95,
              limit: 100,
              percent: 95,
              finiteLimit: true,
              usageAvailable: true,
              warningThresholdPercent: 90,
              warningThresholdReached: true,
              status: "ok"
            }
          ]
        };
      },
      async resolveAssistantTokenBudgetQuotaSnapshot() {
        return {
          usedCredits: BigInt(95),
          limitCredits: BigInt(100),
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period" as const
        };
      },
      async resolveAssistantMonthlyToolQuotaSnapshot() {
        return {
          planCode: "pro",
          periodStartedAt: "2026-05-01T00:00:00.000Z",
          periodEndsAt: "2026-06-01T00:00:00.000Z",
          periodSource: "subscription_period",
          tools: []
        };
      }
    } as never,
    {
      async listPublicPricingPlans() {
        return [];
      }
    } as never,
    {
      notificationIntent: {
        async findMany() {
          return [
            {
              dedupeKey: "quota_advisory:assistant-1:web:chat-thread-1:legacy-aggregate-key",
              createdAt: new Date("2026-05-03T12:00:00.000Z"),
              factPayload: {
                candidateDedupeKeys: [
                  "quota_advisory:assistant-1:web:chat-thread-1:quota_bucket:token_budget:warning_90_percent:2026-05-01T00:00:00.000Z:2026-06-01T00:00:00.000Z"
                ]
              }
            }
          ];
        }
      }
    } as never,
    {
      async listPublic() {
        return [];
      }
    } as never,
    {
      async findByCode() {
        return null;
      }
    } as never
  );

  const alreadySentResult = await alreadySentService.execute({
    assistantId: "assistant-1",
    channel: "web",
    externalThreadKey: "chat-thread-1"
  });

  assert.equal(alreadySentResult.advisoryCandidates.length, 1);
  assert.equal(alreadySentResult.advisoryCandidates[0]?.deliveryState, "already_sent");
  assert.equal(alreadySentResult.advisoryCandidates[0]?.deliveredAt, "2026-05-03T12:00:00.000Z");
}

void run();
