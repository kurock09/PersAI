import type { WorkspaceSubscriptionStatus } from "../domain/workspace-subscription.entity";

export type EffectiveSubscriptionSource =
  | "workspace_subscription"
  | "subscription_trial_fallback"
  | "subscription_paid_fallback"
  | "assistant_plan_override"
  | "assistant_plan_fallback"
  | "catalog_default_fallback"
  | "none";

export type EffectiveSubscriptionStatus = WorkspaceSubscriptionStatus | "unconfigured";

export type EffectiveSubscriptionState = {
  source: EffectiveSubscriptionSource;
  status: EffectiveSubscriptionStatus;
  planCode: string | null;
  trialEndsAt: string | null;
  graceStartedAt?: string | null;
  graceEndsAt?: string | null;
  currentPeriodStartedAt?: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
};
