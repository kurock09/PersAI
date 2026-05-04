import { Injectable } from "@nestjs/common";
import type {
  BillingProviderCheckoutSession,
  BillingProviderCheckoutSessionRequest,
  BillingProviderPort,
  BillingProviderSubscriptionSnapshot
} from "../../application/billing-provider.port";

@Injectable()
export class NullBillingProviderAdapter implements BillingProviderPort {
  async createCheckoutSession(
    input: BillingProviderCheckoutSessionRequest
  ): Promise<BillingProviderCheckoutSession> {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return {
      providerKey: "manual_test",
      providerSessionRef: `manual-test-${input.paymentIntentId}`,
      providerPaymentRef: null,
      mode: "manual_test",
      expiresAt,
      payload: {
        schema: "persai.billing.manualTestCheckout.v1",
        paymentIntentId: input.paymentIntentId,
        paymentMethodClass: input.paymentMethodClass,
        returnUrl: input.returnUrl,
        expiresAt,
        note: "Development/manual checkout placeholder. Concrete provider wiring lands in ADR-084 Slice 9."
      }
    };
  }

  async pullWorkspaceSubscription(
    workspaceId: string
  ): Promise<BillingProviderSubscriptionSnapshot | null> {
    void workspaceId;
    return null;
  }
}
