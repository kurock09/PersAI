import type { WorkspaceSubscriptionStatus } from "../domain/workspace-subscription.entity";

export const BILLING_PROVIDER_PORT = Symbol("BILLING_PROVIDER_PORT");

export type BillingProviderSubscriptionSnapshot = {
  workspaceId: string;
  planCode: string;
  status: WorkspaceSubscriptionStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Provider-agnostic billing boundary for future subscription sync.
 * P3 introduces this port only; concrete provider integrations remain out of scope.
 */
export interface BillingProviderPort {
  pullWorkspaceSubscription(workspaceId: string): Promise<BillingProviderSubscriptionSnapshot | null>;
}
