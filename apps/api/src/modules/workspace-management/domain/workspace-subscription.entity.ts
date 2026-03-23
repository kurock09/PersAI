export type WorkspaceSubscriptionStatus =
  | "trialing"
  | "active"
  | "grace_period"
  | "past_due"
  | "paused"
  | "canceled"
  | "expired";

export type WorkspaceSubscription = {
  id: string;
  workspaceId: string;
  planCode: string;
  status: WorkspaceSubscriptionStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStartedAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  billingProvider: string | null;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
};
