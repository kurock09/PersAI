import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../../../messages/en.json";
import BillingCheckoutPage from "./page";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => "token-1")
}));

const apiMocks = vi.hoisted(() => ({
  getAssistantBillingPaymentIntent: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: authMocks.getToken
  })
}));

vi.mock("../../../assistant-api-client", () => ({
  getAssistantBillingPaymentIntent: apiMocks.getAssistantBillingPaymentIntent
}));

afterEach(() => {
  cleanup();
  routerMocks.replace.mockReset();
  apiMocks.getAssistantBillingPaymentIntent.mockReset();
});

describe("BillingCheckoutPage", () => {
  it("loads a manual-test checkout intent and returns success to chat", async () => {
    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-1",
      targetPlanCode: "pro_plus",
      action: "upgrade",
      status: "checkout_ready",
      paymentMethodClass: "card",
      amountMinor: 2000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "manual_test",
      providerSessionRef: "manual-pi-1",
      providerPaymentRef: null,
      checkout: {
        mode: "manual_test",
        expiresAt: "2026-05-04T18:15:00.000Z",
        payload: {
          schema: "persai.billing.manualTestCheckout.v1"
        }
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-04T18:00:00.000Z",
      updatedAt: "2026-05-04T18:00:01.000Z"
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BillingCheckoutPage params={{ paymentIntentId: "pi-1" }} />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Checkout handoff")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Return to chat: success" }));
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=success&billingPlan=pro_plus"
    );
  });
});
