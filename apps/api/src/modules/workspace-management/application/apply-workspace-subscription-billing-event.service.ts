import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, WorkspaceSubscriptionLifecycleEventSource } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ManageWorkspaceSubscriptionLifecycleService } from "./manage-workspace-subscription-lifecycle.service";

export type WorkspaceSubscriptionBillingEventCode =
  | "payment_activated"
  | "renewal_succeeded"
  | "renewal_failed"
  | "payment_recovered"
  | "payment_reversed"
  | "subscription_cancel_scheduled";

export type ApplyWorkspaceSubscriptionBillingEventInput = {
  workspaceId: string;
  userId: string | null;
  source: Exclude<WorkspaceSubscriptionLifecycleEventSource, "system">;
  eventCode: WorkspaceSubscriptionBillingEventCode;
  eventRef?: string | null;
  paymentIntentRef?: string | null;
  billingProvider?: string | null;
  providerCustomerRef?: string | null;
  providerSubscriptionRef?: string | null;
  paidPlanCode?: string | null;
  currentPeriodStartedAt?: string | null;
  currentPeriodEndsAt?: string | null;
  metadata?: Record<string, unknown>;
};

type CurrentSubscriptionSnapshot = {
  id: string;
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
  currentPeriodStartedAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
};

@Injectable()
export class ApplyWorkspaceSubscriptionBillingEventService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly manageWorkspaceSubscriptionLifecycleService: ManageWorkspaceSubscriptionLifecycleService
  ) {}

  async apply(
    input: ApplyWorkspaceSubscriptionBillingEventInput
  ): Promise<{ status: "applied" | "duplicate" | "ignored"; billingEventId: string }> {
    const existing =
      input.eventRef === undefined || input.eventRef === null || input.eventRef.trim().length === 0
        ? null
        : await this.prisma.workspaceSubscriptionBillingEvent.findUnique({
            where: {
              source_eventRef: {
                source: input.source,
                eventRef: input.eventRef.trim()
              }
            }
          });

    if (existing?.applyStatus === "applied") {
      return { status: "duplicate", billingEventId: existing.id };
    }

    const current = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId: input.workspaceId },
      select: {
        id: true,
        planCode: true,
        status: true,
        currentPeriodStartedAt: true,
        currentPeriodEndsAt: true,
        cancelAtPeriodEnd: true,
        billingProvider: true,
        providerCustomerRef: true,
        providerSubscriptionRef: true
      }
    });
    const billingEvent =
      existing ??
      (await this.prisma.workspaceSubscriptionBillingEvent.create({
        data: this.toBillingEventCreateInput(input, current?.id ?? null)
      }));

    try {
      if (current !== null && this.shouldIgnore(current, input)) {
        await this.prisma.workspaceSubscriptionBillingEvent.update({
          where: { id: billingEvent.id },
          data: {
            applyStatus: "ignored",
            appliedAt: new Date(),
            failedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        return { status: "ignored", billingEventId: billingEvent.id };
      }
      await this.applyToLifecycle(current, input, billingEvent.id);
      const appliedSubscription = await this.prisma.workspaceSubscription.findUnique({
        where: { workspaceId: input.workspaceId },
        select: { id: true }
      });
      await this.prisma.workspaceSubscriptionBillingEvent.update({
        where: { id: billingEvent.id },
        data: {
          subscriptionId: appliedSubscription?.id ?? current?.id ?? null,
          applyStatus: "applied",
          appliedAt: new Date(),
          failedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      return { status: "applied", billingEventId: billingEvent.id };
    } catch (error) {
      await this.prisma.workspaceSubscriptionBillingEvent.update({
        where: { id: billingEvent.id },
        data: {
          applyStatus: "failed",
          failedAt: new Date(),
          lastErrorCode: this.resolveErrorCode(error),
          lastErrorMessage:
            error instanceof Error ? error.message : "Unknown billing event failure."
        }
      });
      throw error;
    }
  }

  private async applyToLifecycle(
    current: CurrentSubscriptionSnapshot | null,
    input: ApplyWorkspaceSubscriptionBillingEventInput,
    billingEventId: string
  ): Promise<void> {
    const refs = {
      relatedPaymentIntentRef: input.paymentIntentRef ?? null,
      relatedProviderEventRef:
        input.source === "provider" ? (input.eventRef?.trim() ?? null) : null,
      metadata: {
        workspaceSubscriptionBillingEventId: billingEventId,
        ...(input.metadata ?? {})
      }
    };

    switch (input.eventCode) {
      case "renewal_failed":
        this.assertCurrentSubscriptionExists(current);
        await this.manageWorkspaceSubscriptionLifecycleService.startPaidGrace({
          workspaceId: input.workspaceId,
          userId: input.userId,
          source: input.source,
          refs
        });
        return;
      case "payment_recovered":
        await this.manageWorkspaceSubscriptionLifecycleService.recoverPayment({
          workspaceId: input.workspaceId,
          userId: input.userId,
          paidPlanCode: this.requireString(input.paidPlanCode, "paidPlanCode"),
          currentPeriodStartedAt: this.requireString(
            input.currentPeriodStartedAt,
            "currentPeriodStartedAt"
          ),
          currentPeriodEndsAt: this.requireString(input.currentPeriodEndsAt, "currentPeriodEndsAt"),
          billingProvider: input.billingProvider ?? current?.billingProvider ?? null,
          providerCustomerRef: input.providerCustomerRef ?? current?.providerCustomerRef ?? null,
          providerSubscriptionRef:
            input.providerSubscriptionRef ?? current?.providerSubscriptionRef ?? null,
          source: input.source,
          refs
        });
        return;
      case "payment_activated":
      case "renewal_succeeded":
        await this.manageWorkspaceSubscriptionLifecycleService.activatePaidSubscription({
          workspaceId: input.workspaceId,
          userId: input.userId,
          paidPlanCode: this.requireString(input.paidPlanCode, "paidPlanCode"),
          currentPeriodStartedAt: this.requireString(
            input.currentPeriodStartedAt,
            "currentPeriodStartedAt"
          ),
          currentPeriodEndsAt: this.requireString(input.currentPeriodEndsAt, "currentPeriodEndsAt"),
          billingProvider: input.billingProvider ?? current?.billingProvider ?? null,
          providerCustomerRef: input.providerCustomerRef ?? current?.providerCustomerRef ?? null,
          providerSubscriptionRef:
            input.providerSubscriptionRef ?? current?.providerSubscriptionRef ?? null,
          source: input.source,
          refs,
          eventCode: input.eventCode,
          lifecycleReason: input.eventCode
        });
        return;
      case "payment_reversed":
        this.assertCurrentSubscriptionExists(current);
        await this.manageWorkspaceSubscriptionLifecycleService.applyImmediatePaidFallback({
          workspaceId: input.workspaceId,
          userId: input.userId,
          source: input.source,
          refs,
          lifecycleReason: "payment_reversed",
          eventCode: "payment_reversed"
        });
        return;
      case "subscription_cancel_scheduled":
        this.assertCurrentSubscriptionExists(current);
        await this.manageWorkspaceSubscriptionLifecycleService.schedulePaidCancellationAtPeriodEnd({
          workspaceId: input.workspaceId,
          userId: input.userId,
          source: input.source,
          refs
        });
        return;
      default: {
        const exhaustiveCheck: never = input.eventCode;
        return exhaustiveCheck;
      }
    }
  }

  private shouldIgnore(
    current: CurrentSubscriptionSnapshot,
    input: ApplyWorkspaceSubscriptionBillingEventInput
  ): boolean {
    if (this.hasConflictingProviderRefs(current, input)) {
      return true;
    }
    switch (input.eventCode) {
      case "renewal_failed":
        return current.status === "grace_period" || current.status === "expired_fallback";
      case "payment_recovered":
      case "payment_activated":
      case "renewal_succeeded":
        return (
          current.status === "active" &&
          current.planCode === (input.paidPlanCode ?? current.planCode) &&
          this.sameIso(current.currentPeriodStartedAt, input.currentPeriodStartedAt ?? null) &&
          this.sameIso(current.currentPeriodEndsAt, input.currentPeriodEndsAt ?? null) &&
          (input.billingProvider ?? current.billingProvider) === current.billingProvider &&
          (input.providerCustomerRef ?? current.providerCustomerRef) ===
            current.providerCustomerRef &&
          (input.providerSubscriptionRef ?? current.providerSubscriptionRef) ===
            current.providerSubscriptionRef
        );
      case "subscription_cancel_scheduled":
        return current.cancelAtPeriodEnd;
      case "payment_reversed":
        return current.status === "expired_fallback";
      default: {
        const exhaustiveCheck: never = input.eventCode;
        return exhaustiveCheck;
      }
    }
  }

  private toBillingEventCreateInput(
    input: ApplyWorkspaceSubscriptionBillingEventInput,
    subscriptionId: string | null
  ): Prisma.WorkspaceSubscriptionBillingEventCreateInput {
    const currentPeriodStartedAt = this.toOptionalDate(input.currentPeriodStartedAt);
    const currentPeriodEndsAt = this.toOptionalDate(input.currentPeriodEndsAt);
    return {
      source: input.source,
      eventCode: input.eventCode,
      eventRef: this.normalizeOptionalString(input.eventRef),
      paymentIntentRef: this.normalizeOptionalString(input.paymentIntentRef),
      billingProvider: this.normalizeOptionalString(input.billingProvider),
      providerCustomerRef: this.normalizeOptionalString(input.providerCustomerRef),
      providerSubscriptionRef: this.normalizeOptionalString(input.providerSubscriptionRef),
      planCode: this.normalizeOptionalString(input.paidPlanCode),
      ...(currentPeriodStartedAt !== undefined ? { currentPeriodStartedAt } : {}),
      ...(currentPeriodEndsAt !== undefined ? { currentPeriodEndsAt } : {}),
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      workspace: { connect: { id: input.workspaceId } },
      ...(input.userId !== null ? { user: { connect: { id: input.userId } } } : {}),
      ...(subscriptionId !== null ? { subscription: { connect: { id: subscriptionId } } } : {})
    };
  }

  private assertCurrentSubscriptionExists(
    current: CurrentSubscriptionSnapshot | null
  ): asserts current is CurrentSubscriptionSnapshot {
    if (current === null) {
      throw new NotFoundException("Workspace subscription not found.");
    }
  }

  private requireString(value: string | null | undefined, field: string): string {
    const normalized = this.normalizeOptionalString(value);
    if (normalized === null) {
      throw new BadRequestException(`${field} is required for this billing event.`);
    }
    return normalized;
  }

  private normalizeOptionalString(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private toOptionalDate(value: string | null | undefined): Date | undefined {
    const normalized = this.normalizeOptionalString(value);
    if (normalized === null) {
      return undefined;
    }
    return new Date(normalized);
  }

  private sameIso(current: Date | null, next: string | null): boolean {
    return (current?.toISOString() ?? null) === (this.normalizeOptionalString(next) ?? null);
  }

  private hasConflictingProviderRefs(
    current: CurrentSubscriptionSnapshot,
    input: ApplyWorkspaceSubscriptionBillingEventInput
  ): boolean {
    if (input.source !== "provider") {
      return false;
    }
    const nextCustomerRef = this.normalizeOptionalString(input.providerCustomerRef);
    if (
      nextCustomerRef !== null &&
      current.providerCustomerRef !== null &&
      nextCustomerRef !== current.providerCustomerRef
    ) {
      return true;
    }
    const nextSubscriptionRef = this.normalizeOptionalString(input.providerSubscriptionRef);
    if (
      nextSubscriptionRef !== null &&
      current.providerSubscriptionRef !== null &&
      nextSubscriptionRef !== current.providerSubscriptionRef
    ) {
      return true;
    }
    return false;
  }

  private resolveErrorCode(error: unknown): string {
    if (error instanceof NotFoundException) {
      return "workspace_subscription_not_found";
    }
    if (error instanceof BadRequestException) {
      return "billing_event_invalid";
    }
    return "billing_event_apply_failed";
  }
}
