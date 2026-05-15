import assert from "node:assert/strict";
import { compileAssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBrowserConfig,
  RuntimeKnowledgeAccessConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";
import type {
  InternalQuotaCheckoutOutcome,
  InternalQuotaStatusOutcome,
  PersaiInternalApiClientService
} from "../src/modules/turns/persai-internal-api.client.service";
import { RuntimeQuotaStatusToolService } from "../src/modules/turns/runtime-quota-status-tool.service";

const KNOWLEDGE_ACCESS_EMPTY = {
  searchToolCode: "knowledge_search",
  fetchToolCode: "knowledge_fetch",
  executionModes: ["inline", "worker"],
  ragMode: "pattern_only",
  sources: []
} satisfies RuntimeKnowledgeAccessConfig;

function normalizeSpacing(value: string | null | undefined): string | null {
  return typeof value === "string" ? value.replace(/\u00a0/g, " ") : null;
}

const WORKER_TOOLS_CONFIG = {
  tools: []
} satisfies RuntimeWorkerToolsConfig;

const BROWSER_CONFIG = {
  toolCode: "browser",
  executionMode: "worker",
  credentialToolCode: "browser",
  providerIds: ["browserless"],
  defaultProviderId: "browserless",
  actions: ["snapshot", "act"],
  confirmationRequiredActions: ["act"]
} satisfies RuntimeBrowserConfig;

const CONVERSATION = {
  assistantId: "assistant-1",
  workspaceId: "workspace-1",
  channel: "web",
  externalThreadKey: "chat-thread-1",
  externalUserKey: "user-1",
  mode: "direct"
} as const;

function createBundle() {
  return compileAssistantRuntimeBundle({
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      publishedVersion: 1,
      algorithmVersion: 72,
      configGeneration: 1
    },
    persona: {
      displayName: "PersAI",
      instructions: "Answer as a concise assistant.",
      traits: null,
      avatarEmoji: null,
      avatarUrl: null,
      assistantGender: null,
      voiceProfile: {
        schema: "persai.assistantVoiceProfile.v1",
        defaultLocale: "en-US",
        deliveryKind: "voice_note",
        elevenlabs: {
          voiceId: null
        },
        yandex: {
          voice: "jane",
          role: null
        },
        openai: {
          voice: "marin"
        }
      }
    },
    userContext: {
      displayName: "Alex",
      birthday: null,
      gender: null,
      locale: "en",
      timezone: "UTC"
    },
    runtime: {
      runtimeAssignment: { tier: "paid_shared_restricted" },
      runtimeProviderProfile: {
        schema: "persai.runtimeProviderProfile.v1",
        mode: "admin_managed",
        primary: {
          provider: "openai",
          model: "gpt-5.4"
        }
      },
      runtimeProviderRouting: {
        schema: "persai.runtimeProviderRouting.v1",
        primaryPath: {
          providerKey: "openai",
          modelKey: "gpt-5.4",
          active: true,
          inactiveReason: null
        }
      },
      contextHydration: {
        preset: "balanced",
        targetContextBudget: 24000,
        compactionTriggerThreshold: 8000,
        keepRecentMinimum: 4,
        knowledgeHydrationBudget: 2400,
        autoCompactionWeb: false,
        autoCompactionTelegram: true,
        crossSessionCarryOverTtlDays: 7,
        crossSessionCarryOverIdleHours: 4,
        crossSessionCarryOverCooldownHours: 12
      },
      knowledgeAccess: KNOWLEDGE_ACCESS_EMPTY,
      workerTools: WORKER_TOOLS_CONFIG,
      browser: BROWSER_CONFIG,
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context",
        webSuggestionLatencyMs: 7000,
        reserveTokens: 24000,
        keepRecentTokens: 16000,
        recentTurnsPreserve: 4,
        telegramAutoSummarizeEnabled: true
      }
    },
    governance: {
      capabilityEnvelope: null,
      secretRefs: null,
      policyEnvelope: null,
      effectiveCapabilities: null,
      toolAvailability: null,
      memoryControl: null,
      tasksControl: null,
      toolCredentialRefs: {},
      toolPolicies: [
        {
          toolCode: "quota_status",
          displayName: "Quota Status",
          description: "Read live quota usage.",
          kind: "system",
          executionMode: "inline",
          usageRule: "allowed",
          enabled: true,
          visibleToModel: true,
          visibleInPlanEditor: false,
          dailyCallLimit: null
        }
      ],
      quota: {
        planCode: "paid",
        workspaceQuotaBytes: 1024,
        quotaHook: null
      },
      auditHook: null
    },
    channels: {
      bindings: null,
      telegram: {
        enabled: false,
        autoCompactionEnabled: true,
        dmPolicy: "owner_only",
        groupReplyMode: "mentions_only",
        parseMode: "plain_text",
        inbound: false,
        outbound: false,
        accessMode: "disabled",
        ownerClaimStatus: "unclaimed",
        ownerClaimCode: null,
        ownerClaimCodeExpiresAt: null,
        ownerTelegramUserId: null,
        ownerTelegramUsername: null,
        ownerTelegramChatId: null
      }
    },
    promptDocuments: {
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      preview: "",
      welcome: ""
    }
  }).bundle;
}

function createToolCall(argumentsObject: Record<string, unknown>): ProviderGatewayToolCall {
  return {
    id: "tool-call-quota-status-1",
    name: "quota_status",
    arguments: argumentsObject
  };
}

class FakePersaiInternalApiClientService {
  readCalls: Array<Record<string, unknown>> = [];
  checkoutCalls: Array<Record<string, unknown>> = [];
  checkoutOutcome: InternalQuotaCheckoutOutcome = {
    action: "checkout_created",
    checkout: {
      paymentIntentId: "pi-1",
      targetPlanCode: "paid",
      paymentMethodClass: "card" as const,
      recurringCheckoutKind: "recurring_start" as const,
      recurringSupportedBySelectedMethod: true,
      recurringUnsupportedReason: null,
      checkoutMode: "embedded" as const,
      checkoutPagePath: "/app/billing/checkout/pi-1",
      checkoutPageUrl: "https://persai.dev/app/billing/checkout/pi-1",
      checkoutSignInUrl:
        "https://persai.dev/sign-in?redirect_url=%2Fapp%2Fbilling%2Fcheckout%2Fpi-1"
    },
    subscriptionUpdate: null
  };
  outcome: InternalQuotaStatusOutcome = {
    planCode: "paid",
    currentPlan: {
      code: "paid",
      displayName: "Paid"
    },
    visiblePlans: [
      {
        code: "starter",
        displayName: "Starter",
        description: "Starter plan",
        highlighted: false,
        isCurrent: false,
        amountMinor: 99000,
        amountMajor: 990,
        currency: "RUB",
        billingPeriod: "month",
        priceLabel: { ru: "990 ₽ / месяц", en: "RUB 990 / month" },
        enabledToolCodes: ["web_search"],
        title: { ru: "Старт", en: "Starter" },
        subtitle: { ru: "Для начала", en: "For getting started" },
        notes: { ru: "Базовый план", en: "Base plan" },
        badge: { ru: null, en: null },
        ctaLabel: { ru: "Выбрать", en: "Choose" },
        highlightItems: {
          ru: ["Базовый поиск"],
          en: ["Basic search"]
        },
        limits: {
          tokenBudgetLimit: 100,
          activeWebChatsLimit: 2,
          messagesPerChat: 40,
          imageGenerateMonthlyUnitsLimit: 0,
          imageEditMonthlyUnitsLimit: 0,
          videoGenerateMonthlyUnitsLimit: 0,
          documentMonthlyUnitsLimit: null
        }
      },
      {
        code: "paid",
        displayName: "Paid",
        description: "Paid plan",
        highlighted: true,
        isCurrent: true,
        amountMinor: 199000,
        amountMajor: 1990,
        currency: "RUB",
        billingPeriod: "month",
        priceLabel: { ru: "1 990 ₽ / месяц", en: "RUB 1,990 / month" },
        enabledToolCodes: ["web_search", "image_generate"],
        title: { ru: "Платный", en: "Paid" },
        subtitle: { ru: "Для работы", en: "For work" },
        notes: { ru: "Расширенные лимиты", en: "Higher limits" },
        badge: { ru: "Популярный", en: "Popular" },
        ctaLabel: { ru: "Открыть", en: "Open" },
        highlightItems: {
          ru: ["Больше лимитов"],
          en: ["Higher limits"]
        },
        limits: {
          tokenBudgetLimit: 500,
          activeWebChatsLimit: 10,
          messagesPerChat: null,
          imageGenerateMonthlyUnitsLimit: 30,
          imageEditMonthlyUnitsLimit: 10,
          videoGenerateMonthlyUnitsLimit: 5,
          documentMonthlyUnitsLimit: null
        }
      }
    ],
    advisories: {
      warningThresholdPercent: 90,
      isFreePlan: false,
      higherPaidPlanAvailable: false,
      highestVisiblePaidPlanCode: "paid",
      tokenBudget: {
        periodStartedAt: "2026-05-01T00:00:00.000Z",
        periodEndsAt: "2026-06-01T00:00:00.000Z",
        periodSource: "subscription_period",
        paidLightModeEligible: true,
        paidLightModeActive: false,
        paidLightModeReason: null
      }
    },
    advisoryCandidates: [
      {
        dedupeKey:
          "quota_advisory:assistant-1:web:chat-thread-1:quota_bucket:token_budget:warning_90_percent:2026-05-01T00:00:00.000Z:2026-06-01T00:00:00.000Z",
        limitCode: "quota_bucket:token_budget",
        displayName: "Token budget",
        thresholdCode: "warning_90_percent",
        warningThresholdPercent: 90,
        currentPercent: 24,
        finiteLimit: true,
        periodStartedAt: "2026-05-01T00:00:00.000Z",
        periodEndsAt: "2026-06-01T00:00:00.000Z",
        periodSource: "subscription_period",
        deliveryState: "eligible",
        deliveredAt: null
      }
    ],
    tools: [
      {
        toolCode: "web_search",
        displayName: "Web search",
        activationStatus: "active",
        dailyCallLimit: 30,
        currentCount: 4,
        percent: 13,
        finiteLimit: true,
        warningThresholdPercent: 90,
        warningThresholdReached: false,
        periodStartedAt: "2026-05-08T00:00:00.000Z",
        periodEndsAt: "2026-05-09T00:00:00.000Z",
        periodSource: "utc_day",
        allowed: true
      }
    ],
    buckets: [
      {
        bucketCode: "token_budget",
        displayName: "Token budget",
        unit: "tokens",
        used: 1200,
        limit: 5000,
        percent: 24,
        finiteLimit: true,
        usageAvailable: true,
        warningThresholdPercent: 90,
        warningThresholdReached: false,
        status: "ok"
      }
    ],
    monthlyToolQuotas: {
      planCode: "paid",
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
        }
      ]
    },
    packagesAvailableByTool: {
      image_generate: true,
      image_edit: true,
      video_generate: false
    },
    packageOffers: {
      packagesPurchase: {
        path: "/app/packages",
        url: "https://persai.dev/app/packages",
        paymentMethodClasses: ["card", "sbp_qr"]
      },
      tools: [
        {
          toolCode: "image_generate",
          available: true,
          offerableNow: true,
          offerReason: "available",
          preferredOfferKind: "package_only",
          preferredPackageIds: ["pkg-image-1"],
          preferredUpgradePlanCode: null,
          upgradePlanCodes: [],
          offers: [
            {
              id: "pkg-image-1",
              toolCode: "image_generate",
              units: 10,
              amountMinor: 9900,
              currency: "RUB",
              displayOrder: 0,
              highlighted: true,
              title: { ru: "10 генераций", en: "10 generations" },
              subtitle: { ru: null, en: null },
              ctaLabel: { ru: "Купить", en: "Buy" }
            }
          ]
        },
        {
          toolCode: "image_edit",
          available: true,
          offerableNow: true,
          offerReason: "available",
          preferredOfferKind: "package_only",
          preferredPackageIds: ["pkg-edit-1"],
          preferredUpgradePlanCode: null,
          upgradePlanCodes: [],
          offers: [
            {
              id: "pkg-edit-1",
              toolCode: "image_edit",
              units: 10,
              amountMinor: 7900,
              currency: "RUB",
              displayOrder: 0,
              highlighted: false,
              title: { ru: "10 правок", en: "10 edits" },
              subtitle: { ru: null, en: null },
              ctaLabel: { ru: "Купить", en: "Buy" }
            }
          ]
        },
        {
          toolCode: "video_generate",
          available: false,
          offerableNow: false,
          offerReason: "no_public_packages",
          preferredOfferKind: "none",
          preferredPackageIds: [],
          preferredUpgradePlanCode: null,
          upgradePlanCodes: [],
          offers: []
        }
      ]
    }
  };
  error: Error | null = null;

  async readQuotaStatus(input: Record<string, unknown>) {
    this.readCalls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.outcome;
  }

  async createQuotaCheckout(input: Record<string, unknown>) {
    this.checkoutCalls.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    return this.checkoutOutcome;
  }
}

export async function runRuntimeQuotaStatusToolServiceTest(): Promise<void> {
  const bundle = createBundle();
  const projection = projectRuntimeNativeTools(bundle);
  const hiddenProjection = projectRuntimeNativeTools(bundle, {
    allowModelToolExposure: false
  });
  assert.equal(
    projection.tools.some((tool) => tool.name === "quota_status"),
    true
  );
  assert.equal(
    hiddenProjection.tools.some((tool) => tool.name === "quota_status"),
    false
  );

  const internalApi = new FakePersaiInternalApiClientService();
  const service = new RuntimeQuotaStatusToolService(
    internalApi as unknown as PersaiInternalApiClientService
  );

  const success = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-1",
    currentUserText: "show my quota",
    toolCall: createToolCall({
      toolCode: "web_search"
    })
  });
  assert.equal(success.payload.action, "reported");
  assert.equal(success.payload.requestedToolCode, "web_search");
  assert.equal(success.payload.currentPlan.displayName, "Paid");
  assert.equal(success.payload.visiblePlans[0]?.code, "starter");
  assert.equal(success.payload.visiblePlans[0]?.title.ru, "Старт");
  assert.equal(success.payload.visiblePlans[0]?.amountMajor, 990);
  assert.equal(normalizeSpacing(success.payload.visiblePlans[1]?.priceLabel.ru), "1 990 ₽ / месяц");
  assert.equal(success.payload.visiblePlans[1]?.limits.videoGenerateMonthlyUnitsLimit, 5);
  assert.equal(success.payload.advisoryCandidates[0]?.limitCode, "quota_bucket:token_budget");
  assert.equal(success.payload.tools[0]?.toolCode, "web_search");
  assert.equal(success.payload.buckets[0]?.bucketCode, "token_budget");
  assert.equal(success.payload.buckets.length, 1);
  assert.equal(success.payload.monthlyToolQuotas?.tools[0]?.toolCode, "image_generate");
  assert.equal(success.payload.monthlyToolQuotas?.tools[0]?.usedUnits, 3);
  assert.equal(success.payload.monthlyToolQuotas?.tools[0]?.limitUnits, 30);
  assert.equal(success.payload.packagesAvailableByTool.image_generate, true);
  assert.equal(success.payload.packagesAvailableByTool.video_generate, false);
  assert.equal(success.payload.packageOffers.tools[0]?.offers[0]?.id, "pkg-image-1");
  assert.equal(success.payload.packagesPurchase?.path, "/app/packages");
  assert.equal(success.payload.packagesPurchase?.url, "https://persai.dev/app/packages");
  assert.equal(success.payload.pricingPage?.path, "/app/pricing");
  assert.equal(success.payload.pricingPage?.url, "https://persai.dev/app/pricing");
  assert.deepEqual([...(success.payload.packagesPurchase?.availableTools ?? [])].sort(), [
    "image_edit",
    "image_generate"
  ]);
  assert.deepEqual(success.payload.packagesPurchase?.paymentMethodClasses, ["card", "sbp_qr"]);
  assert.deepEqual(internalApi.readCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: "web_search",
    channel: "web",
    externalThreadKey: "chat-thread-1"
  });

  const allTools = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-2",
    currentUserText: "show all quotas",
    toolCall: createToolCall({})
  });
  assert.equal(allTools.payload.action, "reported");
  assert.equal(allTools.payload.requestedToolCode, null);
  assert.equal(allTools.payload.buckets.length, 1);
  assert.deepEqual(internalApi.readCalls.at(-1), {
    assistantId: "assistant-1",
    toolCode: null,
    channel: "web",
    externalThreadKey: "chat-thread-1"
  });

  const invalid = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-3",
    currentUserText: "show quota",
    toolCall: createToolCall({
      toolCode: ""
    })
  });
  assert.equal(invalid.payload.action, "skipped");
  assert.equal(invalid.payload.reason, "invalid_arguments");
  assert.equal(invalid.isError, true);

  internalApi.error = new Error("internal quota error");
  const failed = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-4",
    currentUserText: "show quota",
    toolCall: createToolCall({
      toolCode: "web_search"
    })
  });
  assert.equal(failed.payload.action, "skipped");
  assert.equal(failed.payload.reason, "quota_status_failed");
  assert.equal(failed.payload.warning, "internal quota error");
  assert.deepEqual(failed.payload.buckets, []);
  assert.equal(failed.payload.monthlyToolQuotas, null);
  assert.deepEqual(failed.payload.packagesAvailableByTool, {});
  assert.deepEqual(failed.payload.packageOffers, { packagesPurchase: null, tools: [] });
  assert.equal(failed.payload.packagesPurchase, null);
  assert.equal(failed.payload.pricingPage?.path, "/app/pricing");
  assert.equal(failed.isError, true);

  internalApi.error = null;
  const checkout = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-5",
    currentUserText: "Да",
    toolCall: createToolCall({
      action: "create_checkout",
      targetPlanCode: "paid",
      paymentMethodClass: "card",
      confirmed: true
    })
  });
  assert.equal(checkout.payload.action, "checkout_created");
  assert.equal(checkout.payload.checkout?.paymentIntentId, "pi-1");
  assert.equal(checkout.payload.checkout?.checkoutPagePath, "/app/billing/checkout/pi-1");
  assert.equal(checkout.payload.checkout?.recurringCheckoutKind, "recurring_start");
  assert.equal(checkout.payload.checkout?.recurringSupportedBySelectedMethod, true);
  assert.equal(checkout.payload.subscriptionUpdate, null);
  assert.equal(
    checkout.payload.checkout?.checkoutPageUrl,
    "https://persai.dev/app/billing/checkout/pi-1"
  );
  assert.deepEqual(internalApi.checkoutCalls.at(-1), {
    assistantId: "assistant-1",
    requestId: "request-5",
    targetPlanCode: "paid",
    paymentMethodClass: "card",
    confirmed: true
  });

  internalApi.checkoutOutcome = {
    action: "checkout_created",
    checkout: {
      paymentIntentId: "pi-2",
      targetPlanCode: "paid",
      paymentMethodClass: "sbp_qr",
      recurringCheckoutKind: "one_time",
      recurringSupportedBySelectedMethod: false,
      recurringUnsupportedReason: "selected_method_is_not_recurring_capable",
      checkoutMode: "embedded",
      checkoutPagePath: "/app/billing/checkout/pi-2",
      checkoutPageUrl: "https://persai.dev/app/billing/checkout/pi-2",
      checkoutSignInUrl:
        "https://persai.dev/sign-in?redirect_url=%2Fapp%2Fbilling%2Fcheckout%2Fpi-2"
    },
    subscriptionUpdate: null
  };
  const oneTimeCheckout = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-5b",
    currentUserText: "Да, через СБП",
    toolCall: createToolCall({
      action: "create_checkout",
      targetPlanCode: "paid",
      paymentMethodClass: "sbp_qr",
      confirmed: true
    })
  });
  assert.equal(oneTimeCheckout.payload.action, "checkout_created");
  assert.equal(oneTimeCheckout.payload.checkout?.paymentIntentId, "pi-2");
  assert.equal(oneTimeCheckout.payload.checkout?.recurringCheckoutKind, "one_time");
  assert.equal(oneTimeCheckout.payload.checkout?.recurringSupportedBySelectedMethod, false);
  assert.equal(
    oneTimeCheckout.payload.checkout?.recurringUnsupportedReason,
    "selected_method_is_not_recurring_capable"
  );

  internalApi.checkoutOutcome = {
    action: "subscription_updated",
    checkout: null,
    subscriptionUpdate: {
      targetPlanCode: "starter",
      targetPlanDisplayName: "Starter",
      effectiveAt: "2026-06-01T00:00:00.000Z",
      nextChargeAt: null,
      changeKind: "downgrade"
    }
  };
  const scheduledChange = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-5c",
    currentUserText: "Да, переключи в конце периода",
    toolCall: createToolCall({
      action: "create_checkout",
      targetPlanCode: "starter",
      paymentMethodClass: "card",
      confirmed: true
    })
  });
  assert.equal(scheduledChange.payload.action, "subscription_updated");
  assert.equal(scheduledChange.payload.checkout, null);
  assert.equal(scheduledChange.payload.subscriptionUpdate?.targetPlanCode, "starter");
  assert.equal(scheduledChange.payload.subscriptionUpdate?.changeKind, "downgrade");

  const confirmationRequired = await service.executeToolCall({
    bundle,
    conversation: CONVERSATION,
    requestId: "request-6",
    currentUserText: "Расскажи про тарифы",
    toolCall: createToolCall({
      action: "create_checkout",
      targetPlanCode: "paid",
      paymentMethodClass: "card",
      confirmed: false
    })
  });
  assert.equal(confirmationRequired.payload.action, "skipped");
  assert.equal(confirmationRequired.payload.reason, "confirmation_required");
  assert.equal(
    confirmationRequired.payload.warning,
    "Create the checkout link only when the user wants it opened now."
  );
}
