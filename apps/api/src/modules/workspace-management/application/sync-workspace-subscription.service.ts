import { Inject, Injectable } from "@nestjs/common";
import {
  BILLING_PROVIDER_PORT,
  type BillingProviderPort,
  type BillingProviderSubscriptionSnapshot
} from "./billing-provider.port";
import type { WorkspaceSubscription } from "../domain/workspace-subscription.entity";
import { ApplyWorkspaceSubscriptionBillingEventService } from "./apply-workspace-subscription-billing-event.service";
import {
  WORKSPACE_SUBSCRIPTION_REPOSITORY,
  type WorkspaceSubscriptionRepository
} from "../domain/workspace-subscription.repository";

export type SyncWorkspaceSubscriptionResult =
  | { status: "unchanged"; workspaceId: string }
  | { status: "updated"; workspaceId: string; changed: true }
  | { status: "ignored"; workspaceId: string; changed: false };

@Injectable()
export class SyncWorkspaceSubscriptionService {
  constructor(
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort,
    @Inject(WORKSPACE_SUBSCRIPTION_REPOSITORY)
    private readonly workspaceSubscriptionRepository: WorkspaceSubscriptionRepository,
    private readonly applyWorkspaceSubscriptionBillingEventService: ApplyWorkspaceSubscriptionBillingEventService
  ) {}

  async syncWorkspace(workspaceId: string): Promise<SyncWorkspaceSubscriptionResult> {
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(workspaceId);
    const next = await this.billingProviderPort.pullWorkspaceSubscription(workspaceId);

    if (next === null) {
      return { status: "unchanged", workspaceId };
    }

    if (current !== null && this.isSameSubscription(current, next)) {
      return { status: "unchanged", workspaceId };
    }

    const billingEvent = this.deriveBillingEvent(current, next);
    if (billingEvent === null) {
      return { status: "ignored", workspaceId, changed: false };
    }

    const result = await this.applyWorkspaceSubscriptionBillingEventService.apply({
      workspaceId,
      userId: null,
      source: "provider",
      eventRef: this.buildEventRef(next),
      paymentIntentRef: null,
      billingProvider: next.billingProvider,
      providerCustomerRef: next.providerCustomerRef,
      providerSubscriptionRef: next.providerSubscriptionRef,
      paidPlanCode: next.planCode,
      currentPeriodStartedAt: next.currentPeriodStartedAt,
      currentPeriodEndsAt: next.currentPeriodEndsAt,
      metadata: {
        syncMode: "provider_pull_snapshot",
        providerStatus: next.status
      },
      eventCode: billingEvent
    });

    return result.status === "ignored"
      ? { status: "ignored", workspaceId, changed: false }
      : { status: "updated", workspaceId, changed: true };
  }

  private isSameSubscription(
    current: WorkspaceSubscription,
    next: BillingProviderSubscriptionSnapshot
  ): boolean {
    return (
      current.workspaceId === next.workspaceId &&
      current.planCode === next.planCode &&
      current.status === next.status &&
      current.billingProvider === next.billingProvider &&
      this.sameDate(current.trialStartedAt, next.trialStartedAt) &&
      this.sameDate(current.trialEndsAt, next.trialEndsAt) &&
      this.sameDate(current.graceStartedAt, next.graceStartedAt ?? null) &&
      this.sameDate(current.graceEndsAt, next.graceEndsAt ?? null) &&
      this.sameDate(current.currentPeriodStartedAt, next.currentPeriodStartedAt) &&
      this.sameDate(current.currentPeriodEndsAt, next.currentPeriodEndsAt) &&
      current.cancelAtPeriodEnd === next.cancelAtPeriodEnd &&
      current.providerCustomerRef === next.providerCustomerRef &&
      current.providerSubscriptionRef === next.providerSubscriptionRef &&
      JSON.stringify(current.metadata ?? null) === JSON.stringify(next.metadata ?? null)
    );
  }

  private sameDate(current: Date | null, next: string | null): boolean {
    return (current?.toISOString() ?? null) === next;
  }

  private deriveBillingEvent(
    current: WorkspaceSubscription | null,
    next: BillingProviderSubscriptionSnapshot
  ):
    | "payment_activated"
    | "renewal_succeeded"
    | "renewal_failed"
    | "payment_recovered"
    | "payment_reversed"
    | null {
    if (next.status === "grace_period" || next.status === "past_due") {
      return "renewal_failed";
    }

    if (next.status === "active") {
      if (current === null) {
        return "payment_activated";
      }
      if (current.status === "grace_period" || current.status === "past_due") {
        return "payment_recovered";
      }
      if (
        current.status === "active" &&
        current.planCode === next.planCode &&
        current.currentPeriodEndsAt !== null &&
        next.currentPeriodEndsAt !== null &&
        current.currentPeriodEndsAt.toISOString() !== next.currentPeriodEndsAt
      ) {
        return "renewal_succeeded";
      }
      return "payment_activated";
    }

    if (
      next.status === "expired_fallback" ||
      next.status === "canceled" ||
      next.status === "expired"
    ) {
      return "payment_reversed";
    }

    return null;
  }

  private buildEventRef(snapshot: BillingProviderSubscriptionSnapshot): string {
    return [
      snapshot.billingProvider ?? "provider",
      snapshot.workspaceId,
      snapshot.providerSubscriptionRef ?? "subscription",
      snapshot.status,
      snapshot.currentPeriodEndsAt ?? "no-period-end"
    ].join(":");
  }
}
