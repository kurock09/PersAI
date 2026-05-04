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

const cloudpaymentsMocks = vi.hoisted(() => ({
  start: vi.fn(),
  instance: {
    oncomplete: undefined as ((result: { status?: string; type?: string }) => void) | undefined,
    start: vi.fn()
  }
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
  cloudpaymentsMocks.start.mockReset();
  cloudpaymentsMocks.instance.start.mockReset();
  cloudpaymentsMocks.instance.oncomplete = undefined;
  delete (window as Window & { cp?: unknown }).cp;
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
      expect(screen.getByText("Checkout")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dev: return success" }));
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=success&billingPlan=pro_plus&billingPaymentIntentId=pi-1"
    );
  });

  it("starts CloudPayments widget checkout and returns success to chat", async () => {
    cloudpaymentsMocks.instance.start.mockImplementation(async () => {
      cloudpaymentsMocks.instance.oncomplete?.({ status: "success", type: "payment" });
      return { ok: true };
    });
    const CloudPaymentsCtor = vi.fn(() => cloudpaymentsMocks.instance) as unknown as new () => {
      oncomplete?: (result: { status?: string; type?: string }) => void;
      start: (params: unknown) => Promise<unknown>;
    };
    (window as Window & { cp?: unknown }).cp = {
      CloudPayments: CloudPaymentsCtor
    };

    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-2",
      targetPlanCode: "pro_plus",
      action: "upgrade",
      status: "checkout_ready",
      paymentMethodClass: "card",
      amountMinor: 2000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: "pi-2",
      providerPaymentRef: null,
      checkout: {
        mode: "widget",
        expiresAt: "2026-05-05T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsWidgetCheckout.v1",
          publicTerminalId: "test_api_00000000000000000000002",
          amount: 20,
          currency: "RUB",
          externalId: "pi-2",
          paymentSchema: "Single"
        }
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-05T00:30:00.000Z",
      updatedAt: "2026-05-05T00:30:01.000Z"
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BillingCheckoutPage params={{ paymentIntentId: "pi-2" }} />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Checkout")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open provider checkout" }));
    await waitFor(() => {
      expect(cloudpaymentsMocks.instance.start).toHaveBeenCalled();
    });
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=success&billingPlan=pro_plus&billingPaymentIntentId=pi-2"
    );
  });
});
