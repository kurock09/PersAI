import { Inject, Injectable } from "@nestjs/common";
import {
  BILLING_PROVIDER_PORT,
  type BillingProviderPort,
  type BillingProviderSubscriptionSnapshot
} from "./billing-provider.port";
import {
  WORKSPACE_SUBSCRIPTION_REPOSITORY,
  type WorkspaceSubscriptionRepository
} from "../domain/workspace-subscription.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type { WorkspaceSubscription } from "../domain/workspace-subscription.entity";

export type SyncWorkspaceSubscriptionResult =
  | { status: "unchanged"; workspaceId: string }
  | { status: "updated"; workspaceId: string; changed: true }
  | { status: "deleted"; workspaceId: string; changed: true };

@Injectable()
export class SyncWorkspaceSubscriptionService {
  constructor(
    @Inject(BILLING_PROVIDER_PORT)
    private readonly billingProviderPort: BillingProviderPort,
    @Inject(WORKSPACE_SUBSCRIPTION_REPOSITORY)
    private readonly workspaceSubscriptionRepository: WorkspaceSubscriptionRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async syncWorkspace(workspaceId: string): Promise<SyncWorkspaceSubscriptionResult> {
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(workspaceId);
    const next = await this.billingProviderPort.pullWorkspaceSubscription(workspaceId);

    if (next === null) {
      if (current === null) {
        return { status: "unchanged", workspaceId };
      }
      await this.workspaceSubscriptionRepository.deleteByWorkspaceId(workspaceId);
      await this.markWorkspaceAssistantsConfigDirty(workspaceId);
      return { status: "deleted", workspaceId, changed: true };
    }

    if (current !== null && this.isSameSubscription(current, next)) {
      return { status: "unchanged", workspaceId };
    }

    await this.workspaceSubscriptionRepository.upsertFromBillingSnapshot(next);
    await this.markWorkspaceAssistantsConfigDirty(workspaceId);
    return { status: "updated", workspaceId, changed: true };
  }

  private async markWorkspaceAssistantsConfigDirty(workspaceId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: { workspaceId },
      data: { configDirtyAt: new Date() }
    });
  }

  private isSameSubscription(
    current: WorkspaceSubscription,
    next: BillingProviderSubscriptionSnapshot
  ): boolean {
    return (
      current.workspaceId === next.workspaceId &&
      current.planCode === next.planCode &&
      current.status === next.status &&
      this.sameDate(current.trialStartedAt, next.trialStartedAt) &&
      this.sameDate(current.trialEndsAt, next.trialEndsAt) &&
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
}
