import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ASSISTANT_PLAN_CATALOG_REPOSITORY } from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalogRepository } from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY } from "../domain/assistant.repository";
import type { AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./apply-workspace-subscription-billing-event.service";
import { BILLING_PROVIDER_PORT, type BillingProviderPort } from "./billing-provider.port";

export type AssistantBillingSubscriptionManagementState = {
  planCode: string | null;
  planDisplayName: string | null;
  subscriptionStatus:
    | "trialing"
    | "active"
    | "grace_period"
    | "past_due"
    | "paused"
    | "canceled"
    | "expired"
    | "expired_fallback"
    | "unconfigured";
  billingProvider: string | null;
  providerSubscriptionRef: string | null;
  autoRenewEnabled: boolean;
  canDisableAutoRenew: boolean;
  nextChargeAt: string | null;
  currentPeriodEndsAt: string | null;
  paymentMethodLabel: string | null;
  managePaymentMethodUrl: string | null;
  managePaymentMethodMode: "provider_portal" | "provider_managed_recovery" | "unavailable";
  cancelUrl: string | null;
  warning: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatPaymentMethodLabel(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  switch (value.toLowerCase()) {
    case "card":
      return "Bank card";
    case "applepay":
      return "Apple Pay";
    case "googlepay":
      return "Google Pay";
    case "tinkoffpay":
    case "tpay":
      return "T-Pay";
    case "mirpay":
      return "Mir Pay";
    case "sbp":
    case "fastpaymentsystem":
      return "SBP";
    default:
      return value;
  }
}

type ProviderManagedRecurringSubscription = {
  status: "active" | "grace_period" | "past_due";
  billingProvider: "cloudpayments";
  providerCustomerRef: string | null;
  providerSubscriptionRef: string;
};

function isProviderManagedRecurringSubscription(
  subscription: {
    status:
      | "trialing"
      | "active"
      | "grace_period"
      | "past_due"
      | "paused"
      | "canceled"
      | "expired"
      | "expired_fallback";
    billingProvider: string | null;
    providerSubscriptionRef: string | null;
    providerCustomerRef: string | null;
  } | null
): subscription is ProviderManagedRecurringSubscription {
  if (
    subscription === null ||
    subscription.billingProvider !== "cloudpayments" ||
    subscription.providerSubscriptionRef === null
  ) {
    return false;
  }
  return ["active", "grace_period", "past_due"].includes(subscription.status);
}

@Injectable()
export class ManageAssistantBillingSubscriptionService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly applyWorkspaceSubscriptionBillingEventService: ApplyWorkspaceSubscriptionBillingEventService,
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort
  ) {}

  async getState(userId: string): Promise<AssistantBillingSubscriptionManagementState> {
    const context = await this.resolveContext(userId);
    const providerManaged = isProviderManagedRecurringSubscription(context.subscription);
    const providerSnapshot =
      providerManaged && context.subscription?.providerSubscriptionRef
        ? await this.billingProviderPort
            .getManagedSubscription({
              providerSubscriptionRef: context.subscription.providerSubscriptionRef
            })
            .catch(() => null)
        : null;
    const paymentMethodLabel = await this.readLatestPaymentMethodLabel(
      context.assistant.workspaceId,
      context.subscription
    );
    const hasPendingCancelSyncFailure = await this.hasPendingCancelSyncFailure(
      context.assistant.workspaceId,
      context.subscription
    );
    const autoRenewDisabled =
      providerManaged &&
      context.subscription !== null &&
      (context.subscription.cancelAtPeriodEnd || hasPendingCancelSyncFailure);
    const managePaymentMethodMode =
      providerManaged && context.subscription?.status === "past_due"
        ? "provider_managed_recovery"
        : providerManaged
          ? "provider_portal"
          : "unavailable";

    return {
      planCode: context.subscription?.planCode ?? null,
      planDisplayName: context.planDisplayName,
      subscriptionStatus: context.subscription?.status ?? "unconfigured",
      billingProvider: context.subscription?.billingProvider ?? null,
      providerSubscriptionRef: context.subscription?.providerSubscriptionRef ?? null,
      autoRenewEnabled:
        providerManaged && context.subscription !== null ? !autoRenewDisabled : false,
      canDisableAutoRenew:
        providerManaged &&
        context.subscription !== null &&
        !autoRenewDisabled &&
        (context.subscription.status === "active" ||
          context.subscription.status === "grace_period" ||
          context.subscription.status === "past_due"),
      nextChargeAt: autoRenewDisabled
        ? null
        : (providerSnapshot?.nextChargeAt ??
          context.subscription?.currentPeriodEndsAt?.toISOString() ??
          null),
      currentPeriodEndsAt: context.subscription?.currentPeriodEndsAt?.toISOString() ?? null,
      paymentMethodLabel,
      managePaymentMethodUrl:
        managePaymentMethodMode === "unavailable"
          ? null
          : (providerSnapshot?.paymentMethodUpdateUrl ?? "https://my.cloudpayments.ru/"),
      managePaymentMethodMode,
      cancelUrl:
        providerSnapshot?.cancelUrl ??
        (providerManaged ? "https://my.cloudpayments.ru/unsubscribe" : null),
      warning: hasPendingCancelSyncFailure
        ? "Provider cancel succeeded, but PersAI is still synchronizing the new auto-renew state."
        : managePaymentMethodMode === "provider_managed_recovery"
          ? "CloudPayments handles card replacement through its own recovery form after a failed renewal."
          : null
    };
  }

  async disableAutoRenew(userId: string): Promise<AssistantBillingSubscriptionManagementState> {
    const context = await this.resolveContext(userId);
    const subscription = context.subscription;
    if (
      subscription === null ||
      subscription.billingProvider !== "cloudpayments" ||
      subscription.providerSubscriptionRef === null ||
      !["active", "grace_period", "past_due"].includes(subscription.status)
    ) {
      throw new NotFoundException("A provider-managed recurring subscription was not found.");
    }
    if (subscription.cancelAtPeriodEnd) {
      return this.getState(userId);
    }
    const cancellation = await this.billingProviderPort.cancelManagedSubscription({
      providerSubscriptionRef: subscription.providerSubscriptionRef
    });
    await this.applyWorkspaceSubscriptionBillingEventService.apply({
      workspaceId: context.assistant.workspaceId,
      userId,
      source: "provider",
      eventCode: "subscription_cancel_scheduled",
      eventRef: `cloudpayments:cancel_api:${subscription.providerSubscriptionRef}`,
      billingProvider: cancellation.providerKey,
      providerCustomerRef: subscription.providerCustomerRef,
      providerSubscriptionRef: subscription.providerSubscriptionRef,
      paidPlanCode: subscription.planCode,
      metadata: {
        providerEventType: "cancel_api",
        canceledAt: cancellation.canceledAt
      }
    });
    return this.getState(userId);
  }

  private async resolveContext(userId: string): Promise<{
    assistant: { workspaceId: string };
    subscription: {
      planCode: string;
      status:
        | "trialing"
        | "active"
        | "grace_period"
        | "past_due"
        | "paused"
        | "canceled"
        | "expired"
        | "expired_fallback";
      cancelAtPeriodEnd: boolean;
      billingProvider: string | null;
      providerCustomerRef: string | null;
      providerSubscriptionRef: string | null;
      currentPeriodEndsAt: Date | null;
    } | null;
    planDisplayName: string | null;
  }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const subscription = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId: assistant.workspaceId },
      select: {
        planCode: true,
        status: true,
        cancelAtPeriodEnd: true,
        billingProvider: true,
        providerCustomerRef: true,
        providerSubscriptionRef: true,
        currentPeriodEndsAt: true
      }
    });
    const plan =
      subscription?.planCode !== undefined && subscription.planCode !== null
        ? await this.assistantPlanCatalogRepository.findByCode(subscription.planCode)
        : null;
    return {
      assistant: {
        workspaceId: assistant.workspaceId
      },
      subscription,
      planDisplayName: plan?.displayName ?? null
    };
  }

  private async readLatestPaymentMethodLabel(
    workspaceId: string,
    subscription: {
      billingProvider: string | null;
      providerCustomerRef: string | null;
      providerSubscriptionRef: string | null;
      status:
        | "trialing"
        | "active"
        | "grace_period"
        | "past_due"
        | "paused"
        | "canceled"
        | "expired"
        | "expired_fallback";
    } | null
  ): Promise<string | null> {
    if (!isProviderManagedRecurringSubscription(subscription)) {
      return null;
    }
    const activeSubscription = subscription;
    const recentProviderEvents = await this.prisma.workspaceSubscriptionBillingEvent.findMany({
      where: {
        workspaceId,
        source: "provider",
        providerSubscriptionRef: activeSubscription.providerSubscriptionRef,
        ...(activeSubscription.providerCustomerRef !== null
          ? { providerCustomerRef: activeSubscription.providerCustomerRef }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        metadata: true
      }
    });
    const paymentMethod =
      recentProviderEvents
        .map((event) => toNullableString(asObject(event.metadata)?.providerPaymentMethod))
        .find((value) => value !== null) ?? null;
    return formatPaymentMethodLabel(paymentMethod);
  }

  private async hasPendingCancelSyncFailure(
    workspaceId: string,
    subscription: {
      billingProvider: string | null;
      providerCustomerRef: string | null;
      providerSubscriptionRef: string | null;
      status:
        | "trialing"
        | "active"
        | "grace_period"
        | "past_due"
        | "paused"
        | "canceled"
        | "expired"
        | "expired_fallback";
    } | null
  ): Promise<boolean> {
    if (!isProviderManagedRecurringSubscription(subscription)) {
      return false;
    }
    const recentCancelEvents = await this.prisma.workspaceSubscriptionBillingEvent.findMany({
      where: {
        workspaceId,
        source: "provider",
        eventCode: "subscription_cancel_scheduled",
        providerSubscriptionRef: subscription.providerSubscriptionRef,
        ...(subscription.providerCustomerRef !== null
          ? { providerCustomerRef: subscription.providerCustomerRef }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        applyStatus: true,
        metadata: true
      }
    });
    return recentCancelEvents.some(
      (event) =>
        event.applyStatus === "failed" &&
        toNullableString(asObject(event.metadata)?.providerEventType) === "cancel_api"
    );
  }
}
