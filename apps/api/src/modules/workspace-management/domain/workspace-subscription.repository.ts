import type { BillingProviderSubscriptionSnapshot } from "../application/billing-provider.port";
import type { WorkspaceSubscription } from "./workspace-subscription.entity";

export const WORKSPACE_SUBSCRIPTION_REPOSITORY = Symbol("WORKSPACE_SUBSCRIPTION_REPOSITORY");

export interface WorkspaceSubscriptionRepository {
  findByWorkspaceId(workspaceId: string): Promise<WorkspaceSubscription | null>;
  upsertFromBillingSnapshot(
    snapshot: BillingProviderSubscriptionSnapshot
  ): Promise<WorkspaceSubscription>;
  deleteByWorkspaceId(workspaceId: string): Promise<void>;
}
