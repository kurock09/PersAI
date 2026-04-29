import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const clerkServerMocks = vi.hoisted(() => ({
  auth: vi.fn().mockResolvedValue({ userId: null })
}));

const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn()
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerkServerMocks.auth
}));

vi.mock("next/navigation", () => ({
  redirect: navigationMocks.redirect
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    if (namespace !== "landing") {
      throw new Error(`unexpected namespace: ${namespace}`);
    }

    const messages = {
      eyebrow: "Personal AI · context that stays with you",
      headlineLine1: "Your AI that remembers context.",
      headlineLine2: "",
      subtitle: "Chats, tasks, and context across web and Telegram.",
      capabilityMemory: "Remembers context",
      capabilityChannels: "Web and Telegram",
      capabilityTasks: "Carries tasks forward",
      cta: "Get started free",
      ctaSecondary: "Sign in",
      plans: "Plans",
      termsLink: "Terms",
      privacyLink: "Privacy",
      contactsLink: "Contacts",
      requisitesLink: "Company details",
      terms: "By continuing you agree to the Terms of Service"
    } as const;

    return (key: keyof typeof messages) => messages[key];
  }
}));

vi.mock("./_components/landing-locale-switcher", () => ({
  LandingLocaleSwitcher: () => <div data-testid="landing-locale-switcher" />
}));

vi.mock("./_components/landing-theme-toggle", () => ({
  LandingThemeToggle: () => <div data-testid="landing-theme-toggle" />
}));

describe("Landing page", () => {
  it("keeps the premium capability labels without the messenger strip", async () => {
    const view = await HomePage();
    render(view);

    expect(screen.getByText("Remembers context")).toBeInTheDocument();
    expect(screen.getByText("Web and Telegram")).toBeInTheDocument();
    expect(screen.getByText("Carries tasks forward")).toBeInTheDocument();
    expect(screen.queryByText(/^Telegram$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^VK$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^WhatsApp$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^MAX$/)).not.toBeInTheDocument();
  });
});
