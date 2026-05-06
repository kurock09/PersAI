import type { WorkspaceSubscriptionStatus } from "../domain/workspace-subscription.entity";

export const BILLING_PROVIDER_PORT = Symbol("BILLING_PROVIDER_PORT");

export type BillingProviderSubscriptionSnapshot = {
  workspaceId: string;
  planCode: string;
  status: WorkspaceSubscriptionStatus;
  billingProvider: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  graceStartedAt?: string | null;
  graceEndsAt?: string | null;
  currentPeriodStartedAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: Record<string, unknown> | null;
};

export type BillingProviderCheckoutMode =
  | "embedded"
  | "redirect"
  | "payment_link"
  | "qr_code"
  | "manual_test";

export type BillingProviderCheckoutKind = "one_time" | "recurring_start";

export type BillingProviderRecurringPlan = {
  interval: "Day" | "Week" | "Month";
  period: number;
  maxPeriods: number | null;
  amountMinor: number | null;
  startDate: string | null;
};

export type BillingProviderCheckoutSessionRequest = {
  paymentIntentId: string;
  workspaceId: string;
  userId: string;
  planCode: string;
  action: "new_purchase" | "upgrade" | "renewal" | "manual_admin";
  amountMinor: number;
  currency: string;
  billingPeriod: "month" | "year";
  paymentMethodClass: "card" | "sbp_qr";
  returnUrl: string;
  providerCustomerRef: string | null;
  checkoutKind: BillingProviderCheckoutKind;
  recurringPlan: BillingProviderRecurringPlan | null;
  metadata: Record<string, unknown>;
};

export type BillingProviderCheckoutSession = {
  providerKey: string;
  providerSessionRef: string | null;
  providerPaymentRef: string | null;
  mode: BillingProviderCheckoutMode;
  expiresAt: string | null;
  payload: Record<string, unknown>;
};

export type BillingProviderManagedSubscription = {
  providerKey: string;
  providerSubscriptionRef: string;
  status: string;
  nextChargeAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  interval: "Day" | "Week" | "Month" | null;
  period: number | null;
  customerPortalUrl: string | null;
  paymentMethodUpdateUrl: string | null;
  cancelUrl: string | null;
  raw: Record<string, unknown>;
};

/**
 * Provider-agnostic billing boundary for PersAI-owned payment intents.
 * Current production checkout uses a concrete CloudPayments embedded adapter,
 * while lifecycle truth still remains webhook/admin driven inside PersAI.
 */
export interface BillingProviderPort {
  createCheckoutSession(
    input: BillingProviderCheckoutSessionRequest
  ): Promise<BillingProviderCheckoutSession>;

  getManagedSubscription(input: {
    providerSubscriptionRef: string;
  }): Promise<BillingProviderManagedSubscription | null>;

  cancelManagedSubscription(input: { providerSubscriptionRef: string }): Promise<{
    providerKey: string;
    providerSubscriptionRef: string;
    canceledAt: string;
  }>;
}
