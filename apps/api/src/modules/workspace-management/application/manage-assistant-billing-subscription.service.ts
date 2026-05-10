import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ASSISTANT_PLAN_CATALOG_REPOSITORY } from "../domain/assistant-plan-catalog.repository";
import type { AssistantPlanCatalogRepository } from "../domain/assistant-plan-catalog.repository";
import { ASSISTANT_REPOSITORY } from "../domain/assistant.repository";
import type { AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./apply-workspace-subscription-billing-event.service";
import { BILLING_PROVIDER_PORT, type BillingProviderPort } from "./billing-provider.port";
import { ManageAdminPlansService } from "./manage-admin-plans.service";
import { ManageAssistantPaymentIntentsService } from "./manage-assistant-payment-intents.service";
import { ManageWorkspaceSubscriptionLifecycleService } from "./manage-workspace-subscription-lifecycle.service";

type PublicPricingPlanState = Awaited<
  ReturnType<ManageAdminPlansService["listPublicPricingPlans"]>
>[number];

type AssistantBillingPlanChangeKind = "free" | "downgrade";

export type AssistantBillingScheduledPlanChangePreview = {
  targetPlanCode: string;
  targetPlanDisplayName: string;
  amountMinor: number | null;
  currency: string | null;
  billingPeriod: "month" | "year" | null;
  effectiveAt: string;
  nextChargeAt: string | null;
  changeKind: AssistantBillingPlanChangeKind;
};

export type AssistantBillingRecurringMigrationView = {
  status: "idle" | "in_progress" | "succeeded" | "failed";
  targetMethodClass: "card" | "sbp_qr" | null;
  failureReason: string | null;
  updatedAt: string | null;
};

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
  canEnableAutoRenew: boolean;
  enableAutoRenewMode: "resume_existing" | "bind_checkout" | "unavailable";
  canDisableAutoRenew: boolean;
  canScheduleDowngrade: boolean;
  canSwitchToFree: boolean;
  nextChargeAt: string | null;
  currentPeriodEndsAt: string | null;
  scheduledPlanChange: AssistantBillingScheduledPlanChangePreview | null;
  lastPaymentMethodLabel: string | null;
  autoRenewMethodLabel: string | null;
  recurringMigration: AssistantBillingRecurringMigrationView;
  managePaymentMethodUrl: string | null;
  managePaymentMethodMode: "provider_portal" | "provider_managed_recovery" | "unavailable";
  cancelUrl: string | null;
  warning: string | null;
};

export type EnableAutoRenewInput = {
  paymentMethodClass: "card";
  idempotencyKey: string;
  returnUrl: string;
};

export type ChangeAssistantBillingPlanInput = {
  planCode: string;
  paymentMethodClass: "card" | "sbp_qr";
  idempotencyKey: string;
  returnUrl: string;
};

export type AssistantBillingSubscriptionActionResult =
  | {
      mode: "subscription_updated";
      subscription: AssistantBillingSubscriptionManagementState;
    }
  | {
      mode: "checkout";
      paymentIntent: Awaited<
        ReturnType<ManageAssistantPaymentIntentsService["createPaymentIntent"]>
      >;
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

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableBillingPeriod(value: unknown): "month" | "year" | null {
  return value === "month" || value === "year" ? value : null;
}

function readPendingPlanChange(value: Prisma.JsonValue | null): PendingPlanChange | null {
  const row = asObject(value);
  const pending = asObject(row?.pendingPlanChange);
  if (pending === null) {
    return null;
  }
  const targetPlanCode = toNullableString(pending.targetPlanCode);
  const targetPlanDisplayName = toNullableString(pending.targetPlanDisplayName);
  const effectiveAt = toNullableString(pending.effectiveAt);
  const changeKind =
    pending.changeKind === "free" || pending.changeKind === "downgrade" ? pending.changeKind : null;
  if (
    targetPlanCode === null ||
    targetPlanDisplayName === null ||
    effectiveAt === null ||
    changeKind === null
  ) {
    return null;
  }
  return {
    targetPlanCode,
    targetPlanDisplayName,
    amountMinor: toNullableNumber(pending.amountMinor),
    currency: toNullableString(pending.currency),
    billingPeriod: toNullableBillingPeriod(pending.billingPeriod),
    effectiveAt,
    nextChargeAt: toNullableString(pending.nextChargeAt),
    changeKind
  };
}

function normalizePaymentMethodLabel(value: string): string {
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

function formatPaymentMethodLabel(input: {
  paymentMethod: string | null;
  cardType: string | null;
  cardLastFour: string | null;
}): string | null {
  if (input.paymentMethod !== null) {
    return normalizePaymentMethodLabel(input.paymentMethod);
  }
  if (input.cardType !== null && input.cardLastFour !== null) {
    return `${input.cardType} •••• ${input.cardLastFour}`;
  }
  if (input.cardLastFour !== null) {
    return `Bank card •••• ${input.cardLastFour}`;
  }
  if (input.cardType !== null) {
    return input.cardType;
  }
  return null;
}

function formatPaymentMethodClassLabel(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  switch (value) {
    case "card":
      return "Bank card";
    case "sbp_qr":
      return "SBP";
    default:
      return null;
  }
}

type ProviderManagedRecurringSubscription = {
  status: "active" | "grace_period" | "past_due";
  billingProvider: "cloudpayments";
  providerCustomerRef: string | null;
  providerSubscriptionRef: string;
};

type PendingPlanChange = AssistantBillingScheduledPlanChangePreview;

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

function canSchedulePaidDowngrade(
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
    cancelAtPeriodEnd: boolean;
  } | null
): subscription is ProviderManagedRecurringSubscription & { cancelAtPeriodEnd: false } {
  return isProviderManagedRecurringSubscription(subscription) && !subscription.cancelAtPeriodEnd;
}

@Injectable()
export class ManageAssistantBillingSubscriptionService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PLAN_CATALOG_REPOSITORY)
    private readonly assistantPlanCatalogRepository: AssistantPlanCatalogRepository,
    private readonly manageAdminPlansService: ManageAdminPlansService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly manageAssistantPaymentIntentsService: ManageAssistantPaymentIntentsService,
    private readonly manageWorkspaceSubscriptionLifecycleService: ManageWorkspaceSubscriptionLifecycleService,
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
    const hasPendingCancelSyncFailure = await this.hasPendingCancelSyncFailure(
      context.assistant.workspaceId,
      context.subscription
    );
    const autoRenewDisabled =
      providerManaged &&
      context.subscription !== null &&
      (context.subscription.cancelAtPeriodEnd || hasPendingCancelSyncFailure);
    const lastPaymentMethodLabel = await this.resolveLastPaymentMethodLabel(
      context.assistant.workspaceId,
      context.subscription
    );
    const autoRenewMethodClass = await this.ensureCanonicalAutoRenewMethodClass(
      context.assistant.workspaceId,
      context.subscription,
      providerManaged,
      autoRenewDisabled
    );
    const autoRenewMethodLabel =
      providerManaged && !autoRenewDisabled
        ? formatPaymentMethodClassLabel(autoRenewMethodClass)
        : null;
    const recurringMigration = this.buildRecurringMigrationView(context.subscription);
    const canEnableAutoRenew =
      context.subscription !== null &&
      ["active", "grace_period", "past_due", "canceled"].includes(context.subscription.status) &&
      ((!providerManaged && context.subscription.providerSubscriptionRef === null) ||
        (providerManaged && autoRenewDisabled));
    const enableAutoRenewMode =
      providerManaged && autoRenewDisabled
        ? "resume_existing"
        : canEnableAutoRenew
          ? "bind_checkout"
          : "unavailable";
    const managePaymentMethodMode =
      providerManaged && context.subscription?.status === "past_due"
        ? "provider_managed_recovery"
        : providerManaged
          ? "provider_portal"
          : "unavailable";
    const scheduledPlanChange =
      context.subscription === null ? null : readPendingPlanChange(context.subscription.metadata);
    const canScheduleDowngrade = canSchedulePaidDowngrade(context.subscription);
    const canSwitchToFree =
      context.subscription !== null &&
      ["active", "grace_period", "past_due", "canceled"].includes(context.subscription.status);

    return {
      planCode: context.subscription?.planCode ?? null,
      planDisplayName: context.planDisplayName,
      subscriptionStatus: context.subscription?.status ?? "unconfigured",
      billingProvider: context.subscription?.billingProvider ?? null,
      providerSubscriptionRef: context.subscription?.providerSubscriptionRef ?? null,
      autoRenewEnabled:
        providerManaged && context.subscription !== null ? !autoRenewDisabled : false,
      canEnableAutoRenew,
      enableAutoRenewMode,
      canDisableAutoRenew:
        providerManaged &&
        context.subscription !== null &&
        !autoRenewDisabled &&
        (context.subscription.status === "active" ||
          context.subscription.status === "grace_period" ||
          context.subscription.status === "past_due"),
      canScheduleDowngrade,
      canSwitchToFree,
      nextChargeAt: autoRenewDisabled
        ? null
        : (providerSnapshot?.nextChargeAt ??
          context.subscription?.currentPeriodEndsAt?.toISOString() ??
          null),
      currentPeriodEndsAt: context.subscription?.currentPeriodEndsAt?.toISOString() ?? null,
      scheduledPlanChange,
      lastPaymentMethodLabel,
      autoRenewMethodLabel,
      recurringMigration,
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
          : scheduledPlanChange?.changeKind === "free"
            ? "Your current paid access stays active until the end of the current period, then the workspace switches to FREE."
            : scheduledPlanChange !== null
              ? "Your current paid access stays active until the end of the current period, then the new plan takes over."
              : null
    };
  }

  parseEnableAutoRenewInput(body: unknown): EnableAutoRenewInput {
    const row = asObject(body);
    const paymentMethodClass = toNullableString(row?.paymentMethodClass);
    const idempotencyKey = toNullableString(row?.idempotencyKey);
    const returnUrl = toNullableString(row?.returnUrl);
    if (paymentMethodClass !== "card") {
      throw new BadRequestException("Only card binding is supported for enabling auto-renew.");
    }
    if (idempotencyKey === null || returnUrl === null) {
      throw new BadRequestException("idempotencyKey and returnUrl are required.");
    }
    return {
      paymentMethodClass,
      idempotencyKey,
      returnUrl
    };
  }

  parseChangePlanInput(body: unknown): ChangeAssistantBillingPlanInput {
    const row = asObject(body);
    const planCode = toNullableString(row?.planCode);
    const paymentMethodClass = toNullableString(row?.paymentMethodClass);
    const idempotencyKey = toNullableString(row?.idempotencyKey);
    const returnUrl = toNullableString(row?.returnUrl);
    if (planCode === null || idempotencyKey === null || returnUrl === null) {
      throw new BadRequestException("planCode, idempotencyKey, and returnUrl are required.");
    }
    if (paymentMethodClass !== "card" && paymentMethodClass !== "sbp_qr") {
      throw new BadRequestException("paymentMethodClass must be card or sbp_qr.");
    }
    return {
      planCode,
      paymentMethodClass,
      idempotencyKey,
      returnUrl
    };
  }

  async enableAutoRenew(
    userId: string,
    input: EnableAutoRenewInput
  ): Promise<AssistantBillingSubscriptionActionResult> {
    const context = await this.resolveContext(userId);
    const subscription = context.subscription;
    if (
      subscription === null ||
      !["active", "grace_period", "past_due", "canceled"].includes(subscription.status)
    ) {
      throw new NotFoundException("A paid subscription was not found for auto-renew management.");
    }
    if (
      subscription.billingProvider === "cloudpayments" &&
      subscription.providerSubscriptionRef !== null &&
      subscription.cancelAtPeriodEnd
    ) {
      const resumed = await this.billingProviderPort.resumeManagedSubscription({
        providerSubscriptionRef: subscription.providerSubscriptionRef
      });
      await this.applyWorkspaceSubscriptionBillingEventService.apply({
        workspaceId: context.assistant.workspaceId,
        userId,
        source: "provider",
        eventCode: "subscription_resumed",
        eventRef: `cloudpayments:resume_api:${subscription.providerSubscriptionRef}`,
        billingProvider: resumed.providerKey,
        providerCustomerRef: subscription.providerCustomerRef,
        providerSubscriptionRef: resumed.providerSubscriptionRef,
        paidPlanCode: subscription.planCode,
        metadata: {
          providerEventType: "resume_api"
        }
      });
      return {
        mode: "subscription_updated",
        subscription: await this.getState(userId)
      };
    }
    if (subscription.providerSubscriptionRef !== null) {
      return {
        mode: "subscription_updated",
        subscription: await this.getState(userId)
      };
    }
    const paymentIntent =
      await this.manageAssistantPaymentIntentsService.createAutoRenewBindPaymentIntent(
        userId,
        input
      );
    return {
      mode: "checkout",
      paymentIntent
    };
  }

  async changePlan(
    userId: string,
    input: ChangeAssistantBillingPlanInput
  ): Promise<AssistantBillingSubscriptionActionResult> {
    const context = await this.resolveContext(userId);
    const subscription = context.subscription;
    if (subscription === null || subscription.planCode === null) {
      return {
        mode: "checkout",
        paymentIntent: await this.manageAssistantPaymentIntentsService.createPaymentIntent(
          userId,
          input
        )
      };
    }
    const publicPlans = await this.manageAdminPlansService.listPublicPricingPlans();
    const currentPlan = publicPlans.find((plan) => plan.code === subscription.planCode) ?? null;
    const targetPlan = publicPlans.find((plan) => plan.code === input.planCode) ?? null;
    if (targetPlan === null) {
      throw new NotFoundException("Visible purchasable plan was not found.");
    }
    if (subscription.planCode === targetPlan.code) {
      throw new BadRequestException("Selected plan is already active for this workspace.");
    }
    const currentPrice = this.readPlanPrice(currentPlan);
    const targetPrice = this.readPlanPrice(targetPlan);
    const isPaidSubscription = currentPrice !== null;
    const isPaidTarget = targetPrice !== null;
    if (!isPaidSubscription) {
      return {
        mode: "checkout",
        paymentIntent: await this.manageAssistantPaymentIntentsService.createPaymentIntent(
          userId,
          input
        )
      };
    }
    if (!isPaidTarget) {
      await this.schedulePlanChange(userId, context, targetPlan, null, "free");
      return {
        mode: "subscription_updated",
        subscription: await this.getState(userId)
      };
    }
    const targetMinor = Math.round(targetPrice.amount * 100);
    if (
      currentPrice.currency !== targetPrice.currency ||
      currentPrice.billingPeriod !== targetPrice.billingPeriod
    ) {
      throw new BadRequestException(
        "Cross-period or cross-currency paid plan changes are not supported in this slice."
      );
    }
    if (currentPrice.currency === targetPrice.currency && targetMinor < currentPrice.amountMinor) {
      await this.schedulePlanChange(userId, context, targetPlan, targetPrice, "downgrade");
      return {
        mode: "subscription_updated",
        subscription: await this.getState(userId)
      };
    }
    const isManagedRecurringUpgrade =
      subscription.billingProvider === "cloudpayments" &&
      subscription.providerSubscriptionRef !== null &&
      ["active", "grace_period", "past_due", "canceled"].includes(subscription.status);
    const paymentIntent = isManagedRecurringUpgrade
      ? await this.manageAssistantPaymentIntentsService.createManagedRecurringUpgradePaymentIntent(
          userId,
          input
        )
      : await this.manageAssistantPaymentIntentsService.createPaymentIntent(userId, input);
    return {
      mode: "checkout",
      paymentIntent
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

  private readPlanPrice(plan: PublicPricingPlanState | null): {
    amount: number;
    amountMinor: number;
    currency: string;
    billingPeriod: "month" | "year";
  } | null {
    const price = plan?.presentation.price;
    if (
      price === undefined ||
      price === null ||
      typeof price.amount !== "number" ||
      price.amount <= 0 ||
      price.currency === null ||
      (price.billingPeriod !== "month" && price.billingPeriod !== "year")
    ) {
      return null;
    }
    return {
      amount: price.amount,
      amountMinor: Math.round(price.amount * 100),
      currency: price.currency,
      billingPeriod: price.billingPeriod
    };
  }

  private async schedulePlanChange(
    userId: string,
    context: Awaited<ReturnType<ManageAssistantBillingSubscriptionService["resolveContext"]>>,
    targetPlan: PublicPricingPlanState,
    targetPrice: ReturnType<ManageAssistantBillingSubscriptionService["readPlanPrice"]>,
    changeKind: AssistantBillingPlanChangeKind
  ): Promise<void> {
    const subscription = context.subscription;
    if (
      subscription === null ||
      !["active", "grace_period", "past_due", "canceled"].includes(subscription.status) ||
      subscription.currentPeriodEndsAt === null
    ) {
      throw new BadRequestException(
        "A paid subscription with an active billing period is required."
      );
    }
    if (
      changeKind === "downgrade" &&
      (!canSchedulePaidDowngrade(subscription) || targetPrice === null)
    ) {
      throw new BadRequestException(
        "Scheduled paid downgrade requires an active provider-managed recurring subscription."
      );
    }
    await this.manageWorkspaceSubscriptionLifecycleService.schedulePlanChangeAtPeriodEnd({
      workspaceId: context.assistant.workspaceId,
      userId,
      source: "manual",
      pendingPlanChange: {
        targetPlanCode: targetPlan.code,
        targetPlanDisplayName: targetPlan.displayName,
        amountMinor: targetPrice?.amountMinor ?? null,
        currency: targetPrice?.currency ?? null,
        billingPeriod: targetPrice?.billingPeriod ?? null,
        effectiveAt: subscription.currentPeriodEndsAt.toISOString(),
        nextChargeAt: targetPrice === null ? null : subscription.currentPeriodEndsAt.toISOString(),
        changeKind
      }
    });
    if (
      changeKind === "free" &&
      subscription.billingProvider === "cloudpayments" &&
      subscription.providerSubscriptionRef !== null &&
      !subscription.cancelAtPeriodEnd
    ) {
      await this.billingProviderPort.cancelManagedSubscription({
        providerSubscriptionRef: subscription.providerSubscriptionRef
      });
      await this.applyWorkspaceSubscriptionBillingEventService.apply({
        workspaceId: context.assistant.workspaceId,
        userId,
        source: "provider",
        eventCode: "subscription_cancel_scheduled",
        eventRef: `cloudpayments:cancel_for_plan_change:${subscription.providerSubscriptionRef}`,
        billingProvider: subscription.billingProvider,
        providerCustomerRef: subscription.providerCustomerRef,
        providerSubscriptionRef: subscription.providerSubscriptionRef,
        paidPlanCode: subscription.planCode,
        metadata: {
          providerEventType: "cancel_for_plan_change"
        }
      });
    }
    if (changeKind === "downgrade") {
      if (!canSchedulePaidDowngrade(subscription) || targetPrice === null) {
        throw new BadRequestException(
          "Scheduled paid downgrade requires an active provider-managed recurring subscription."
        );
      }
      const recurringSubscription = subscription;
      const scheduledTargetPrice = targetPrice;
      const scheduledEffectiveAt = recurringSubscription.currentPeriodEndsAt;
      if (scheduledEffectiveAt === null) {
        throw new BadRequestException(
          "A paid subscription with an active billing period is required."
        );
      }
      try {
        await this.billingProviderPort.updateManagedSubscription({
          providerSubscriptionRef: recurringSubscription.providerSubscriptionRef,
          amountMinor: scheduledTargetPrice.amountMinor,
          currency: scheduledTargetPrice.currency,
          startDate: scheduledEffectiveAt.toISOString(),
          interval: "Month",
          period: scheduledTargetPrice.billingPeriod === "year" ? 12 : 1,
          maxPeriods: null
        });
      } catch (error) {
        await this.manageWorkspaceSubscriptionLifecycleService.clearScheduledPlanChange({
          workspaceId: context.assistant.workspaceId,
          userId,
          source: "manual"
        });
        throw error;
      }
    }
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
      metadata: Prisma.JsonValue | null;
      lastPaymentMethodClass: "card" | "sbp_qr" | null;
      autoRenewMethodClass: "card" | "sbp_qr" | null;
      recurringMigrationStatus: "idle" | "in_progress" | "succeeded" | "failed";
      recurringMigrationUpdatedAt: Date | null;
      recurringMigrationTargetMethodClass: "card" | "sbp_qr" | null;
      recurringMigrationFailureReason: string | null;
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
        currentPeriodEndsAt: true,
        metadata: true,
        lastPaymentMethodClass: true,
        autoRenewMethodClass: true,
        recurringMigrationStatus: true,
        recurringMigrationUpdatedAt: true,
        recurringMigrationTargetMethodClass: true,
        recurringMigrationFailureReason: true
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

  private buildRecurringMigrationView(
    subscription: {
      recurringMigrationStatus: "idle" | "in_progress" | "succeeded" | "failed";
      recurringMigrationTargetMethodClass: "card" | "sbp_qr" | null;
      recurringMigrationFailureReason: string | null;
      recurringMigrationUpdatedAt: Date | null;
    } | null
  ): AssistantBillingRecurringMigrationView {
    if (subscription === null) {
      return {
        status: "idle",
        targetMethodClass: null,
        failureReason: null,
        updatedAt: null
      };
    }
    return {
      status: subscription.recurringMigrationStatus,
      targetMethodClass: subscription.recurringMigrationTargetMethodClass,
      failureReason: subscription.recurringMigrationFailureReason,
      updatedAt: subscription.recurringMigrationUpdatedAt?.toISOString() ?? null
    };
  }

  private async ensureCanonicalAutoRenewMethodClass(
    workspaceId: string,
    subscription: {
      billingProvider: string | null;
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
      autoRenewMethodClass: "card" | "sbp_qr" | null;
    } | null,
    providerManaged: boolean,
    autoRenewDisabled: boolean
  ): Promise<"card" | "sbp_qr" | null> {
    if (
      subscription === null ||
      !providerManaged ||
      autoRenewDisabled ||
      subscription.billingProvider !== "cloudpayments"
    ) {
      return subscription?.autoRenewMethodClass ?? null;
    }
    if (subscription.autoRenewMethodClass !== null) {
      return subscription.autoRenewMethodClass;
    }
    await this.prisma.workspaceSubscription.update({
      where: { workspaceId },
      data: { autoRenewMethodClass: "card" }
    });
    return "card";
  }

  private async resolveLastPaymentMethodLabel(
    workspaceId: string,
    subscription: {
      planCode: string;
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
      lastPaymentMethodClass: "card" | "sbp_qr" | null;
    } | null
  ): Promise<string | null> {
    if (subscription !== null && subscription.lastPaymentMethodClass !== null) {
      return formatPaymentMethodClassLabel(subscription.lastPaymentMethodClass);
    }
    return this.readLatestPaymentMethodLabel(workspaceId, subscription);
  }

  private async readLatestPaymentMethodLabel(
    workspaceId: string,
    subscription: {
      planCode: string;
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
      lastPaymentMethodClass?: "card" | "sbp_qr" | null;
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
    const paymentMethodDetails = recentProviderEvents
      .map((event) => {
        const metadata = asObject(event.metadata);
        return {
          paymentMethod: toNullableString(metadata?.providerPaymentMethod),
          cardType: toNullableString(metadata?.providerCardType),
          cardLastFour: toNullableString(metadata?.providerCardLastFour)
        };
      })
      .find(
        (value) =>
          value.paymentMethod !== null || value.cardType !== null || value.cardLastFour !== null
      ) ?? {
      paymentMethod: null,
      cardType: null,
      cardLastFour: null
    };
    const directLabel = formatPaymentMethodLabel(paymentMethodDetails);
    if (directLabel !== null) {
      return directLabel;
    }
    const latestSucceededIntent = await this.prisma.workspacePaymentIntent.findFirst({
      where: {
        workspaceId,
        status: "succeeded",
        billingProvider: "cloudpayments",
        targetPlanCode: activeSubscription.planCode
      },
      orderBy: { createdAt: "desc" },
      select: {
        paymentMethodClass: true
      }
    });
    return formatPaymentMethodClassLabel(latestSucceededIntent?.paymentMethodClass ?? null);
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
