import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicPricingPlanState } from "@persai/contracts";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../messages/en.json";
import { PricingPageView, derivePlanFacts } from "./pricing-page-view";

const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => "token-1")
}));

const billingMocks = vi.hoisted(() => ({
  postAssistantBillingPaymentIntent: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: authMocks.getToken
  })
}));

vi.mock("../app/assistant-api-client", () => ({
  postAssistantBillingPaymentIntent: billingMocks.postAssistantBillingPaymentIntent
}));

afterEach(() => {
  cleanup();
  navigationMocks.push.mockReset();
  authMocks.getToken.mockClear();
  billingMocks.postAssistantBillingPaymentIntent.mockReset();
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
    renderView(<PricingPageView plans={[makePlan()]} signedIn={false} backHref="/" />);

    expect(screen.getByText("Choose your PersAI")).toBeInTheDocument();
    expect(screen.getByText("Popular")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose" })).toHaveAttribute("href", "/sign-up");
  });

  it("marks the current plan and lets signed-in users start checkout", async () => {
    billingMocks.postAssistantBillingPaymentIntent.mockResolvedValue({
      id: "pi-1"
    });
    renderView(
      <PricingPageView
        plans={[makePlan(), makePlan({ code: "team", displayName: "Team" })]}
        currentPlanCode="pro"
        signedIn
        backHref="/app"
      />
    );

    expect(screen.getByText("Already active")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    await waitFor(() => {
      expect(billingMocks.postAssistantBillingPaymentIntent).toHaveBeenCalledWith(
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
        backHref="/app"
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
        case "factChats":
          return `${values?.count} active chats`;
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
        case "factChats":
          return `${values?.count} active chats`;
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
