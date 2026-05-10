import assert from "node:assert/strict";
import { ManageAssistantBillingSubscriptionService } from "../src/modules/workspace-management/application/manage-assistant-billing-subscription.service";

async function run(): Promise<void> {
  const appliedEvents: Array<Record<string, unknown>> = [];
  const scheduledPlanChanges: Array<Record<string, unknown>> = [];
  const providerCalls: Array<{
    kind: string;
    providerSubscriptionRef: string;
    description?: string | null;
  }> = [];
  let failProviderUpdate = false;
  let latestPaymentIntent: Record<string, unknown> | null = {
    paymentMethodClass: "card",
    metadata: {
      cloudpayments: {
        lastSubscriptionId: "sub-provider-1",
        lastPaymentMethod: "Card"
      },
      checkoutKind: "recurring_start",
      recurringReady: true
    }
  };
  let subscription: Record<string, unknown> = {
    planCode: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    billingProvider: "cloudpayments",
    providerCustomerRef: "cust-1",
    providerSubscriptionRef: "sub-provider-1",
    currentPeriodEndsAt: new Date("2026-06-05T00:00:00.000Z"),
    metadata: null,
    lastPaymentMethodClass: null,
    autoRenewMethodClass: null,
    recurringMigrationStatus: "idle",
    recurringMigrationUpdatedAt: null,
    recurringMigrationTargetMethodClass: null,
    recurringMigrationFailureReason: null
  };

  const service = new ManageAssistantBillingSubscriptionService(
    {
      async findByUserId() {
        return { id: "assistant-1", workspaceId: "ws-1" };
      }
    } as never,
    {
      async findByCode(code: string) {
        return code === "pro"
          ? { code, displayName: "Pro" }
          : code === "free"
            ? { code, displayName: "Free" }
            : null;
      }
    } as never,
    {
      async listPublicPricingPlans() {
        return [
          {
            code: "free",
            displayName: "Free",
            presentation: { price: { amount: 0, currency: "RUB", billingPeriod: "month" } }
          },
          {
            code: "starter",
            displayName: "Starter",
            presentation: { price: { amount: 49, currency: "RUB", billingPeriod: "month" } }
          },
          {
            code: "pro",
            displayName: "Pro",
            presentation: { price: { amount: 99, currency: "RUB", billingPeriod: "month" } }
          },
          {
            code: "starter_year",
            displayName: "Starter Year",
            presentation: { price: { amount: 39, currency: "RUB", billingPeriod: "year" } }
          }
        ];
      }
    } as never,
    {
      workspaceSubscription: {
        async findUnique() {
          return subscription;
        },
        async update(args: { data: Record<string, unknown> }) {
          subscription = { ...subscription, ...args.data };
          return subscription;
        }
      },
      workspacePaymentIntent: {
        async findFirst() {
          return latestPaymentIntent;
        }
      },
      workspaceSubscriptionBillingEvent: {
        async findMany(args: Record<string, unknown>) {
          const where = (args.where ?? {}) as Record<string, unknown>;
          if (where.eventCode === "subscription_cancel_scheduled") {
            return [];
          }
          return [{ metadata: { providerPaymentMethod: "card" } }];
        }
      }
    } as never,
    {
      async createPaymentIntent() {
        return { id: "pi-regular" };
      },
      async createAutoRenewBindPaymentIntent() {
        return { id: "pi-bind" };
      },
      async createManagedRecurringUpgradePaymentIntent() {
        return { id: "pi-upgrade" };
      }
    } as never,
    {
      async schedulePlanChangeAtPeriodEnd(input: Record<string, unknown>) {
        scheduledPlanChanges.push(input);
        subscription = {
          ...subscription,
          cancelAtPeriodEnd:
            input.pendingPlanChange?.changeKind === "free" ? true : subscription.cancelAtPeriodEnd,
          metadata: {
            pendingPlanChange: input.pendingPlanChange
          }
        };
      },
      async clearScheduledPlanChange() {
        subscription = {
          ...subscription,
          metadata: {
            pendingPlanChange: null
          }
        };
      }
    } as never,
    {
      async apply(input: Record<string, unknown>) {
        appliedEvents.push(input);
        if (input.eventCode === "subscription_cancel_scheduled") {
          subscription = {
            ...subscription,
            cancelAtPeriodEnd: true
          };
        }
        if (input.eventCode === "subscription_resumed") {
          subscription = {
            ...subscription,
            cancelAtPeriodEnd: false
          };
        }
        return { status: "applied", billingEventId: "billing-event-1" };
      }
    } as never,
    {
      async getManagedSubscription() {
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef: "sub-provider-1",
          status: "Active",
          nextChargeAt: "2026-06-05T00:00:00.000Z",
          amountMinor: 9900,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: "https://my.cloudpayments.ru/",
          paymentMethodUpdateUrl: "https://my.cloudpayments.ru/",
          cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
          raw: {}
        };
      },
      async cancelManagedSubscription(input: { providerSubscriptionRef: string }) {
        providerCalls.push({
          kind: "cancel",
          providerSubscriptionRef: input.providerSubscriptionRef
        });
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef: input.providerSubscriptionRef,
          canceledAt: "2026-05-05T10:00:00.000Z"
        };
      },
      async resumeManagedSubscription(input: { providerSubscriptionRef: string }) {
        providerCalls.push({
          kind: "resume",
          providerSubscriptionRef: input.providerSubscriptionRef
        });
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef: input.providerSubscriptionRef,
          status: "Active",
          nextChargeAt: "2026-06-05T00:00:00.000Z",
          amountMinor: 9900,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: "https://my.cloudpayments.ru/",
          paymentMethodUpdateUrl: "https://my.cloudpayments.ru/",
          cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
          raw: {}
        };
      },
      async updateManagedSubscription(input: { providerSubscriptionRef: string }) {
        providerCalls.push({
          kind: "update",
          providerSubscriptionRef: input.providerSubscriptionRef,
          description: (input as { description?: string | null }).description ?? null
        });
        if (failProviderUpdate) {
          throw new Error("provider update failed");
        }
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef: input.providerSubscriptionRef,
          status: "Active",
          nextChargeAt: "2026-06-05T00:00:00.000Z",
          amountMinor: 4900,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: "https://my.cloudpayments.ru/",
          paymentMethodUpdateUrl: "https://my.cloudpayments.ru/",
          cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
          raw: {}
        };
      }
    } as never
  );

  const state = await service.getState("user-1");
  assert.equal(state.planDisplayName, "Pro");
  assert.equal(state.autoRenewEnabled, true);
  assert.equal(state.canEnableAutoRenew, false);
  assert.equal(state.canDisableAutoRenew, true);
  assert.equal(state.lastPaymentMethodLabel, "Bank card");
  assert.equal(state.autoRenewMethodLabel, "Bank card");
  assert.equal(state.recurringMigration.status, "idle");

  const disabled = await service.disableAutoRenew("user-1");
  assert.equal(disabled.autoRenewEnabled, false);
  assert.equal(providerCalls[0]?.kind, "cancel");
  assert.equal(appliedEvents[0]?.eventCode, "subscription_cancel_scheduled");

  const resumed = await service.enableAutoRenew("user-1", {
    paymentMethodClass: "card",
    idempotencyKey: "resume-1",
    returnUrl: "/app/chat"
  });
  assert.equal(resumed.mode, "subscription_updated");
  assert.equal(providerCalls[1]?.kind, "resume");
  assert.equal(appliedEvents[1]?.eventCode, "subscription_resumed");

  const scheduledPaidDowngrade = await service.changePlan("user-1", {
    planCode: "starter",
    paymentMethodClass: "card",
    idempotencyKey: "change-paid-1",
    returnUrl: "/app/chat"
  });
  assert.equal(scheduledPaidDowngrade.mode, "subscription_updated");
  assert.equal(providerCalls[2]?.kind, "update");
  assert.equal(providerCalls[2]?.description, "PersAI Starter");
  assert.equal(scheduledPlanChanges[0]?.pendingPlanChange?.targetPlanCode, "starter");
  assert.equal(scheduledPlanChanges[0]?.pendingPlanChange?.changeKind, "downgrade");
  assert.equal(scheduledPaidDowngrade.subscription.autoRenewEnabled, true);
  assert.equal(scheduledPaidDowngrade.subscription.canEnableAutoRenew, false);
  assert.equal(scheduledPaidDowngrade.subscription.nextChargeAt, "2026-06-05T00:00:00.000Z");

  failProviderUpdate = true;
  await assert.rejects(
    service.changePlan("user-1", {
      planCode: "starter",
      paymentMethodClass: "card",
      idempotencyKey: "change-paid-fail-1",
      returnUrl: "/app/chat"
    }),
    /provider update failed/
  );
  failProviderUpdate = false;
  const afterFailedDowngrade = await service.getState("user-1");
  assert.equal(afterFailedDowngrade.scheduledPlanChange, null);
  assert.equal(afterFailedDowngrade.autoRenewEnabled, true);

  await assert.rejects(
    service.changePlan("user-1", {
      planCode: "starter_year",
      paymentMethodClass: "card",
      idempotencyKey: "change-cross-period-1",
      returnUrl: "/app/chat"
    }),
    /Cross-period or cross-currency paid plan changes are not supported/
  );

  const downgraded = await service.changePlan("user-1", {
    planCode: "free",
    paymentMethodClass: "card",
    idempotencyKey: "change-1",
    returnUrl: "/app/chat"
  });
  assert.equal(downgraded.mode, "subscription_updated");
  assert.equal(providerCalls[4]?.kind, "cancel");
  assert.equal(scheduledPlanChanges[2]?.pendingPlanChange?.targetPlanCode, "free");
  assert.equal(scheduledPlanChanges[2]?.pendingPlanChange?.changeKind, "free");

  subscription = {
    ...subscription,
    status: "paused",
    cancelAtPeriodEnd: false,
    providerSubscriptionRef: "sub-provider-1",
    currentPeriodEndsAt: new Date("2026-06-05T00:00:00.000Z")
  };
  const pausedState = await service.getState("user-1");
  assert.equal(pausedState.subscriptionStatus, "paused");
  assert.equal(pausedState.autoRenewEnabled, true);
  assert.equal(pausedState.autoRenewMethodLabel, "Bank card");

  subscription = {
    ...subscription,
    status: "active",
    providerSubscriptionRef: null,
    billingProvider: "cloudpayments"
  };
  latestPaymentIntent = {
    paymentMethodClass: "card",
    metadata: {
      cloudpayments: {
        lastSubscriptionId: null,
        lastPaymentMethod: "Sbp"
      },
      checkoutKind: "recurring_start",
      recurringReady: true
    }
  };
  const missingRecurringState = await service.getState("user-1");
  assert.equal(
    missingRecurringState.warning,
    "The last payment succeeded via SBP, but CloudPayments did not start auto-renew for this flow. Enable auto-renew with a bank card."
  );
}

void run();
