import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, WorkspaceSubscriptionLifecycleEventSource } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { BILLING_PROVIDER_PORT, type BillingProviderPort } from "./billing-provider.port";
import { ManageWorkspaceSubscriptionLifecycleService } from "./manage-workspace-subscription-lifecycle.service";

export type WorkspaceSubscriptionBillingEventCode =
  | "payment_activated"
  | "renewal_succeeded"
  | "renewal_failed"
  | "payment_recovered"
  | "payment_reversed"
  | "subscription_cancel_scheduled"
  | "subscription_resumed"
  | "auto_renew_enabled";

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
    private readonly manageWorkspaceSubscriptionLifecycleService: ManageWorkspaceSubscriptionLifecycleService,
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort
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
      const lifecycleInput = await this.applyManagedSubscriptionUpdateIfNeeded(billingEvent, input);
      await this.applyToLifecycle(current, lifecycleInput, billingEvent.id);
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
          refs,
          paidPlanCodeOverride: this.readScheduledPaidPlanCode(input.metadata)
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
      case "subscription_resumed":
        this.assertCurrentSubscriptionExists(current);
        await this.manageWorkspaceSubscriptionLifecycleService.resumePaidAutoRenew({
          workspaceId: input.workspaceId,
          userId: input.userId,
          source: input.source,
          refs,
          billingProvider: input.billingProvider ?? current.billingProvider ?? null,
          providerCustomerRef: input.providerCustomerRef ?? current.providerCustomerRef ?? null,
          providerSubscriptionRef:
            input.providerSubscriptionRef ?? current.providerSubscriptionRef ?? null
        });
        return;
      case "auto_renew_enabled":
        this.assertCurrentSubscriptionExists(current);
        await this.manageWorkspaceSubscriptionLifecycleService.enablePaidAutoRenew({
          workspaceId: input.workspaceId,
          userId: input.userId,
          source: input.source,
          refs,
          billingProvider: input.billingProvider ?? current.billingProvider ?? null,
          providerCustomerRef: input.providerCustomerRef ?? current.providerCustomerRef ?? null,
          providerSubscriptionRef: this.requireString(
            input.providerSubscriptionRef ?? current.providerSubscriptionRef,
            "providerSubscriptionRef"
          )
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
      case "subscription_resumed":
        return !current.cancelAtPeriodEnd;
      case "auto_renew_enabled":
        return (
          !current.cancelAtPeriodEnd &&
          current.providerSubscriptionRef !== null &&
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

  private async applyManagedSubscriptionUpdateIfNeeded(
    billingEvent: { id: string; metadata?: Prisma.JsonValue | null },
    input: ApplyWorkspaceSubscriptionBillingEventInput
  ): Promise<ApplyWorkspaceSubscriptionBillingEventInput> {
    const update = this.readManagedSubscriptionUpdate(input.metadata);
    if (update === null) {
      return input;
    }
    const appliedAt = this.readManagedSubscriptionUpdateAppliedAt(billingEvent.metadata);
    const persistedProviderSubscriptionRef = this.readManagedSubscriptionUpdateProviderRef(
      billingEvent.metadata
    );
    if (appliedAt !== null) {
      const metadata = this.mergeMetadata((input.metadata ?? null) as Prisma.JsonValue, {
        ...(persistedProviderSubscriptionRef !== null
          ? { managedRecurringSubscriptionRef: persistedProviderSubscriptionRef }
          : {}),
        managedRecurringSubscriptionUpdateAppliedAt: appliedAt
      }) as unknown as Record<string, unknown>;
      return {
        ...input,
        providerSubscriptionRef:
          persistedProviderSubscriptionRef ?? input.providerSubscriptionRef ?? null,
        metadata
      };
    }

    const planCode = this.normalizeOptionalString(input.paidPlanCode);
    let description: string | null = null;
    if (planCode !== null) {
      const planRow = await this.prisma.planCatalogPlan.findUnique({
        where: { code: planCode },
        select: { displayName: true }
      });
      if (planRow?.displayName !== undefined && planRow.displayName.trim().length > 0) {
        description = `PersAI ${planRow.displayName.trim()}`;
      }
    }

    const managedSubscription = await this.billingProviderPort.updateManagedSubscription({
      ...update,
      ...(description !== null ? { description } : {})
    });
    const appliedAtIso = new Date().toISOString();
    await this.prisma.workspaceSubscriptionBillingEvent.update({
      where: { id: billingEvent.id },
      data: {
        metadata: this.mergeMetadata(billingEvent.metadata, {
          managedRecurringSubscriptionUpdateAppliedAt: appliedAtIso,
          managedRecurringSubscriptionRef: managedSubscription.providerSubscriptionRef
        })
      }
    });

    if (description !== null) {
      await this.prisma.workspaceSubscription.update({
        where: { workspaceId: input.workspaceId },
        data: { providerRecurringDescriptor: description }
      });
    }

    return {
      ...input,
      providerSubscriptionRef: managedSubscription.providerSubscriptionRef,
      metadata: this.mergeMetadata((input.metadata ?? null) as Prisma.JsonValue, {
        managedRecurringSubscriptionUpdateAppliedAt: appliedAtIso,
        managedRecurringSubscriptionRef: managedSubscription.providerSubscriptionRef
      }) as unknown as Record<string, unknown>
    };
  }

  private readManagedSubscriptionUpdate(metadata: Record<string, unknown> | undefined): {
    providerSubscriptionRef: string;
    amountMinor: number;
    currency: string;
    startDate: string;
    interval: "Day" | "Week" | "Month";
    period: number;
    maxPeriods: number | null;
  } | null {
    if (metadata === undefined) {
      return null;
    }
    const candidate = metadata.managedRecurringSubscriptionUpdate;
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.providerSubscriptionRef !== "string" ||
      typeof row.amountMinor !== "number" ||
      typeof row.currency !== "string" ||
      typeof row.startDate !== "string" ||
      (row.interval !== "Day" && row.interval !== "Week" && row.interval !== "Month") ||
      typeof row.period !== "number"
    ) {
      return null;
    }
    return {
      providerSubscriptionRef: row.providerSubscriptionRef,
      amountMinor: row.amountMinor,
      currency: row.currency,
      startDate: row.startDate,
      interval: row.interval,
      period: row.period,
      maxPeriods: typeof row.maxPeriods === "number" ? row.maxPeriods : null
    };
  }

  private readManagedSubscriptionUpdateAppliedAt(
    value: Prisma.JsonValue | null | undefined
  ): string | null {
    if (
      value === null ||
      value === undefined ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }
    const candidate = (value as Record<string, unknown>)
      .managedRecurringSubscriptionUpdateAppliedAt;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
  }

  private readManagedSubscriptionUpdateProviderRef(
    value: Prisma.JsonValue | null | undefined
  ): string | null {
    if (
      value === null ||
      value === undefined ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }
    const candidate = (value as Record<string, unknown>).managedRecurringSubscriptionRef;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
  }

  private readScheduledPaidPlanCode(metadata: Record<string, unknown> | undefined): string | null {
    if (metadata === undefined) {
      return null;
    }
    const candidate = metadata.scheduledPaidPlanCode;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
  }

  private mergeMetadata(
    current: Prisma.JsonValue | null | undefined,
    patch: Record<string, unknown>
  ): Prisma.InputJsonValue {
    const base =
      current !== null &&
      current !== undefined &&
      typeof current === "object" &&
      !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    return {
      ...base,
      ...patch
    } as Prisma.InputJsonValue;
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
    const persistedManagedSubscriptionRef = this.readManagedSubscriptionUpdateProviderRef(
      input.metadata as Prisma.JsonValue | undefined
    );
    if (
      nextSubscriptionRef !== null &&
      current.providerSubscriptionRef !== null &&
      nextSubscriptionRef !== current.providerSubscriptionRef &&
      nextSubscriptionRef !== persistedManagedSubscriptionRef
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
