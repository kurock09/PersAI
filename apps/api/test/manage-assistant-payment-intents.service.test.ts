import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { ManageAssistantPaymentIntentsService } from "../src/modules/workspace-management/application/manage-assistant-payment-intents.service";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ManageAdminPlansService } from "../src/modules/workspace-management/application/manage-admin-plans.service";
import type { ResolveEffectiveSubscriptionStateService } from "../src/modules/workspace-management/application/resolve-effective-subscription-state.service";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
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
  checkoutMode: "widget" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
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
  let providerCallCount = 0;
  let nextIntentId = 1;
  const now = new Date("2026-05-04T18:00:00.000Z");
  const resolveInputs: Array<{
    assistantPlanOverrideCode: string | null;
    assistantQuotaPlanCode: string | null;
  }> = [];

  const service = new ManageAssistantPaymentIntentsService(
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
          createdAt: now,
          updatedAt: now
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async findByAssistantId() {
        return {
          id: "gov-1",
          assistantId: "assistant-1",
          assistantPlanOverrideCode: "tester_override_plan",
          quotaPlanCode: "quota_fallback_plan",
          channelCredentialRefs: null,
          memoryControl: null,
          createdAt: now,
          updatedAt: now
        };
      }
    } as Pick<AssistantGovernanceRepository, "findByAssistantId"> as AssistantGovernanceRepository,
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
      async execute(input: {
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
      "execute"
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
              },
              mediaClasses: {
                image: true,
                audio: true,
                video: true,
                file: true
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 10000,
              activeWebChatsLimit: 20,
              imageGenerateMonthlyUnitsLimit: 40,
              imageEditMonthlyUnitsLimit: 20,
              videoGenerateMonthlyUnitsLimit: 10,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            skillPolicy: {
              maxEnabledSkills: 8
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
              },
              mediaClasses: {
                image: true,
                audio: true,
                video: true,
                file: true
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 5000,
              activeWebChatsLimit: 10,
              imageGenerateMonthlyUnitsLimit: 10,
              imageEditMonthlyUnitsLimit: 5,
              videoGenerateMonthlyUnitsLimit: 2,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            skillPolicy: {
              maxEnabledSkills: 4
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
          const created: StoredIntent = {
            id: `pi-${String(nextIntentId++)}`,
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
  assert.equal(providerCallCount, 1);
  assert.equal(resolveInputs[0]?.assistantPlanOverrideCode, null);
  assert.equal(resolveInputs[0]?.assistantQuotaPlanCode, null);

  const repeated = await service.createPaymentIntent("user-1", parsed);
  assert.deepEqual(repeated, created);
  assert.equal(providerCallCount, 1, "idempotent retry must not create another checkout session");

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

  const downgradeService = new ManageAssistantPaymentIntentsService(
    {
      async findByUserId() {
        return {
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
          createdAt: now,
          updatedAt: now
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async findByAssistantId() {
        return {
          id: "gov-1",
          assistantId: "assistant-1",
          assistantPlanOverrideCode: null,
          quotaPlanCode: null,
          channelCredentialRefs: null,
          memoryControl: null,
          createdAt: now,
          updatedAt: now
        };
      }
    } as Pick<AssistantGovernanceRepository, "findByAssistantId"> as AssistantGovernanceRepository,
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
      "execute"
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
              },
              mediaClasses: {
                image: true,
                audio: true,
                video: true,
                file: true
              }
            },
            quotaLimits: {
              tokenBudgetLimit: 5000,
              activeWebChatsLimit: 10,
              imageGenerateMonthlyUnitsLimit: 10,
              imageEditMonthlyUnitsLimit: 5,
              videoGenerateMonthlyUnitsLimit: 2,
              mediaStorageBytesLimit: null,
              knowledgeStorageBytesLimit: null,
              workspaceStorageBytesLimit: null
            },
            skillPolicy: {
              maxEnabledSkills: 4
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
