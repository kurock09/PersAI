import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks
}));

afterEach(() => {
  cleanup();
});

function makePlan(overrides: Partial<PublicPricingPlanState> = {}): PublicPricingPlanState {
  return {
    code: "pro",
    displayName: "Pro",
    description: "Premium plan",
    trialEnabled: true,
    trialDurationDays: 7,
    defaultOnRegistration: false,
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

    expect(screen.getByText("Choose the right PersAI access level")).toBeInTheDocument();
    expect(screen.getByText("Popular")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose" })).toHaveAttribute("href", "/sign-up");
  });

  it("marks the current plan and routes other plans through support for signed-in users", () => {
    renderView(
      <PricingPageView
        plans={[makePlan(), makePlan({ code: "team", displayName: "Team" })]}
        currentPlanCode="pro"
        signedIn
        backHref="/app"
      />
    );

    expect(screen.getByText("Already active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:support@persai.app")
    );
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
});
