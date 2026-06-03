import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicPricingPlanState } from "@persai/contracts";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../messages/en.json";
import { PricingPageView, derivePlanFacts } from "./pricing-page-view";

const billingRecurringMigrationIdle = {
  status: "idle" as const,
  targetMethodClass: null,
  failureReason: null,
  updatedAt: null
};

const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  isLoaded: true,
  getToken: vi.fn(async () => "token-1")
}));

const billingMocks = vi.hoisted(() => ({
  getAssistantBillingSubscription: vi.fn(),
  postAssistantBillingChangePlan: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: authMocks.getToken,
    isLoaded: authMocks.isLoaded
  })
}));

vi.mock("../app/assistant-api-client", () => ({
  getAssistantBillingSubscription: billingMocks.getAssistantBillingSubscription,
  postAssistantBillingChangePlan: billingMocks.postAssistantBillingChangePlan
}));

afterEach(() => {
  cleanup();
  navigationMocks.push.mockReset();
  authMocks.isLoaded = true;
  authMocks.getToken.mockClear();
  billingMocks.getAssistantBillingSubscription.mockReset();
  billingMocks.postAssistantBillingChangePlan.mockReset();
});

function makePlan(overrides: Partial<PublicPricingPlanState> = {}): PublicPricingPlanState {
  return {
    code: "pro",
    displayName: "Pro",
    description: "Premium plan",
    trialEnabled: true,
    trialDurationDays: 7,
    defaultOnRegistration: false,
    enabledToolCodes: ["image_generate", "video_generate"],
    entitlements: {
      toolClasses: {
        costDrivingTools: true,
        utilityTools: true,
        costDrivingQuotaGoverned: true,
        utilityQuotaGoverned: true
      },
      channelsAndSurfaces: {
        webChat: true,
        telegram: true,
        whatsapp: false,
        max: false
      }
    },
    quotaLimits: {
      tokenBudgetLimit: 20000,
      activeWebChatsLimit: 10,
      mediaStorageBytesLimit: 1000000,
      knowledgeStorageBytesLimit: 1000000,
      imageGenerateMonthlyUnitsLimit: 30,
      imageEditMonthlyUnitsLimit: 10,
      videoGenerateMonthlyUnitsLimit: 8
    },
    skillPolicy: {
      maxEnabledSkills: 12
    },
    assistantPolicy: {
      maxAssistants: 1
    },
    presentation: {
      showOnPricingPage: true,
      displayOrder: 1,
      highlighted: true,
      title: { ru: "Про", en: "Pro" },
      subtitle: { ru: "Для роста", en: "For growth" },
      notes: { ru: "Тихий premium note", en: "Quiet premium note" },
      badge: { ru: "Популярный", en: "Popular" },
      ctaLabel: { ru: "Выбрать", en: "Choose" },
      price: { amount: 4900, currency: "RUB", billingPeriod: "month" },
      highlightItems: { ru: ["30 картинок"], en: ["30 images per month"] }
    },
    videoVcoinMonthlyGrant: 0,
    vcoinExchangeRate: 20,
    ...overrides
  };
}

function renderView(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe("PricingPageView", () => {
  it("renders guest pricing cards with sign-up CTA", () => {
    renderView(<PricingPageView plans={[makePlan()]} signedIn={false} />);

    expect(screen.getByText("Choose your PersAI")).toBeInTheDocument();
    expect(screen.getByText("Popular")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose" })).toHaveAttribute("href", "/sign-up");
  });

  it("lets signed-in users start checkout for a paid purchase", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "free",
      planDisplayName: "Free",
      subscriptionStatus: "active",
      billingProvider: null,
      providerSubscriptionRef: null,
      autoRenewEnabled: false,
      canDisableAutoRenew: false,
      canScheduleDowngrade: false,
      canSwitchToFree: false,
      nextChargeAt: null,
      currentPeriodEndsAt: null,
      lastPaymentMethodLabel: null,
      autoRenewMethodLabel: null,
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });
    billingMocks.postAssistantBillingChangePlan.mockResolvedValue({
      mode: "checkout",
      paymentIntent: {
        id: "pi-1"
      }
    });
    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              price: { amount: 0, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({ code: "team", displayName: "Team" })
        ]}
        currentPlanCode="free"
        signedIn
      />
    );

    expect(screen.getByText("Already active")).toBeInTheDocument();
    expect(screen.queryByText("Current plan")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    await waitFor(() => {
      expect(billingMocks.postAssistantBillingChangePlan).toHaveBeenCalledWith(
        "token-1",
        expect.objectContaining({
          planCode: "team",
          paymentMethodClass: "card",
          returnUrl: "/app/chat"
        })
      );
    });
    expect(navigationMocks.push).toHaveBeenCalledWith("/app/billing/checkout/pi-1");
    expect(screen.queryByText("Pay with SBP QR")).not.toBeInTheDocument();
  });

  it("routes paid users to settings for FREE even when bootstrap current plan is unavailable", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });
    renderView(
      <PricingPageView
        plans={[
          makePlan(),
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              badge: { ru: null, en: null },
              price: { amount: 0, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode={null}
        signedIn
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Switch to FREE is available in")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/app/chat?settings=limits"
    );
    expect(screen.queryByText("Review plan change")).toBeNull();
    expect(billingMocks.postAssistantBillingChangePlan).not.toHaveBeenCalled();
  });

  it("shows scheduled FREE copy instead of settings hint when free fallback is already planned", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "canceled",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: false,
      canDisableAutoRenew: false,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: null,
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: {
        changeKind: "free",
        targetPlanCode: "free",
        targetPlanDisplayName: "Free",
        effectiveAt: "2026-05-12T00:00:00.000Z"
      },
      warning: null
    });

    renderView(
      <PricingPageView
        plans={[
          makePlan(),
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              badge: { ru: null, en: null },
              price: { amount: 0, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode={null}
        signedIn
      />
    );

    await waitFor(() => {
      expect(screen.getByText("FREE is scheduled for the next billing date.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Switch to FREE is available in")).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("does not flash the generic FREE settings hint before scheduled FREE state loads", async () => {
    let resolveBillingState: ((value: Record<string, unknown>) => void) | undefined;
    billingMocks.getAssistantBillingSubscription.mockReturnValue(
      new Promise((resolve) => {
        resolveBillingState = resolve;
      })
    );

    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "pro",
            displayName: "Pro",
            presentation: {
              ...makePlan().presentation,
              title: { ru: "Про", en: "Pro" },
              price: { amount: 49, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              badge: { ru: null, en: null },
              price: { amount: 0, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode="pro"
        signedIn
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Checking whether FREE is available or already scheduled for your current billing state..."
        )
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Switch to FREE is available in")).toBeNull();

    resolveBillingState?.({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "canceled",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: false,
      canDisableAutoRenew: false,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: null,
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: {
        changeKind: "free",
        targetPlanCode: "free",
        targetPlanDisplayName: "Free",
        effectiveAt: "2026-05-12T00:00:00.000Z"
      },
      warning: null
    });

    await waitFor(() => {
      expect(screen.getByText("FREE is scheduled for the next billing date.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Switch to FREE is available in")).toBeNull();
  });

  it("reviews a cheaper paid downgrade before scheduling it", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });

    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "basic",
            displayName: "Basic",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Базовый", en: "Basic" },
              price: { amount: 19, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "pro",
            displayName: "Pro",
            presentation: {
              ...makePlan().presentation,
              title: { ru: "Про", en: "Pro" },
              price: { amount: 49, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode={null}
        signedIn
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Choose" })).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));

    expect(await screen.findByText("Review plan change")).toBeInTheDocument();
    expect(screen.getByText(/After that, Basic becomes active at/i)).toBeInTheDocument();
    expect(billingMocks.postAssistantBillingChangePlan).not.toHaveBeenCalled();
  });

  it("reviews an upgrade before launching checkout", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "basic",
      planDisplayName: "Basic",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      canScheduleDowngrade: false,
      canSwitchToFree: false,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });
    billingMocks.postAssistantBillingChangePlan.mockResolvedValue({
      mode: "checkout",
      paymentIntent: {
        id: "pi-upgrade"
      }
    });

    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "basic",
            displayName: "Basic",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Базовый", en: "Basic" },
              price: { amount: 1900, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "pro",
            displayName: "Pro",
            presentation: {
              ...makePlan().presentation,
              title: { ru: "Про", en: "Pro" },
              price: { amount: 4900, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode="basic"
        signedIn
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    expect(await screen.findByText("Review upgrade")).toBeInTheDocument();
    expect(screen.getByText(/switches from Basic to Pro immediately/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => {
      expect(billingMocks.postAssistantBillingChangePlan).toHaveBeenCalledWith(
        "token-1",
        expect.objectContaining({
          planCode: "pro"
        })
      );
    });
    expect(navigationMocks.push).toHaveBeenCalledWith("/app/billing/checkout/pi-upgrade");
  });

  it("uses only in-product review modals for managed plan changes", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });

    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              badge: { ru: null, en: null },
              price: { amount: 0, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "basic",
            displayName: "Basic",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Базовый", en: "Basic" },
              price: { amount: 19, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "pro",
            displayName: "Pro",
            presentation: {
              ...makePlan().presentation,
              title: { ru: "Про", en: "Pro" },
              price: { amount: 49, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "ultima",
            displayName: "Ultima",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Ультима", en: "Ultima" },
              price: { amount: 79, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode={null}
        signedIn
      />
    );

    const freeCard = screen.getAllByText("Free")[0]?.closest("section");
    expect(freeCard).not.toBeNull();
    await waitFor(() => {
      expect(
        within(freeCard as HTMLElement).getByText("Switch to FREE is available in")
      ).toBeInTheDocument();
    });
    expect(
      within(freeCard as HTMLElement).queryByRole("button", { name: "Cancel subscription" })
    ).toBeNull();
    expect(within(freeCard as HTMLElement).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/app/chat?settings=limits"
    );

    const basicCard = screen.getAllByText("Basic")[0]?.closest("section");
    expect(basicCard).not.toBeNull();
    fireEvent.click(within(basicCard as HTMLElement).getByRole("button", { name: "Choose" }));
    expect(await screen.findByText("Review plan change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const upgradeCard = screen.getAllByText("Ultima")[0]?.closest("section");
    expect(upgradeCard).not.toBeNull();
    fireEvent.click(within(upgradeCard as HTMLElement).getByRole("button", { name: "Choose" }));
    expect(await screen.findByText("Review upgrade")).toBeInTheDocument();

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows explanatory FREE copy for trial subscriptions without an action button", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "pro",
      planDisplayName: "Pro",
      subscriptionStatus: "trialing",
      billingProvider: null,
      providerSubscriptionRef: null,
      autoRenewEnabled: false,
      canDisableAutoRenew: false,
      canScheduleDowngrade: false,
      canSwitchToFree: false,
      nextChargeAt: null,
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: null,
      autoRenewMethodLabel: null,
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });

    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              badge: { ru: null, en: null },
              price: { amount: 0, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "pro",
            displayName: "Pro",
            presentation: {
              ...makePlan().presentation,
              title: { ru: "Про", en: "Pro" },
              price: { amount: 49, currency: "RUB", billingPeriod: "month" }
            }
          })
        ]}
        currentPlanCode={null}
        signedIn
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Your current plan is TRIAL. If you do not start a paid subscription, FREE will be enabled after the trial ends."
        )
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
    expect(billingMocks.postAssistantBillingChangePlan).not.toHaveBeenCalled();
  });

  it("blocks unsupported cross-period plan changes before raw submit", async () => {
    billingMocks.getAssistantBillingSubscription.mockResolvedValue({
      planCode: "basic",
      planDisplayName: "Basic",
      subscriptionStatus: "active",
      billingProvider: "cloudpayments",
      providerSubscriptionRef: "sub-1",
      autoRenewEnabled: true,
      canDisableAutoRenew: true,
      canScheduleDowngrade: true,
      canSwitchToFree: true,
      nextChargeAt: "2026-05-12T00:00:00.000Z",
      currentPeriodEndsAt: "2026-05-12T00:00:00.000Z",
      lastPaymentMethodLabel: "Bank card",
      autoRenewMethodLabel: "Bank card",
      recurringMigration: billingRecurringMigrationIdle,
      managePaymentMethodUrl: null,
      managePaymentMethodMode: "unavailable",
      cancelUrl: null,
      scheduledPlanChange: null,
      warning: null
    });

    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "basic",
            displayName: "Basic",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Базовый", en: "Basic" },
              price: { amount: 19, currency: "RUB", billingPeriod: "month" }
            }
          }),
          makePlan({
            code: "pro-yearly",
            displayName: "Pro Yearly",
            presentation: {
              ...makePlan().presentation,
              title: { ru: "Про годовой", en: "Pro Yearly" },
              price: { amount: 499, currency: "RUB", billingPeriod: "year" }
            }
          })
        ]}
        currentPlanCode={null}
        signedIn
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Choose" })).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));

    expect(
      await screen.findByText("This plan change is not available right now.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Review upgrade")).toBeNull();
    expect(billingMocks.postAssistantBillingChangePlan).not.toHaveBeenCalled();
  });

  it("gives current plans a subtle background and keeps the PRO premium fill only in light theme", () => {
    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Бесплатно", en: "Free" },
              badge: { ru: null, en: null }
            }
          }),
          makePlan({
            code: "pro",
            displayName: "Pro"
          }),
          makePlan({
            code: "ultima",
            displayName: "Ultima",
            presentation: {
              ...makePlan().presentation,
              highlighted: false,
              title: { ru: "Ultima", en: "Ultima" },
              badge: { ru: null, en: null }
            }
          })
        ]}
        currentPlanCode="free"
        signedIn
      />
    );

    const currentCard = screen.getByText("Free").closest("section");
    const highlightedCard = screen.getByText("Pro").closest("section");
    const regularCard = screen.getByText("Ultima").closest("section");

    expect(currentCard?.className).toContain("bg-surface-raised/82");
    expect(currentCard?.className).not.toContain("border-transparent");
    expect(highlightedCard?.className).toContain("border-accent-premium/30");
    expect(highlightedCard?.className).toContain("bg-surface-raised/68");
    expect(highlightedCard?.className).toContain("hover:border-accent-premium/45");
    expect(regularCard?.className).toContain("border-border/80");
  });

  it("shows zero-price plans as free instead of a monthly currency price", () => {
    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "free",
            displayName: "Free",
            presentation: {
              ...makePlan().presentation,
              price: { amount: 0, currency: "RUB", billingPeriod: "month" },
              title: { ru: "Бесплатно", en: "Free" }
            }
          })
        ]}
        signedIn
      />
    );

    expect(screen.getAllByText("Free")).toHaveLength(2);
    expect(screen.queryByText(/RUB|₽/i)).not.toBeInTheDocument();
  });

  it("uses Connect as the signed-in fallback CTA when plan copy is missing", () => {
    renderView(
      <PricingPageView
        plans={[
          makePlan({
            code: "team",
            displayName: "Team",
            presentation: {
              ...makePlan().presentation,
              ctaLabel: { ru: null, en: null }
            }
          })
        ]}
        signedIn
      />
    );

    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("derives quiet fact chips from real plan limits", () => {
    const t = ((key: string, values?: Record<string, string | number>) => {
      switch (key) {
        case "factTokens":
          return `${values?.count} tokens`;
        case "factImages":
          return `${values?.count} images / month`;
        case "factVideos":
          return `${values?.count} videos / month`;
        case "factSkills":
          return `${values?.count} skills`;
        default:
          return key;
      }
    }) as unknown as Parameters<typeof derivePlanFacts>[1];

    expect(derivePlanFacts(makePlan(), t)).toEqual([
      "20,000 tokens",
      "30 images / month",
      "8 videos / month",
      "12 skills"
    ]);
  });

  it("hides disabled or zero-value facts", () => {
    const t = ((key: string, values?: Record<string, string | number>) => {
      switch (key) {
        case "factTokens":
          return `${values?.count} tokens`;
        case "factImages":
          return `${values?.count} images / month`;
        case "factVideos":
          return `${values?.count} videos / month`;
        case "factSkills":
          return `${values?.count} skills`;
        default:
          return key;
      }
    }) as unknown as Parameters<typeof derivePlanFacts>[1];

    expect(
      derivePlanFacts(
        makePlan({
          enabledToolCodes: [],
          quotaLimits: {
            tokenBudgetLimit: 20000,
            activeWebChatsLimit: 0,
            mediaStorageBytesLimit: 1000000,
            knowledgeStorageBytesLimit: 1000000,
            imageGenerateMonthlyUnitsLimit: 30,
            imageEditMonthlyUnitsLimit: 10,
            videoGenerateMonthlyUnitsLimit: 1
          },
          skillPolicy: {
            maxEnabledSkills: 0
          }
        }),
        t
      )
    ).toEqual(["20,000 tokens"]);
  });
});
