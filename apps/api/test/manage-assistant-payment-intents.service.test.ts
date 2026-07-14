import assert from "node:assert/strict";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ManageAssistantPaymentIntentsService } from "../src/modules/workspace-management/application/manage-assistant-payment-intents.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ManageAdminPlansService } from "../src/modules/workspace-management/application/manage-admin-plans.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

type StoredIntent = {
  id: string;
  workspaceId: string;
  userId: string | null;
  targetPlanCode: string;
  action: "new_purchase" | "upgrade" | "renewal" | "manual_admin";
  status:
    | "created"
    | "checkout_ready"
    | "pending_confirmation"
    | "succeeded"
    | "failed"
    | "canceled"
    | "expired";
  paymentMethodClass: "card" | "sbp_qr";
  amountMinor: number;
  currency: string;
  billingPeriod: "month" | "year";
  returnUrl: string;
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSessionRef: string | null;
  providerPaymentRef: string | null;
  checkoutMode: "embedded" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
  checkoutPayload: Record<string, unknown> | null;
  expiresAt: Date | null;
  idempotencyKey: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

async function run(): Promise<void> {
  const intents: StoredIntent[] = [];
  const subscriptionUpdates: Array<Record<string, unknown>> = [];
  let providerCallCount = 0;
  let lastProviderCheckoutInput: Record<string, unknown> | null = null;
  let nextIntentId = 1;
  const now = new Date("2026-05-04T18:00:00.000Z");
  const resolveInputs: Array<{
    assistantPlanOverrideCode: string | null;
    assistantQuotaPlanCode: string | null;
  }> = [];

  const service = new ManageAssistantPaymentIntentsService(
    {
      async execute(input: { userId: string }) {
        const userId = input.userId;
        return {
          assistant: {
            id: "assistant-1",
            userId,
            workspaceId: "ws-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftTraits: null,
            draftAvatarEmoji: null,
            draftAvatarUrl: null,
            draftAssistantGender: null,
            draftVoiceProfile: null,
            draftArchetypeKey: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            configDirtyAt: null,
            roleId: "00000000-0000-4000-8000-000000000147",
            sandboxEgressMode: "restricted",
            createdAt: now,
            updatedAt: now
          }
        };
      }
    } as never,
    {
      async findByCode(code: string) {
        if (code === "pro_plus") {
          return {
            code,
            billingProviderHints: {
              presentation: {
                price: {
                  amount: 2000,
                  currency: "RUB",
                  billingPeriod: "month"
                }
              }
            }
          };
        }
        if (code === "starter") {
          return {
            code,
            billingProviderHints: {
              presentation: {
                price: {
                  amount: 990,
                  currency: "RUB",
                  billingPeriod: "month"
                }
              }
            }
          };
        }
        if (code === "free") {
          return {
            code,
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
        return null;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      async execute() {
        throw new Error("payment-intent flow must not initialize lifecycle truth");
      },
      async executeReadOnly(input: {
        assistantPlanOverrideCode: string | null;
        assistantQuotaPlanCode: string | null;
      }) {
        resolveInputs.push({
          assistantPlanOverrideCode: input.assistantPlanOverrideCode,
          assistantQuotaPlanCode: input.assistantQuotaPlanCode
        });
        assert.equal(
          input.assistantPlanOverrideCode,
          null,
          "payment-intent flow must ignore tester override state"
        );
        assert.equal(
          input.assistantQuotaPlanCode,
          null,
          "payment-intent flow must ignore quota fallback state"
        );
        return {
          source: "workspace_subscription",
          status: "active",
          planCode: "starter",
          trialEndsAt: null,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodEndsAt: "2026-06-01T00:00:00.000Z",
          cancelAtPeriodEnd: false
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "execute" | "executeReadOnly"
    > as ResolveEffectiveSubscriptionStateService,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "pro_plus",
            displayName: "Pro Plus",
            description: null,
            trialEnabled: false,
            trialDurationDays: null,
            defaultOnRegistration: false,
            enabledToolCodes: [],
            entitlements: {
              toolClasses: {
                costDrivingTools: true,
                utilityTools: true,
                costDrivingQuotaGoverned: true,
                utilityQuotaGoverned: true
              },
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 10000,
              activeWebChatsLimit: 20,
              imageGenerateMonthlyUnitsLimit: 40,
              imageEditMonthlyUnitsLimit: 20,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            presentation: {
              showOnPricingPage: true,
              displayOrder: 2,
              highlighted: true,
              title: { ru: "Про+", en: "Pro+" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Купить", en: "Buy" },
              price: {
                amount: 2000,
                currency: "RUB",
                billingPeriod: "month"
              },
              highlightItems: { ru: [], en: [] }
            }
          },
          {
            code: "starter",
            displayName: "Starter",
            description: null,
            trialEnabled: false,
            trialDurationDays: null,
            defaultOnRegistration: false,
            enabledToolCodes: [],
            entitlements: {
              toolClasses: {
                costDrivingTools: true,
                utilityTools: true,
                costDrivingQuotaGoverned: true,
                utilityQuotaGoverned: true
              },
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 5000,
              activeWebChatsLimit: 10,
              imageGenerateMonthlyUnitsLimit: 10,
              imageEditMonthlyUnitsLimit: 5,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            presentation: {
              showOnPricingPage: true,
              displayOrder: 1,
              highlighted: false,
              title: { ru: "Старт", en: "Starter" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Выбрать", en: "Choose" },
              price: {
                amount: 990,
                currency: "RUB",
                billingPeriod: "month"
              },
              highlightItems: { ru: [], en: [] }
            }
          }
        ];
      }
    } as Pick<ManageAdminPlansService, "listPublicPricingPlans"> as ManageAdminPlansService,
    {
      workspaceSubscription: {
        async findUnique() {
          return {
            providerCustomerRef: "cust-1"
          };
        }
      },
      workspacePaymentIntent: {
        async findUnique(args: {
          where: { workspaceId_idempotencyKey: { workspaceId: string; idempotencyKey: string } };
        }) {
          return (
            intents.find(
              (intent) =>
                intent.workspaceId === args.where.workspaceId_idempotencyKey.workspaceId &&
                intent.idempotencyKey === args.where.workspaceId_idempotencyKey.idempotencyKey
            ) ?? null
          );
        },
        async create(args: { data: Record<string, unknown> }) {
          const createdAt = new Date(now.getTime() + nextIntentId * 1000);
          const id = `00000000-0000-4000-8000-${String(nextIntentId).padStart(12, "0")}`;
          const created: StoredIntent = {
            id,
            workspaceId: "ws-1",
            userId: "user-1",
            targetPlanCode: args.data.targetPlanCode as string,
            action: args.data.action as StoredIntent["action"],
            status: "created",
            paymentMethodClass: args.data.paymentMethodClass as StoredIntent["paymentMethodClass"],
            amountMinor: args.data.amountMinor as number,
            currency: args.data.currency as string,
            billingPeriod: args.data.billingPeriod as StoredIntent["billingPeriod"],
            returnUrl: args.data.returnUrl as string,
            billingProvider: null,
            providerCustomerRef: (args.data.providerCustomerRef as string | null) ?? null,
            providerSessionRef: null,
            providerPaymentRef: null,
            checkoutMode: null,
            checkoutPayload: null,
            expiresAt: null,
            idempotencyKey: args.data.idempotencyKey as string,
            lastErrorCode: null,
            lastErrorMessage: null,
            metadata: (args.data.metadata as Record<string, unknown>) ?? {},
            createdAt,
            updatedAt: createdAt
          };
          nextIntentId += 1;
          intents.push(created);
          return created;
        },
        async update(args: { where: { id: string }; data: Record<string, unknown> }) {
          const intent = intents.find((entry) => entry.id === args.where.id);
          if (!intent) {
            throw new Error("payment intent not found");
          }
          Object.assign(intent, args.data, {
            updatedAt: new Date(intent.updatedAt.getTime() + 1000)
          });
          if (typeof args.data.expiresAt === "string") {
            intent.expiresAt = new Date(args.data.expiresAt);
          }
          if (args.data.expiresAt instanceof Date || args.data.expiresAt === null) {
            intent.expiresAt = (args.data.expiresAt as Date | null | undefined) ?? null;
          }
          return intent;
        },
        async findFirst(args: { where: { id: string; workspaceId: string; userId: string } }) {
          return (
            intents.find(
              (intent) =>
                intent.id === args.where.id &&
                intent.workspaceId === args.where.workspaceId &&
                intent.userId === args.where.userId
            ) ?? null
          );
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async createCheckoutSession(input) {
        providerCallCount += 1;
        lastProviderCheckoutInput = input as Record<string, unknown>;
        return {
          providerKey: "manual_test",
          providerSessionRef: `manual-${input.paymentIntentId}`,
          providerPaymentRef: null,
          mode: "manual_test",
          expiresAt: "2026-05-04T18:15:00.000Z",
          payload: {
            schema: "persai.billing.manualTestCheckout.v1",
            returnUrl: input.returnUrl
          }
        };
      },
      async pullWorkspaceSubscription() {
        return null;
      }
    } as BillingProviderPort
  );

  const parsed = service.parseCreateInput({
    planCode: "PRO_PLUS",
    paymentMethodClass: "card",
    idempotencyKey: "intent-1",
    returnUrl: "/app/chat?billing=return"
  });
  assert.deepEqual(parsed, {
    planCode: "pro_plus",
    paymentMethodClass: "card",
    idempotencyKey: "intent-1",
    returnUrl: "/app/chat?billing=return"
  });

  const created = await service.createPaymentIntent("user-1", parsed);
  assert.equal(created.targetPlanCode, "pro_plus");
  assert.equal(created.action, "upgrade");
  assert.equal(created.status, "checkout_ready");
  assert.equal(created.billingProvider, "manual_test");
  assert.equal(created.checkout.mode, "manual_test");
  assert.equal(created.checkout.payload?.schema, "persai.billing.manualTestCheckout.v1");
  assert.equal(created.amountMinor, 200000);
  assert.equal(created.recurring.checkoutKind, "recurring_start");
  assert.equal(created.recurring.supportedBySelectedMethod, true);
  assert.equal(lastProviderCheckoutInput?.amountMinor, 200000);
  assert.equal(lastProviderCheckoutInput?.checkoutKind, "recurring_start");
  assert.equal(providerCallCount, 1);
  assert.equal(resolveInputs[0]?.assistantPlanOverrideCode, null);
  assert.equal(resolveInputs[0]?.assistantQuotaPlanCode, null);

  const repeated = await service.createPaymentIntent("user-1", parsed);
  assert.deepEqual(repeated, created);
  assert.equal(providerCallCount, 1, "idempotent retry must not create another checkout session");

  const sbpIntent = await service.createPaymentIntent("user-1", {
    planCode: "pro_plus",
    paymentMethodClass: "sbp_qr",
    idempotencyKey: "intent-2",
    returnUrl: "/app/chat?billing=return"
  });
  assert.equal(sbpIntent.recurring.checkoutKind, "one_time");
  assert.equal(sbpIntent.recurring.supportedBySelectedMethod, false);
  assert.equal(lastProviderCheckoutInput?.checkoutKind, "one_time");

  const managedRecurringUpgradeService = new ManageAssistantPaymentIntentsService(
    {
      async execute() {
        return {
          assistant: {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "ws-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftTraits: null,
            draftAvatarEmoji: null,
            draftAvatarUrl: null,
            draftAssistantGender: null,
            draftVoiceProfile: null,
            draftArchetypeKey: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            configDirtyAt: null,
            sandboxEgressMode: "restricted",
            createdAt: now,
            updatedAt: now
          }
        };
      }
    } as never,
    {
      async findByCode(code: string) {
        if (code === "starter") {
          return {
            code,
            billingProviderHints: {
              presentation: {
                price: {
                  amount: 990,
                  currency: "RUB",
                  billingPeriod: "month"
                }
              }
            }
          };
        }
        if (code === "pro_plus") {
          return {
            code,
            billingProviderHints: {
              presentation: {
                price: {
                  amount: 2000,
                  currency: "RUB",
                  billingPeriod: "month"
                }
              }
            }
          };
        }
        return null;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      async execute() {
        throw new Error("payment-intent flow must not initialize lifecycle truth");
      },
      async executeReadOnly() {
        return {
          source: "workspace_subscription",
          status: "active",
          planCode: "starter",
          trialEndsAt: null,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodEndsAt: "2026-06-01T00:00:00.000Z",
          cancelAtPeriodEnd: false
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "execute" | "executeReadOnly"
    > as ResolveEffectiveSubscriptionStateService,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "pro_plus",
            displayName: "Pro Plus",
            description: null,
            trialEnabled: false,
            trialDurationDays: null,
            defaultOnRegistration: false,
            enabledToolCodes: [],
            entitlements: {
              toolClasses: {
                costDrivingTools: true,
                utilityTools: true,
                costDrivingQuotaGoverned: true,
                utilityQuotaGoverned: true
              },
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 10000,
              activeWebChatsLimit: 25,
              imageGenerateMonthlyUnitsLimit: 30,
              imageEditMonthlyUnitsLimit: 10,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            presentation: {
              showOnPricingPage: true,
              displayOrder: 1,
              highlighted: true,
              title: { ru: "Про+", en: "Pro Plus" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Выбрать", en: "Choose" },
              price: {
                amount: 2000,
                currency: "RUB",
                billingPeriod: "month"
              },
              highlightItems: { ru: [], en: [] }
            }
          }
        ];
      }
    } as Pick<ManageAdminPlansService, "listPublicPricingPlans"> as ManageAdminPlansService,
    {
      workspaceSubscription: {
        async findUnique() {
          return {
            providerCustomerRef: "cust-1",
            billingProvider: "cloudpayments",
            providerSubscriptionRef: "sub-provider-1"
          };
        }
      },
      workspacePaymentIntent: {
        async findUnique() {
          return null;
        },
        async create() {
          throw new Error("should not create payment intent for recurring managed upgrade");
        },
        async update() {
          throw new Error("should not update payment intent for recurring managed upgrade");
        },
        async findFirst() {
          return null;
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async createCheckoutSession() {
        throw new Error("provider should not be called for recurring managed upgrade");
      }
    } as BillingProviderPort
  );

  await assert.rejects(
    () =>
      managedRecurringUpgradeService.createPaymentIntent("user-1", {
        planCode: "pro_plus",
        paymentMethodClass: "card",
        idempotencyKey: "upgrade-managed-1",
        returnUrl: "/app/chat"
      }),
    /Changing an existing recurring subscription in place is not supported yet/
  );

  const directManagedRecurringUpgradeService = new ManageAssistantPaymentIntentsService(
    {
      async execute(input: { userId: string }) {
        const userId = input.userId;
        return {
          assistant: {
            id: "assistant-1",
            userId,
            workspaceId: "ws-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftTraits: null,
            draftAvatarEmoji: null,
            draftAvatarUrl: null,
            draftAssistantGender: null,
            draftVoiceProfile: null,
            draftArchetypeKey: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            configDirtyAt: null,
            sandboxEgressMode: "restricted",
            createdAt: now,
            updatedAt: now
          }
        };
      }
    } as never,
    {
      async findByCode(code: string) {
        if (code === "starter") {
          return {
            code,
            billingProviderHints: {
              presentation: { price: { amount: 990, currency: "RUB", billingPeriod: "month" } }
            }
          };
        }
        return {
          code,
          billingProviderHints: {
            presentation: { price: { amount: 2000, currency: "RUB", billingPeriod: "month" } }
          }
        };
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      async execute() {
        throw new Error("payment-intent flow must not initialize lifecycle truth");
      },
      async executeReadOnly() {
        return {
          source: "workspace_subscription",
          status: "active",
          planCode: "starter",
          trialEndsAt: null,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodEndsAt: "2026-06-01T00:00:00.000Z",
          cancelAtPeriodEnd: false
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "execute" | "executeReadOnly"
    > as ResolveEffectiveSubscriptionStateService,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "pro_plus",
            displayName: "Pro Plus",
            presentation: { price: { amount: 2000, currency: "RUB", billingPeriod: "month" } }
          },
          {
            code: "starter",
            displayName: "Starter",
            presentation: { price: { amount: 990, currency: "RUB", billingPeriod: "month" } }
          }
        ];
      }
    } as unknown as ManageAdminPlansService,
    {
      workspaceSubscription: {
        async findUnique() {
          return {
            providerCustomerRef: "cust-1",
            billingProvider: "cloudpayments",
            providerSubscriptionRef: "sub-provider-1"
          };
        },
        async update(args: { data: Record<string, unknown> }) {
          subscriptionUpdates.push(args.data);
          return args.data;
        }
      },
      workspacePaymentIntent: {
        async findUnique() {
          return null;
        },
        async create(args: { data: Record<string, unknown> }) {
          return {
            id: "22222222-2222-4222-8222-222222222222",
            workspaceId: "ws-1",
            userId: "user-1",
            targetPlanCode: args.data.targetPlanCode,
            action: args.data.action,
            status: "created",
            paymentMethodClass: args.data.paymentMethodClass,
            amountMinor: args.data.amountMinor,
            currency: args.data.currency,
            billingPeriod: args.data.billingPeriod,
            returnUrl: args.data.returnUrl,
            billingProvider: null,
            providerCustomerRef: "cust-1",
            providerSessionRef: null,
            providerPaymentRef: null,
            checkoutMode: null,
            checkoutPayload: null,
            expiresAt: null,
            idempotencyKey: args.data.idempotencyKey,
            lastErrorCode: null,
            lastErrorMessage: null,
            metadata: args.data.metadata,
            createdAt: now,
            updatedAt: now
          };
        },
        async update(args: { data: Record<string, unknown> }) {
          return {
            id: "22222222-2222-4222-8222-222222222222",
            workspaceId: "ws-1",
            userId: "user-1",
            targetPlanCode: "pro_plus",
            action: "upgrade",
            status: (args.data.status as string) ?? "checkout_ready",
            paymentMethodClass: "sbp_qr",
            amountMinor: 200000,
            currency: "RUB",
            billingPeriod: "month",
            returnUrl: "/app/chat?billing=upgrade",
            billingProvider: "manual_test",
            providerCustomerRef: "cust-1",
            providerSessionRef: "provider-session-upgrade",
            providerPaymentRef: "payment-ref-upgrade",
            checkoutMode: "manual_test",
            checkoutPayload: { checkoutUrl: "https://pay.example/upgrade" },
            expiresAt: null,
            idempotencyKey: "upgrade-sbp-direct-1",
            lastErrorCode: null,
            lastErrorMessage: null,
            metadata: {},
            createdAt: now,
            updatedAt: now
          };
        },
        async findFirst() {
          return null;
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async createCheckoutSession() {
        return {
          providerKey: "manual_test",
          providerSessionRef: "provider-session-upgrade",
          providerPaymentRef: "payment-ref-upgrade",
          mode: "manual_test",
          payload: { checkoutUrl: "https://pay.example/upgrade" },
          expiresAt: null
        };
      }
    } as BillingProviderPort
  );

  const recurringUpgradeIntent =
    await directManagedRecurringUpgradeService.createManagedRecurringUpgradePaymentIntent(
      "user-1",
      {
        planCode: "pro_plus",
        paymentMethodClass: "sbp_qr",
        idempotencyKey: "upgrade-sbp-direct-1",
        returnUrl: "/app/chat?billing=upgrade"
      }
    );
  assert.equal(recurringUpgradeIntent.status, "checkout_ready");
  assert.equal(recurringUpgradeIntent.paymentMethodClass, "sbp_qr");
  assert.equal(subscriptionUpdates.at(-1)?.recurringMigrationStatus, "in_progress");
  assert.equal(subscriptionUpdates.at(-1)?.recurringMigrationTargetMethodClass, "sbp_qr");

  await assert.rejects(
    () =>
      service.createPaymentIntent("user-1", {
        ...parsed,
        returnUrl: "/app/chat?billing=other"
      }),
    (error: unknown) => error instanceof ConflictException
  );

  const fetched = await service.getPaymentIntent("user-1", created.id);
  assert.deepEqual(fetched, created);
  await assert.rejects(
    () => service.getPaymentIntent("user-1", "undefined"),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message === "paymentIntentId must be a valid UUID."
  );

  const downgradeService = new ManageAssistantPaymentIntentsService(
    {
      async execute() {
        return {
          assistant: {
            id: "assistant-1",
            userId: "user-1",
            workspaceId: "ws-1",
            draftDisplayName: null,
            draftInstructions: null,
            draftTraits: null,
            draftAvatarEmoji: null,
            draftAvatarUrl: null,
            draftAssistantGender: null,
            draftVoiceProfile: null,
            draftArchetypeKey: null,
            draftUpdatedAt: null,
            applyStatus: "succeeded",
            applyTargetVersionId: null,
            applyAppliedVersionId: null,
            applyRequestedAt: null,
            applyStartedAt: null,
            applyFinishedAt: null,
            applyErrorCode: null,
            applyErrorMessage: null,
            configDirtyAt: null,
            sandboxEgressMode: "restricted",
            createdAt: now,
            updatedAt: now
          }
        };
      }
    } as never,
    {
      async findByCode(code: string) {
        if (code === "pro_plus") {
          return {
            code,
            billingProviderHints: {
              presentation: {
                price: {
                  amount: 2000,
                  currency: "RUB",
                  billingPeriod: "month"
                }
              }
            }
          };
        }
        if (code === "starter") {
          return {
            code,
            billingProviderHints: {
              presentation: {
                price: {
                  amount: 990,
                  currency: "RUB",
                  billingPeriod: "month"
                }
              }
            }
          };
        }
        return null;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      async execute() {
        throw new Error("payment-intent flow must not initialize lifecycle truth");
      },
      async executeReadOnly() {
        return {
          source: "workspace_subscription",
          status: "active",
          planCode: "pro_plus",
          trialEndsAt: null,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodEndsAt: "2026-06-01T00:00:00.000Z",
          cancelAtPeriodEnd: false
        };
      }
    } as Pick<
      ResolveEffectiveSubscriptionStateService,
      "execute" | "executeReadOnly"
    > as ResolveEffectiveSubscriptionStateService,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "starter",
            displayName: "Starter",
            description: null,
            trialEnabled: false,
            trialDurationDays: null,
            defaultOnRegistration: false,
            enabledToolCodes: [],
            entitlements: {
              toolClasses: {
                costDrivingTools: true,
                utilityTools: true,
                costDrivingQuotaGoverned: true,
                utilityQuotaGoverned: true
              },
              channelsAndSurfaces: {
                webChat: true,
                telegram: true,
                whatsapp: false,
                max: false
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 5000,
              activeWebChatsLimit: 10,
              imageGenerateMonthlyUnitsLimit: 10,
              imageEditMonthlyUnitsLimit: 5,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            presentation: {
              showOnPricingPage: true,
              displayOrder: 1,
              highlighted: false,
              title: { ru: "Старт", en: "Starter" },
              subtitle: { ru: null, en: null },
              notes: { ru: null, en: null },
              badge: { ru: null, en: null },
              ctaLabel: { ru: "Выбрать", en: "Choose" },
              price: {
                amount: 990,
                currency: "RUB",
                billingPeriod: "month"
              },
              highlightItems: { ru: [], en: [] }
            }
          }
        ];
      }
    } as Pick<ManageAdminPlansService, "listPublicPricingPlans"> as ManageAdminPlansService,
    {
      workspaceSubscription: {
        async findUnique() {
          return {
            providerCustomerRef: "cust-1"
          };
        }
      },
      workspacePaymentIntent: {
        async findUnique() {
          return null;
        },
        async create() {
          throw new Error("should not create payment intent for downgrade");
        },
        async update() {
          throw new Error("should not update payment intent for downgrade");
        },
        async findFirst() {
          return null;
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async createCheckoutSession() {
        throw new Error("provider should not be called for downgrade");
      },
      async pullWorkspaceSubscription() {
        return null;
      }
    } as BillingProviderPort
  );

  await assert.rejects(
    () =>
      downgradeService.createPaymentIntent("user-1", {
        planCode: "starter",
        paymentMethodClass: "card",
        idempotencyKey: "downgrade-1",
        returnUrl: "/app/chat"
      }),
    /Downgrade or lateral paid plan changes are not supported/
  );
}

void run();
