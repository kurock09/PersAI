import assert from "node:assert/strict";
import { ManageAssistantBillingSubscriptionService } from "../src/modules/workspace-management/application/manage-assistant-billing-subscription.service";
import type { AssistantPlanCatalogRepository } from "../src/modules/workspace-management/domain/assistant-plan-catalog.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { BillingProviderPort } from "../src/modules/workspace-management/application/billing-provider.port";
import type { ApplyWorkspaceSubscriptionBillingEventService } from "../src/modules/workspace-management/application/apply-workspace-subscription-billing-event.service";
import type { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

async function run(): Promise<void> {
  const appliedEvents: Array<Record<string, unknown>> = [];
  const paymentMethodFindManyCalls: Array<Record<string, unknown>> = [];
  const billingEventFindManyCalls: Array<Record<string, unknown>> = [];
  let cancelAtPeriodEnd = false;
  const providerSubscriptionRef = "sub-provider-1";
  let returnFailedCancelSyncEvent = false;

  const service = new ManageAssistantBillingSubscriptionService(
    {
      async findByUserId() {
        return {
          id: "assistant-1",
          workspaceId: "ws-1"
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async findByCode(code: string) {
        return code === "pro" ? { code, displayName: "Pro" } : null;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      workspaceSubscription: {
        async findUnique() {
          return {
            planCode: "pro",
            status: "active",
            cancelAtPeriodEnd,
            billingProvider: "cloudpayments",
            providerCustomerRef: "cust-1",
            providerSubscriptionRef,
            currentPeriodEndsAt: new Date("2026-06-05T00:00:00.000Z")
          };
        }
      },
      workspaceSubscriptionBillingEvent: {
        async findMany(args: Record<string, unknown>) {
          const where = (args.where ?? {}) as Record<string, unknown>;
          if (where.eventCode === "subscription_cancel_scheduled") {
            billingEventFindManyCalls.push(args);
            return returnFailedCancelSyncEvent
              ? [
                  {
                    applyStatus: "failed",
                    metadata: {
                      providerEventType: "cancel_api"
                    }
                  }
                ]
              : [];
          }
          paymentMethodFindManyCalls.push(args);
          return [
            {
              metadata: {
                providerPaymentMethod: "card"
              }
            }
          ];
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async apply(input: Record<string, unknown>) {
        appliedEvents.push(input);
        cancelAtPeriodEnd = true;
        return { status: "applied", billingEventId: "billing-event-1" };
      }
    } as Pick<
      ApplyWorkspaceSubscriptionBillingEventService,
      "apply"
    > as ApplyWorkspaceSubscriptionBillingEventService,
    {
      async createCheckoutSession() {
        throw new Error("Not used in this test.");
      },
      async getManagedSubscription() {
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef,
          status: "Active",
          nextChargeAt: "2026-06-05T00:00:00.000Z",
          amountMinor: 98000,
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
        assert.equal(input.providerSubscriptionRef, providerSubscriptionRef);
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef,
          canceledAt: "2026-05-05T10:00:00.000Z"
        };
      }
    } as BillingProviderPort
  );

  const state = await service.getState("user-1");
  assert.equal(state.planDisplayName, "Pro");
  assert.equal(state.autoRenewEnabled, true);
  assert.equal(state.canDisableAutoRenew, true);
  assert.equal(state.paymentMethodLabel, "Bank card");
  assert.equal(state.managePaymentMethodMode, "provider_portal");
  assert.equal(state.nextChargeAt, "2026-06-05T00:00:00.000Z");
  assert.deepEqual(paymentMethodFindManyCalls[0]?.where, {
    workspaceId: "ws-1",
    source: "provider",
    providerSubscriptionRef,
    providerCustomerRef: "cust-1"
  });
  assert.deepEqual(billingEventFindManyCalls[0]?.where, {
    workspaceId: "ws-1",
    source: "provider",
    eventCode: "subscription_cancel_scheduled",
    providerSubscriptionRef,
    providerCustomerRef: "cust-1"
  });

  const disabled = await service.disableAutoRenew("user-1");
  assert.equal(disabled.autoRenewEnabled, false);
  assert.equal(disabled.canDisableAutoRenew, false);
  assert.equal(disabled.currentPeriodEndsAt, "2026-06-05T00:00:00.000Z");
  assert.equal(disabled.nextChargeAt, null);
  assert.equal(appliedEvents[0]?.eventCode, "subscription_cancel_scheduled");
  assert.equal(appliedEvents[0]?.providerSubscriptionRef, providerSubscriptionRef);

  paymentMethodFindManyCalls.length = 0;
  const staleOnlyService = new ManageAssistantBillingSubscriptionService(
    {
      async findByUserId() {
        return {
          id: "assistant-1",
          workspaceId: "ws-1"
        };
      }
    } as Pick<AssistantRepository, "findByUserId"> as AssistantRepository,
    {
      async findByCode(code: string) {
        return code === "pro" ? { code, displayName: "Pro" } : null;
      }
    } as Pick<AssistantPlanCatalogRepository, "findByCode"> as AssistantPlanCatalogRepository,
    {
      workspaceSubscription: {
        async findUnique() {
          return {
            planCode: "pro",
            status: "active",
            cancelAtPeriodEnd: false,
            billingProvider: "cloudpayments",
            providerCustomerRef: "cust-1",
            providerSubscriptionRef,
            currentPeriodEndsAt: new Date("2026-06-05T00:00:00.000Z")
          };
        }
      },
      workspaceSubscriptionBillingEvent: {
        async findMany(args: Record<string, unknown>) {
          paymentMethodFindManyCalls.push(args);
          return [];
        }
      }
    } as unknown as WorkspaceManagementPrismaService,
    {
      async apply() {
        throw new Error("Not used in this test.");
      }
    } as Pick<
      ApplyWorkspaceSubscriptionBillingEventService,
      "apply"
    > as ApplyWorkspaceSubscriptionBillingEventService,
    {
      async createCheckoutSession() {
        throw new Error("Not used in this test.");
      },
      async getManagedSubscription() {
        return {
          providerKey: "cloudpayments",
          providerSubscriptionRef,
          status: "Active",
          nextChargeAt: "2026-06-05T00:00:00.000Z",
          amountMinor: 98000,
          currency: "RUB",
          interval: "Month",
          period: 1,
          customerPortalUrl: "https://my.cloudpayments.ru/",
          paymentMethodUpdateUrl: "https://my.cloudpayments.ru/",
          cancelUrl: "https://my.cloudpayments.ru/unsubscribe",
          raw: {}
        };
      },
      async cancelManagedSubscription() {
        throw new Error("Not used in this test.");
      }
    } as BillingProviderPort
  );
  const staleOnlyState = await staleOnlyService.getState("user-1");
  assert.equal(staleOnlyState.paymentMethodLabel, null);

  returnFailedCancelSyncEvent = true;
  const syncFailedState = await service.getState("user-1");
  assert.equal(syncFailedState.autoRenewEnabled, false);
  assert.equal(syncFailedState.canDisableAutoRenew, false);
  assert.equal(syncFailedState.nextChargeAt, null);
  assert.equal(
    syncFailedState.warning,
    "Provider cancel succeeded, but PersAI is still synchronizing the new auto-renew state."
  );
}

void run();
