import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../../../messages/en.json";
import BillingCheckoutPage from "./page";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn()
}));

const navigationMocks = vi.hoisted(() => ({
  params: {
    paymentIntentId: "pi-1"
  }
}));

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => "token-1")
}));

const apiMocks = vi.hoisted(() => ({
  getAssistantBillingPaymentIntent: vi.fn()
}));

const cloudpaymentsMocks = vi.hoisted(() => ({
  instance: {
    mount: vi.fn(),
    unmount: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
  useParams: () => navigationMocks.params
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
  navigationMocks.params = { paymentIntentId: "pi-1" };
  apiMocks.getAssistantBillingPaymentIntent.mockReset();
  cloudpaymentsMocks.instance.mount.mockReset();
  cloudpaymentsMocks.instance.unmount.mockReset();
  cloudpaymentsMocks.instance.on.mockReset();
  cloudpaymentsMocks.instance.off.mockReset();
  delete (window as Window & { cp?: unknown }).cp;
});

describe("BillingCheckoutPage", () => {
  it("loads a manual-test checkout intent and returns success to chat", async () => {
    navigationMocks.params = { paymentIntentId: "pi-1" };
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
        expiresAt: "2099-05-04T18:15:00.000Z",
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
        <BillingCheckoutPage />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Pay for PRO PLUS")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dev: return success" }));
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=success&billingPlan=pro_plus&billingPaymentIntentId=pi-1"
    );
  });

  it("mounts CloudPayments constructor and returns success to chat", async () => {
    navigationMocks.params = { paymentIntentId: "pi-2" };
    let successCallback: (() => void) | undefined;
    cloudpaymentsMocks.instance.on.mockImplementation((event: string, callback: () => void) => {
      if (event === "success") {
        successCallback = callback;
      }
    });
    const PaymentBlocksCtor = vi.fn(() => cloudpaymentsMocks.instance) as unknown as new (
      initializationParams: unknown,
      customizationParams?: unknown
    ) => {
      mount: (target: unknown) => void;
      unmount: () => void;
      on: (event: string, callback: () => void) => void;
      off: (event: string) => void;
    };
    (window as Window & { cp?: unknown }).cp = {
      PaymentBlocks: PaymentBlocksCtor
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
        mode: "embedded",
        expiresAt: "2099-05-05T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
          initializationParams: {
            publicTerminalId: "test_api_00000000000000000000002",
            amount: 20,
            currency: "RUB",
            externalId: "pi-2",
            paymentSchema: "Single",
            description: "PersAI subscription PRO",
            accountId: "cust-1",
            emailBehavior: "Optional",
            language: "ru-RU",
            metadata: {}
          },
          customizationParams: {
            components: {
              paymentButton: {
                text: "Pay subscription"
              }
            }
          }
        }
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-05T00:30:00.000Z",
      updatedAt: "2026-05-05T00:30:01.000Z"
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BillingCheckoutPage />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Pay for PRO PLUS")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(cloudpaymentsMocks.instance.mount).toHaveBeenCalled();
    });
    successCallback?.();
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=pending&billingPlan=pro_plus&billingPaymentIntentId=pi-2"
    );
  });

  it("returns failed to chat after embedded payment failure", async () => {
    navigationMocks.params = { paymentIntentId: "pi-3" };
    let failCallback: (() => void) | undefined;
    cloudpaymentsMocks.instance.on.mockImplementation((event: string, callback: () => void) => {
      if (event === "fail") {
        failCallback = callback;
      }
    });
    (window as Window & { cp?: unknown }).cp = {
      PaymentBlocks: vi.fn(() => cloudpaymentsMocks.instance)
    };

    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-3",
      targetPlanCode: "pro_plus",
      action: "upgrade",
      status: "checkout_ready",
      paymentMethodClass: "card",
      amountMinor: 2000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: "pi-3",
      providerPaymentRef: null,
      checkout: {
        mode: "embedded",
        expiresAt: "2099-05-05T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
          initializationParams: {
            publicTerminalId: "test_api_00000000000000000000002",
            amount: 20,
            currency: "RUB",
            externalId: "pi-3",
            paymentSchema: "Single",
            description: "PersAI subscription PRO",
            emailBehavior: "Optional",
            language: "ru-RU",
            metadata: {}
          }
        }
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-05T00:30:00.000Z",
      updatedAt: "2026-05-05T00:30:01.000Z"
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BillingCheckoutPage />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(cloudpaymentsMocks.instance.mount).toHaveBeenCalled();
    });
    failCallback?.();
    await waitFor(() => {
      expect(screen.getByText("Payment was not completed. You can try again.")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Return to chat" }));
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=failed&billingPlan=pro_plus&billingPaymentIntentId=pi-3"
    );
  });

  it("shows a closed checkout state for expired intents", async () => {
    navigationMocks.params = { paymentIntentId: "pi-4" };
    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-4",
      targetPlanCode: "pro_plus",
      action: "upgrade",
      status: "expired",
      paymentMethodClass: "card",
      amountMinor: 2000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: "pi-4",
      providerPaymentRef: null,
      checkout: {
        mode: "embedded",
        expiresAt: "2026-05-04T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
          initializationParams: {
            publicTerminalId: "test_api_00000000000000000000002",
            amount: 20,
            currency: "RUB",
            externalId: "pi-4",
            paymentSchema: "Single",
            description: "PersAI subscription PRO",
            emailBehavior: "Optional",
            language: "ru-RU",
            metadata: {}
          }
        }
      },
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: "2026-05-05T00:30:00.000Z",
      updatedAt: "2026-05-05T00:30:01.000Z"
    });

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BillingCheckoutPage />
      </NextIntlClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("This checkout has expired")).toBeInTheDocument();
    });
    expect(cloudpaymentsMocks.instance.mount).not.toHaveBeenCalled();
  });
});
