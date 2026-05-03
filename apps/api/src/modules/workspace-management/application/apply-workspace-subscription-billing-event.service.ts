import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, WorkspaceSubscriptionLifecycleEventSource } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ManageWorkspaceSubscriptionLifecycleService } from "./manage-workspace-subscription-lifecycle.service";

export type WorkspaceSubscriptionBillingEventCode =
  | "payment_activated"
  | "renewal_succeeded"
  | "renewal_failed"
  | "payment_recovered"
  | "payment_reversed";

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
        billingProvider: true,
        providerCustomerRef: true,
        providerSubscriptionRef: true
      }
    });
    if (current === null) {
      throw new NotFoundException("Workspace subscription not found.");
    }

    const billingEvent =
      existing ??
      (await this.prisma.workspaceSubscriptionBillingEvent.create({
        data: this.toBillingEventCreateInput(input, current.id)
      }));

    if (this.shouldIgnore(current, input)) {
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

    try {
      await this.applyToLifecycle(current, input, billingEvent.id);
      await this.prisma.workspaceSubscriptionBillingEvent.update({
        where: { id: billingEvent.id },
        data: {
          subscriptionId: current.id,
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
    current: CurrentSubscriptionSnapshot,
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
          billingProvider: input.billingProvider ?? current.billingProvider,
          providerCustomerRef: input.providerCustomerRef ?? current.providerCustomerRef,
          providerSubscriptionRef: input.providerSubscriptionRef ?? current.providerSubscriptionRef,
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
          billingProvider: input.billingProvider ?? current.billingProvider,
          providerCustomerRef: input.providerCustomerRef ?? current.providerCustomerRef,
          providerSubscriptionRef: input.providerSubscriptionRef ?? current.providerSubscriptionRef,
          source: input.source,
          refs,
          eventCode: input.eventCode,
          lifecycleReason: input.eventCode
        });
        return;
      case "payment_reversed":
        await this.manageWorkspaceSubscriptionLifecycleService.applyImmediatePaidFallback({
          workspaceId: input.workspaceId,
          userId: input.userId,
          source: input.source,
          refs,
          lifecycleReason: "payment_reversed",
          eventCode: "payment_reversed"
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
    subscriptionId: string
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
      subscription: { connect: { id: subscriptionId } }
    };
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
