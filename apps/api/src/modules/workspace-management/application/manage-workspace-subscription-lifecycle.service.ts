import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { Prisma, WorkspaceSubscriptionStatus } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ManageAdminBillingLifecycleSettingsService } from "./manage-admin-billing-lifecycle-settings.service";
import { MaterializeWorkspacePaidActivationService } from "./materialize-workspace-paid-activation.service";
import { resolveStoredPlanLifecyclePolicy } from "./plan-lifecycle-policy";
import { ScheduleBillingLifecycleNotificationsService } from "./schedule-billing-lifecycle-notifications.service";

export type WorkspaceSubscriptionLifecycleEventSource = "system" | "admin" | "provider" | "manual";

export type LifecycleEventRefs = {
  relatedPaymentIntentRef?: string | null;
  relatedProviderEventRef?: string | null;
  metadata?: Record<string, unknown>;
};

type SubscriptionSnapshot = {
  id: string;
  workspaceId: string;
  planCode: string;
  status: WorkspaceSubscriptionStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  graceStartedAt: Date | null;
  graceEndsAt: Date | null;
  currentPeriodStartedAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: Prisma.JsonValue | null;
};

@Injectable()
export class ManageWorkspaceSubscriptionLifecycleService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly billingLifecycleSettingsService: ManageAdminBillingLifecycleSettingsService,
    private readonly scheduleBillingLifecycleNotificationsService: ScheduleBillingLifecycleNotificationsService,
    @Inject(forwardRef(() => MaterializeWorkspacePaidActivationService))
    private readonly materializeWorkspacePaidActivationService: MaterializeWorkspacePaidActivationService
  ) {}

  private fallbackProviderResetData(): Pick<
    SubscriptionSnapshot,
    "billingProvider" | "providerCustomerRef" | "providerSubscriptionRef"
  > {
    return {
      billingProvider: null,
      providerCustomerRef: null,
      providerSubscriptionRef: null
    };
  }

  async startPaidGrace(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    const settings = await this.billingLifecycleSettingsService.resolveSettings();
    const now = new Date();
    const graceEndsAt = new Date(now.getTime() + settings.gracePeriodDays * 86_400_000);

    const lifecycleEventIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (current.status !== "active" && current.status !== "past_due") {
        throw new BadRequestException("Paid renewal failure can only start grace from paid state.");
      }
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          status: "grace_period",
          graceStartedAt: now,
          graceEndsAt,
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "grace_period",
            lifecycleReason: "paid_renewal_failed",
            paidPlanCode: current.planCode,
            graceStartedAt: now.toISOString(),
            graceEndsAt: graceEndsAt.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "renewal_failed",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "grace_started",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async extendTrial(input: {
    workspaceId: string;
    userId: string | null;
    newTrialEndsAt: string;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    const nextTrialEndsAt = new Date(input.newTrialEndsAt);
    if (Number.isNaN(nextTrialEndsAt.getTime())) {
      throw new BadRequestException("newTrialEndsAt must be a valid ISO datetime.");
    }

    const lifecycleEventIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (current.status !== "trialing") {
        throw new BadRequestException(
          "Trial can only be extended while the workspace is trialing."
        );
      }
      if (current.trialEndsAt === null) {
        throw new BadRequestException("Trial extension requires an existing trial end date.");
      }
      if (nextTrialEndsAt.getTime() <= current.trialEndsAt.getTime()) {
        throw new BadRequestException("Extended trial end must be after the current trial end.");
      }

      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          trialEndsAt: nextTrialEndsAt,
          currentPeriodEndsAt: nextTrialEndsAt,
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "trialing",
            lifecycleReason: "admin_trial_extended",
            trialExtendedAt: new Date().toISOString(),
            trialEndsAt: nextTrialEndsAt.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "trial_extended",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async grantGrace(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    const settings = await this.billingLifecycleSettingsService.resolveSettings();
    const now = new Date();
    const graceEndsAt = new Date(now.getTime() + settings.gracePeriodDays * 86_400_000);

    const lifecycleEventIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (current.status !== "active" && current.status !== "past_due") {
        throw new BadRequestException(
          "Grace can only be granted when the workspace is in an active paid state."
        );
      }

      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          status: "grace_period",
          graceStartedAt: now,
          graceEndsAt,
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "grace_period",
            lifecycleReason: "admin_grace_granted",
            paidPlanCode: current.planCode,
            graceStartedAt: now.toISOString(),
            graceEndsAt: graceEndsAt.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "grace_started",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async extendGrace(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    const settings = await this.billingLifecycleSettingsService.resolveSettings();
    const now = new Date();

    const lifecycleEventIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (current.status !== "grace_period") {
        throw new BadRequestException(
          "Grace can only be extended while the workspace is in grace."
        );
      }
      if (current.graceEndsAt === null) {
        throw new BadRequestException("Grace extension requires an existing grace end date.");
      }

      const base = current.graceEndsAt.getTime() > now.getTime() ? current.graceEndsAt : now;
      const nextGraceEndsAt = new Date(base.getTime() + settings.gracePeriodDays * 86_400_000);
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          graceEndsAt: nextGraceEndsAt,
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "grace_period",
            lifecycleReason: "admin_grace_extended",
            paidPlanCode: current.planCode,
            graceStartedAt: current.graceStartedAt?.toISOString() ?? null,
            graceEndsAt: nextGraceEndsAt.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "grace_extended",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async expireGrace(input: {
    workspaceId: string;
    userId: string | null;
    source?: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const settings = await this.billingLifecycleSettingsService.resolveSettings();

    const lifecycleEventIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (current.status !== "grace_period") {
        return;
      }
      if (current.graceEndsAt === null || current.graceEndsAt.getTime() > now.getTime()) {
        return;
      }

      const fallbackPlanCode = await this.resolvePaidFallbackPlanCode(
        current.planCode,
        settings.globalFallbackPlanCode
      );
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          planCode: fallbackPlanCode,
          status: "expired_fallback",
          graceStartedAt: current.graceStartedAt,
          graceEndsAt: current.graceEndsAt,
          currentPeriodStartedAt: now,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          ...this.fallbackProviderResetData(),
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "expired_fallback",
            lifecycleReason: "grace_expired_without_payment",
            previousPaidPlanCode: current.planCode,
            fallbackPlanCode,
            graceStartedAt: current.graceStartedAt?.toISOString() ?? null,
            graceEndsAt: current.graceEndsAt?.toISOString() ?? null
          })
        }
      });

      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "grace_expired",
          previous: current,
          next: updated,
          source: input.source ?? "system",
          refs: input.refs
        })
      );
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "fallback_applied",
          previous: current,
          next: updated,
          source: input.source ?? "system",
          refs: input.refs
        })
      );
    });
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async recoverPayment(input: {
    workspaceId: string;
    userId: string | null;
    paidPlanCode: string;
    currentPeriodStartedAt: string;
    currentPeriodEndsAt: string;
    billingProvider?: string | null;
    providerCustomerRef?: string | null;
    providerSubscriptionRef?: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    await this.applyActivePaidTransition({
      workspaceId: input.workspaceId,
      userId: input.userId,
      paidPlanCode: input.paidPlanCode,
      currentPeriodStartedAt: input.currentPeriodStartedAt,
      currentPeriodEndsAt: input.currentPeriodEndsAt,
      billingProvider: input.billingProvider ?? null,
      providerCustomerRef: input.providerCustomerRef ?? null,
      providerSubscriptionRef: input.providerSubscriptionRef ?? null,
      source: input.source,
      refs: input.refs,
      eventCode: "payment_recovered",
      lifecycleReason: "payment_recovered"
    });
  }

  async activatePaidSubscription(input: {
    workspaceId: string;
    userId: string | null;
    paidPlanCode: string;
    currentPeriodStartedAt: string;
    currentPeriodEndsAt: string;
    billingProvider?: string | null;
    providerCustomerRef?: string | null;
    providerSubscriptionRef?: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
    eventCode: "payment_activated" | "renewal_succeeded";
    lifecycleReason: "payment_activated" | "renewal_succeeded";
  }): Promise<void> {
    await this.applyActivePaidTransition({
      workspaceId: input.workspaceId,
      userId: input.userId,
      paidPlanCode: input.paidPlanCode,
      currentPeriodStartedAt: input.currentPeriodStartedAt,
      currentPeriodEndsAt: input.currentPeriodEndsAt,
      billingProvider: input.billingProvider ?? null,
      providerCustomerRef: input.providerCustomerRef ?? null,
      providerSubscriptionRef: input.providerSubscriptionRef ?? null,
      source: input.source,
      refs: input.refs,
      eventCode: input.eventCode,
      lifecycleReason: input.lifecycleReason
    });
  }

  async schedulePaidCancellationAtPeriodEnd(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (
        current.status !== "active" &&
        current.status !== "grace_period" &&
        current.status !== "past_due"
      ) {
        throw new BadRequestException(
          "Auto-renew can only be disabled for a paid subscription state."
        );
      }
      if (current.cancelAtPeriodEnd) {
        return;
      }
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          cancelAtPeriodEnd: true,
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: current.status,
            lifecycleReason: "auto_renew_disabled",
            cancelAtPeriodEnd: true,
            autoRenewDisabledAt: new Date().toISOString()
          })
        }
      });
      await this.appendLifecycleEvent(tx, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        subscriptionId: current.id,
        eventCode: "auto_renew_disabled",
        previous: current,
        next: updated,
        source: input.source,
        refs: input.refs
      });
    });
  }

  async applyCancelledPaidPeriodEndFallback(input: {
    workspaceId: string;
    userId: string | null;
    source?: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const settings = await this.billingLifecycleSettingsService.resolveSettings();
    const lifecycleEventIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (!current.cancelAtPeriodEnd) {
        return;
      }
      if (
        current.currentPeriodEndsAt === null ||
        current.currentPeriodEndsAt.getTime() > now.getTime()
      ) {
        return;
      }
      const fallbackPlanCode = await this.resolvePaidFallbackPlanCode(
        current.planCode,
        settings.globalFallbackPlanCode
      );
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          planCode: fallbackPlanCode,
          status: "expired_fallback",
          cancelAtPeriodEnd: false,
          graceStartedAt: null,
          graceEndsAt: null,
          currentPeriodStartedAt: now,
          currentPeriodEndsAt: null,
          ...this.fallbackProviderResetData(),
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "expired_fallback",
            lifecycleReason: "canceled_paid_period_ended",
            previousPaidPlanCode: current.planCode,
            fallbackPlanCode,
            paidPeriodEndedAt: current.currentPeriodEndsAt.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "subscription_canceled",
          previous: current,
          next: updated,
          source: input.source ?? "system",
          refs: input.refs
        })
      );
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "fallback_applied",
          previous: current,
          next: updated,
          source: input.source ?? "system",
          refs: input.refs
        })
      );
    });

    if (lifecycleEventIds.length === 0) {
      return;
    }
    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async applyImmediatePaidFallback(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
    lifecycleReason: "payment_reversed";
    eventCode: "payment_reversed";
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const settings = await this.billingLifecycleSettingsService.resolveSettings();
    const lifecycleEventIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      const fallbackPlanCode = await this.resolvePaidFallbackPlanCode(
        current.planCode,
        settings.globalFallbackPlanCode
      );
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          planCode: fallbackPlanCode,
          status: "expired_fallback",
          graceStartedAt: current.graceStartedAt,
          graceEndsAt: current.graceEndsAt,
          currentPeriodStartedAt: now,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          ...this.fallbackProviderResetData(),
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "expired_fallback",
            lifecycleReason: input.lifecycleReason,
            previousPaidPlanCode: current.planCode,
            fallbackPlanCode,
            reversedAt: now.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: input.eventCode,
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "fallback_applied",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });

    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async applyFallbackNow(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const settings = await this.billingLifecycleSettingsService.resolveSettings();
    const lifecycleEventIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      if (current.status === "expired_fallback") {
        throw new BadRequestException("Workspace is already on the fallback plan.");
      }

      const fallbackPlanCode =
        current.status === "trialing"
          ? await this.resolveTrialFallbackPlanCode(current.planCode)
          : await this.resolvePaidFallbackPlanCode(
              current.planCode,
              settings.globalFallbackPlanCode
            );
      const lifecycleReason =
        current.status === "trialing" ? "admin_trial_fallback_now" : "admin_paid_fallback_now";
      const updated = await tx.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: {
          planCode: fallbackPlanCode,
          status: "expired_fallback",
          currentPeriodStartedAt: now,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          ...this.fallbackProviderResetData(),
          metadata: this.mergeMetadata(current.metadata, {
            schema: "persai.subscriptionLifecycle.v1",
            lifecycleState: "expired_fallback",
            lifecycleReason,
            fallbackPlanCode,
            previousPaidPlanCode: current.status === "trialing" ? null : current.planCode,
            trialPlanCode: current.status === "trialing" ? current.planCode : null,
            appliedAt: now.toISOString()
          })
        }
      });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "fallback_applied",
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });

    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  async recordBillingReminder(input: {
    workspaceId: string;
    userId: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs?: LifecycleEventRefs;
  }): Promise<void> {
    const lifecycleEventIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await this.requireWorkspaceSubscription(tx, input.workspaceId);
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: current.id,
          eventCode: "billing_reminder_requested",
          previous: current,
          next: current,
          source: input.source,
          refs: input.refs
        })
      );
    });
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  private async resolvePaidFallbackPlanCode(
    paidPlanCode: string,
    globalFallbackPlanCode: string | null
  ): Promise<string> {
    const paidPlan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: paidPlanCode },
      select: { billingProviderHints: true }
    });
    const planFallbackCode =
      paidPlan === null
        ? null
        : resolveStoredPlanLifecyclePolicy(paidPlan.billingProviderHints).paidFallbackPlanCode;
    const fallbackPlanCode = planFallbackCode ?? globalFallbackPlanCode;
    if (fallbackPlanCode === null) {
      throw new BadRequestException("Billing lifecycle fallback plan is not configured.");
    }
    const fallbackPlan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: fallbackPlanCode },
      select: { status: true }
    });
    if (fallbackPlan === null || fallbackPlan.status !== "active") {
      throw new BadRequestException("Billing lifecycle fallback plan must be active.");
    }
    return fallbackPlanCode;
  }

  private async resolveTrialFallbackPlanCode(trialPlanCode: string): Promise<string> {
    const trialPlan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: trialPlanCode },
      select: { billingProviderHints: true }
    });
    const fallbackPlanCode =
      trialPlan === null
        ? null
        : resolveStoredPlanLifecyclePolicy(trialPlan.billingProviderHints).trialFallbackPlanCode;
    if (fallbackPlanCode === null) {
      throw new BadRequestException("Trial fallback plan is not configured.");
    }
    const fallbackPlan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: fallbackPlanCode },
      select: { status: true }
    });
    if (fallbackPlan === null || fallbackPlan.status !== "active") {
      throw new BadRequestException("Trial fallback plan must be active.");
    }
    return fallbackPlanCode;
  }

  private async applyActivePaidTransition(input: {
    workspaceId: string;
    userId: string | null;
    paidPlanCode: string;
    currentPeriodStartedAt: string;
    currentPeriodEndsAt: string;
    billingProvider: string | null;
    providerCustomerRef: string | null;
    providerSubscriptionRef: string | null;
    source: WorkspaceSubscriptionLifecycleEventSource;
    refs: LifecycleEventRefs | undefined;
    eventCode: "payment_recovered" | "payment_activated" | "renewal_succeeded";
    lifecycleReason: "payment_recovered" | "payment_activated" | "renewal_succeeded";
  }): Promise<void> {
    await this.assertPaidPlanIsActive(input.paidPlanCode);
    const { periodStartedAt, periodEndsAt } = this.parseActivePaidPeriod(
      input.currentPeriodStartedAt,
      input.currentPeriodEndsAt
    );

    const lifecycleEventIds: string[] = [];
    const transitionedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.workspaceSubscription.findUnique({
        where: { workspaceId: input.workspaceId }
      });
      const updated =
        current === null
          ? await tx.workspaceSubscription.create({
              data: {
                workspaceId: input.workspaceId,
                planCode: input.paidPlanCode,
                status: "active",
                trialStartedAt: null,
                trialEndsAt: null,
                graceStartedAt: null,
                graceEndsAt: null,
                currentPeriodStartedAt: periodStartedAt,
                currentPeriodEndsAt: periodEndsAt,
                cancelAtPeriodEnd: false,
                billingProvider: input.billingProvider,
                providerCustomerRef: input.providerCustomerRef,
                providerSubscriptionRef: input.providerSubscriptionRef,
                metadata: {
                  schema: "persai.subscriptionLifecycle.v1",
                  lifecycleState: "active_paid",
                  lifecycleReason: input.lifecycleReason,
                  paidPlanCode: input.paidPlanCode,
                  currentPeriodStartedAt: periodStartedAt.toISOString(),
                  currentPeriodEndsAt: periodEndsAt.toISOString(),
                  transitionedAt: transitionedAt.toISOString()
                }
              }
            })
          : await tx.workspaceSubscription.update({
              where: { workspaceId: input.workspaceId },
              data: {
                planCode: input.paidPlanCode,
                status: "active",
                trialStartedAt: null,
                trialEndsAt: null,
                graceStartedAt: null,
                graceEndsAt: null,
                currentPeriodStartedAt: periodStartedAt,
                currentPeriodEndsAt: periodEndsAt,
                cancelAtPeriodEnd: false,
                billingProvider: input.billingProvider ?? current.billingProvider,
                providerCustomerRef: input.providerCustomerRef ?? current.providerCustomerRef,
                providerSubscriptionRef:
                  input.providerSubscriptionRef ?? current.providerSubscriptionRef,
                metadata: this.mergeMetadata(current.metadata, {
                  schema: "persai.subscriptionLifecycle.v1",
                  lifecycleState: "active_paid",
                  lifecycleReason: input.lifecycleReason,
                  paidPlanCode: input.paidPlanCode,
                  currentPeriodStartedAt: periodStartedAt.toISOString(),
                  currentPeriodEndsAt: periodEndsAt.toISOString(),
                  transitionedAt: transitionedAt.toISOString()
                })
              }
            });
      lifecycleEventIds.push(
        await this.appendLifecycleEvent(tx, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          subscriptionId: updated.id,
          eventCode: input.eventCode,
          previous: current,
          next: updated,
          source: input.source,
          refs: input.refs
        })
      );
    });

    await this.markWorkspaceAssistantsConfigDirty(input.workspaceId);
    await this.materializeWorkspacePaidActivationService.execute(input.workspaceId);
    await this.scheduleBillingLifecycleNotificationsService.scheduleForLifecycleEventIds(
      lifecycleEventIds
    );
  }

  private async assertPaidPlanIsActive(paidPlanCode: string): Promise<void> {
    const paidPlan = await this.prisma.planCatalogPlan.findUnique({
      where: { code: paidPlanCode },
      select: { status: true }
    });
    if (paidPlan === null || paidPlan.status !== "active") {
      throw new BadRequestException("paidPlanCode must reference an active plan.");
    }
  }

  private parseActivePaidPeriod(
    currentPeriodStartedAt: string,
    currentPeriodEndsAt: string
  ): { periodStartedAt: Date; periodEndsAt: Date } {
    const periodStartedAt = new Date(currentPeriodStartedAt);
    const periodEndsAt = new Date(currentPeriodEndsAt);
    if (Number.isNaN(periodStartedAt.getTime()) || Number.isNaN(periodEndsAt.getTime())) {
      throw new BadRequestException("Recovery period dates must be valid ISO datetimes.");
    }
    if (periodEndsAt.getTime() <= periodStartedAt.getTime()) {
      throw new BadRequestException("Recovery period end must be after period start.");
    }
    return { periodStartedAt, periodEndsAt };
  }

  private async requireWorkspaceSubscription(
    tx: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<SubscriptionSnapshot> {
    const subscription = await tx.workspaceSubscription.findUnique({
      where: { workspaceId }
    });
    if (subscription === null) {
      throw new NotFoundException("Workspace subscription not found.");
    }
    return subscription;
  }

  private async appendLifecycleEvent(
    tx: Prisma.TransactionClient,
    input: {
      workspaceId: string;
      userId: string | null;
      subscriptionId: string;
      eventCode: string;
      previous: SubscriptionSnapshot | null;
      next: SubscriptionSnapshot;
      source: WorkspaceSubscriptionLifecycleEventSource;
      refs?: LifecycleEventRefs | undefined;
    }
  ): Promise<string> {
    const event = await tx.workspaceSubscriptionLifecycleEvent.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        eventCode: input.eventCode,
        previousStatus: input.previous?.status ?? null,
        nextStatus: input.next.status,
        previousPlanCode: input.previous?.planCode ?? null,
        nextPlanCode: input.next.planCode,
        previousPeriodStartedAt: input.previous?.currentPeriodStartedAt ?? null,
        previousPeriodEndsAt: input.previous?.currentPeriodEndsAt ?? null,
        nextPeriodStartedAt: input.next.currentPeriodStartedAt,
        nextPeriodEndsAt: input.next.currentPeriodEndsAt,
        source: input.source,
        relatedPaymentIntentRef: input.refs?.relatedPaymentIntentRef ?? null,
        relatedProviderEventRef: input.refs?.relatedProviderEventRef ?? null,
        metadata: (input.refs?.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
    return event.id;
  }

  private mergeMetadata(
    current: Prisma.JsonValue | null,
    patch: Record<string, unknown>
  ): Prisma.InputJsonValue {
    const base =
      current !== null && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    return {
      ...base,
      ...patch
    } as Prisma.InputJsonValue;
  }

  private async markWorkspaceAssistantsConfigDirty(workspaceId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: { workspaceId },
      data: { configDirtyAt: new Date() }
    });
  }
}
