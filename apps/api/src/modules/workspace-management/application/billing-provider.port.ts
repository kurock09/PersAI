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
  | "widget"
  | "redirect"
  | "payment_link"
  | "qr_code"
  | "manual_test";

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

/**
 * Provider-agnostic billing boundary.
 * Concrete CloudPayments wiring remains a later ADR-084 slice.
 */
export interface BillingProviderPort {
  createCheckoutSession(
    input: BillingProviderCheckoutSessionRequest
  ): Promise<BillingProviderCheckoutSession>;
  pullWorkspaceSubscription(
    workspaceId: string
  ): Promise<BillingProviderSubscriptionSnapshot | null>;
}
