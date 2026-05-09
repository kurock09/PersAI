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
  isLoaded: true,
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
    getToken: authMocks.getToken,
    isLoaded: authMocks.isLoaded
  })
}));

vi.mock("../../../assistant-api-client", () => ({
  getAssistantBillingPaymentIntent: apiMocks.getAssistantBillingPaymentIntent
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light");
  authMocks.isLoaded = true;
  authMocks.getToken.mockReset();
  authMocks.getToken.mockResolvedValue("token-1");
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
  it("waits for Clerk rehydration before showing a session-expired state", async () => {
    authMocks.isLoaded = false;
    authMocks.getToken.mockResolvedValue(null as unknown as string);

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BillingCheckoutPage />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Loading payment form...")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.getAssistantBillingPaymentIntent).not.toHaveBeenCalled();
    });
    expect(screen.queryByText("Session expired. Sign in again and try again.")).toBeNull();
  });

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
      recurring: {
        checkoutKind: "one_time",
        supportedBySelectedMethod: false,
        unsupportedReason: "current_payment_action_is_not_recurring_start"
      },
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
    expect(screen.getByText("RUB 20 / month")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dev: return success" }));
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=success&billingPlan=pro_plus&billingPaymentIntentId=pi-1"
    );
  });

  it("shows media package checkout price without a recurring suffix", async () => {
    navigationMocks.params = { paymentIntentId: "pi-package" };
    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-package",
      targetPlanCode: "__media_package__",
      action: "new_purchase",
      purpose: "media_package_purchase",
      status: "checkout_ready",
      paymentMethodClass: "card",
      amountMinor: 520000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "manual_test",
      providerSessionRef: "manual-pi-package",
      providerPaymentRef: null,
      recurring: {
        checkoutKind: "one_time",
        supportedBySelectedMethod: true,
        unsupportedReason: null
      },
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
      expect(screen.getByText("Pay for media package")).toBeInTheDocument();
    });
    expect(screen.getByText("RUB 5,200")).toBeInTheDocument();
    expect(screen.queryByText("RUB 5,200 / month")).toBeNull();
    expect(screen.queryByText("Pay for MEDIA PACKAGE")).toBeNull();
    expect(
      screen.getByText(
        "This is a one-time payment. The purchased limits will be added to your available capacity right after payment confirmation."
      )
    ).toBeInTheDocument();
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
      options: unknown,
      configuration?: unknown
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
      recurring: {
        checkoutKind: "recurring_start",
        supportedBySelectedMethod: true,
        unsupportedReason: null
      },
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
            culture: "ru-RU",
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

  it("passes light-theme CloudPayments colors when the app theme is light", async () => {
    document.documentElement.classList.add("light");
    navigationMocks.params = { paymentIntentId: "pi-light" };
    const PaymentBlocksCtor = vi.fn(() => cloudpaymentsMocks.instance) as unknown as new (
      options: unknown,
      configuration?: unknown
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
      id: "pi-light",
      targetPlanCode: "basic",
      action: "new_purchase",
      status: "checkout_ready",
      paymentMethodClass: "card",
      amountMinor: 56000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: "pi-light",
      providerPaymentRef: null,
      recurring: {
        checkoutKind: "recurring_start",
        supportedBySelectedMethod: true,
        unsupportedReason: null
      },
      checkout: {
        mode: "embedded",
        expiresAt: "2099-05-05T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
          initializationParams: {
            publicTerminalId: "test_api_00000000000000000000002",
            amount: 560,
            currency: "RUB",
            externalId: "pi-light",
            paymentSchema: "Single",
            description: "PersAI subscription BASIC",
            emailBehavior: "Optional",
            culture: "ru-RU",
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
      expect(cloudpaymentsMocks.instance.mount).toHaveBeenCalled();
    });

    expect(PaymentBlocksCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 560
      }),
      expect.objectContaining({
        appearance: expect.objectContaining({
          colors: expect.objectContaining({
            inputBackground: "#fcfaf5",
            inputColor: "#1f1a12",
            textColor: "#1f1a12",
            titleColor: "#1f1a12"
          })
        })
      })
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
      recurring: {
        checkoutKind: "recurring_start",
        supportedBySelectedMethod: true,
        unsupportedReason: null
      },
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
            culture: "ru-RU",
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

  it("returns failed to chat when the embedded checkout is abandoned without provider success", async () => {
    navigationMocks.params = { paymentIntentId: "pi-3a" };
    (window as Window & { cp?: unknown }).cp = {
      PaymentBlocks: vi.fn(() => cloudpaymentsMocks.instance)
    };

    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-3a",
      targetPlanCode: "pro_plus",
      action: "upgrade",
      status: "checkout_ready",
      paymentMethodClass: "card",
      amountMinor: 2000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: "pi-3a",
      providerPaymentRef: null,
      recurring: {
        checkoutKind: "recurring_start",
        supportedBySelectedMethod: true,
        unsupportedReason: null
      },
      checkout: {
        mode: "embedded",
        expiresAt: "2099-05-05T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
          initializationParams: {
            publicTerminalId: "test_api_00000000000000000000002",
            amount: 20,
            currency: "RUB",
            externalId: "pi-3a",
            paymentSchema: "Single",
            description: "PersAI subscription PRO",
            emailBehavior: "Optional",
            culture: "ru-RU",
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
    fireEvent.click(screen.getByRole("button", { name: "Return to chat" }));
    expect(routerMocks.replace).toHaveBeenCalledWith(
      "/app/chat?billingReturn=failed&billingPlan=pro_plus&billingPaymentIntentId=pi-3a"
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
      recurring: {
        checkoutKind: "one_time",
        supportedBySelectedMethod: false,
        unsupportedReason: "selected_method_is_not_recurring_capable"
      },
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
            culture: "ru-RU",
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
      expect(screen.getByText("This payment page has expired")).toBeInTheDocument();
    });
    expect(cloudpaymentsMocks.instance.mount).not.toHaveBeenCalled();
  });

  it("shows one-time help copy when the checkout does not start recurring", async () => {
    navigationMocks.params = { paymentIntentId: "pi-5" };
    (window as Window & { cp?: unknown }).cp = {
      PaymentBlocks: vi.fn(() => cloudpaymentsMocks.instance)
    };
    apiMocks.getAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-5",
      targetPlanCode: "pro_plus",
      action: "new_purchase",
      status: "checkout_ready",
      paymentMethodClass: "sbp_qr",
      amountMinor: 2000,
      currency: "RUB",
      billingPeriod: "month",
      returnUrl: "/app/chat",
      billingProvider: "cloudpayments",
      providerSessionRef: "pi-5",
      providerPaymentRef: null,
      recurring: {
        checkoutKind: "one_time",
        supportedBySelectedMethod: false,
        unsupportedReason: "selected_method_is_not_recurring_capable"
      },
      checkout: {
        mode: "embedded",
        expiresAt: "2099-05-05T00:45:00.000Z",
        payload: {
          schema: "persai.billing.cloudpaymentsConstructorCheckout.v1",
          initializationParams: {
            publicTerminalId: "test_api_00000000000000000000002",
            amount: 20,
            currency: "RUB",
            externalId: "pi-5",
            paymentSchema: "Single",
            description: "PersAI subscription PRO",
            emailBehavior: "Optional",
            culture: "ru-RU",
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
    expect(
      screen.getByText(
        "This is a one-time payment for the selected method. Auto-renew will not start from this payment."
      )
    ).toBeInTheDocument();
  });
});
