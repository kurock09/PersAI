import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const LANDING_MESSAGES: Record<string, string> = {
  eyebrow: "Personal AI · your context, your tools",
  headlineLine1: "Personal AI,",
  headlineLine2: "built around you.",
  subtitle: "Chat, documents, media, knowledge, and skills in one system. For life and work.",
  cta: "Start free",
  ctaSecondary: "Sign in",
  scrollHint: "What it does",
  soon: "soon",
  "workflow.eyebrow": "What PersAI does",
  "workflow.title": "One assistant. One continuous workflow.",
  "workflow.subtitle": "From conversation to finished artifact.",

  "system.eyebrow": "Personal system",
  "system.title": "Personal system.",
  "system.lead":
    "PersAI stays with you — in the dense context of the day and in the work with documents and materials. One tool, not five separate AI chats.",
  "system.pillars.personality.title": "Your character. Your voice.",
  "system.pillars.personality.body": "Name, avatar, tone, and voice — the assistant becomes yours.",
  "system.pillars.memory.title": "Remembers and continues.",
  "system.pillars.memory.body": "Keeps your context, preferences, and important details.",
  "system.pillars.action.title": "Not just answers — action.",
  "system.pillars.action.body":
    "Plans, reminds, runs background jobs. Creates documents and media.",
  "system.pillars.knowledge.title": "Knows what you know.",
  "system.pillars.knowledge.body":
    "Knowledge base, files, and Skills work in your professional context.",
  "system.channels.eyebrow": "Where it works",
  "system.channels.web.label": "Web",
  "system.channels.web.sub": "you're here",
  "system.channels.telegram.label": "Telegram",
  "system.channels.telegram.sub": "your personal AI in Telegram.",
  "system.channels.android.label": "Android",
  "system.channels.android.sub": "Download APK",
  "system.channels.android.ariaLabel": "Download PersAI for Android (APK)",
  "system.channels.ios.label": "iOS",
  "system.channels.ios.sub": "soon",

  "finale.eyebrow": "Get started",
  "finale.titleLine1": "One step",
  "finale.titleLine2": "to your own PersAI.",
  "finale.body": "Set up your assistant in a minute. Start free — expand as your workflow grows.",
  "finale.trust.fastStart": "Start in a couple of minutes",
  "finale.trust.payment": "SBP and local cards",
  "finale.trust.access": "Works without VPN",
  "finale.ctaPrimary": "Start free",
  "finale.ctaSecondary": "View pricing",
  "finale.note": "No card required to start. Cancel anytime.",
  androidAppEyebrow: "Android release",
  androidAppTitle: "PersAI for Android",
  androidAppBody:
    "Install the APK to use PersAI as an app: the same web product, native sharing, and faster access from your phone.",
  androidAppCta: "Download APK",
  androidAppVersion: "v{version} · build {code}",
  plans: "Plans",
  termsLink: "Terms",
  privacyLink: "Privacy",
  contactsLink: "Contacts",
  requisitesLink: "Company details",
  terms: "By continuing you agree to the Terms of Service"
};

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const prefix = namespace === "landing" ? "" : namespace.replace(/^landing\.?/, "");
    return (key: string) => {
      const fullKey = prefix.length > 0 ? `${prefix}.${key}` : key;
      const value = LANDING_MESSAGES[fullKey];
      if (value === undefined) {
        throw new Error(`missing landing translation: ${fullKey}`);
      }
      return value;
    };
  }
}));

vi.mock("./_components/landing-locale-switcher", () => ({
  LandingLocaleSwitcher: () => <div data-testid="landing-locale-switcher" />
}));

vi.mock("./_components/landing-theme-toggle", () => ({
  LandingThemeToggle: () => <div data-testid="landing-theme-toggle" />
}));

// HeroDemo is a "use client" island that calls useTranslations() and framer-motion
// hooks — neither of which are available in the server-component render test.
// Mock it with a stable, side-effect-free stub so hero-section renders cleanly.
vi.mock("./_components/landing/demo/hero-demo", () => ({
  HeroDemo: () => <div data-testid="hero-demo-stub" />
}));

// Tier-2 block components are "use client" and use IntersectionObserver /
// framer-motion — both unavailable in the server-component render test.
vi.mock("./_components/landing/demo/block-project", () => ({
  BlockProject: () => <div data-testid="block-project-stub">Your assistant inside your project</div>
}));
vi.mock("./_components/landing/demo/block-knowledge", () => ({
  BlockKnowledge: () => (
    <div data-testid="block-knowledge-stub">Answers grounded in your own sources</div>
  )
}));
vi.mock("./_components/landing/demo/block-media", () => ({
  BlockMedia: () => <div data-testid="block-media-stub">Not just text — works with media</div>
}));

afterEach(() => {
  cleanup();
  delete (window as unknown as { PersaiNative?: unknown }).PersaiNative;
});

describe("Landing page", () => {
  // The full landing page renders four async server sections, each with its
  // own pseudo-3D surfaces and a long string of getByText assertions, so the
  // default 5s vitest timeout can be flaky on slower machines / CI agents.
  // 15s is comfortably above the steady-state ~6s render we observe locally.
  it("renders hero, 3-block workflow, unified system block, and finale", async () => {
    const view = await HomePage();
    render(view);

    // Hero — clean, no capability rail anymore.
    expect(screen.getByText("Personal AI,")).toBeInTheDocument();
    expect(screen.getByText("built around you.")).toBeInTheDocument();
    expect(screen.queryByText("Context memory")).not.toBeInTheDocument();

    // Three Tier-2 blocks — rendered as client stubs in this test environment.
    expect(screen.getByTestId("block-project-stub")).toBeInTheDocument();
    expect(screen.getByTestId("block-knowledge-stub")).toBeInTheDocument();
    expect(screen.getByTestId("block-media-stub")).toBeInTheDocument();

    // Block stubs surface their titles for quick human scanability.
    expect(screen.getByText("Your assistant inside your project")).toBeInTheDocument();
    expect(screen.getByText("Answers grounded in your own sources")).toBeInTheDocument();
    expect(screen.getByText("Not just text — works with media")).toBeInTheDocument();

    // Unified «Personal system» block — pillars + audience-in-lead + channels.
    expect(screen.getByText("Personal system.")).toBeInTheDocument();
    expect(screen.getByText(/dense context of the day/)).toBeInTheDocument();
    expect(screen.getByText("Your character. Your voice.")).toBeInTheDocument();
    expect(screen.getByText("Remembers and continues.")).toBeInTheDocument();
    expect(screen.getByText("Not just answers — action.")).toBeInTheDocument();
    expect(screen.getByText("Knows what you know.")).toBeInTheDocument();

    // Channels — Web/Telegram are status tiles, Android is a download link,
    // iOS is muted.
    expect(screen.getByText("you're here")).toBeInTheDocument();
    expect(screen.getByText(/personal AI in Telegram/)).toBeInTheDocument();
    expect(screen.getByText("soon")).toBeInTheDocument();

    // Finale — typographic two-line headline (rhymes with hero).
    expect(screen.getByText("One step")).toBeInTheDocument();
    expect(screen.getByText("to your own PersAI.")).toBeInTheDocument();
    expect(screen.getByText("Start in a couple of minutes")).toBeInTheDocument();
    expect(screen.getByText("SBP and local cards")).toBeInTheDocument();
    expect(screen.getByText("Works without VPN")).toBeInTheDocument();
    expect(screen.queryByText("Calm access")).not.toBeInTheDocument();
    expect(screen.getByText("No card required to start. Cancel anytime.")).toBeInTheDocument();

    const startLinks = screen.getAllByRole("link", { name: "Start free" });
    expect(startLinks.length).toBeGreaterThanOrEqual(1);
    expect(startLinks[0]).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /View pricing/ })).toHaveAttribute("href", "/pricing");

    // Android channel tile is now the only APK download surface — the
    // duplicate footer download was removed so the page does not ship two
    // identical CTAs separated by a few lines of nav links.
    const apkLinks = await screen.findAllByRole("link", {
      name: /(Download APK|Download PersAI for Android)/i
    });
    expect(apkLinks).toHaveLength(1);
    expect(apkLinks[0]).toHaveAttribute("href", "/mobile/persai-android-release.apk");
  }, 15000);

  it("hides the Android APK channel tile inside the native shell", async () => {
    (window as unknown as { PersaiNative?: unknown }).PersaiNative = {};

    const view = await HomePage();
    render(view);

    expect(
      screen.queryByRole("link", { name: /(Download APK|Download PersAI for Android)/i })
    ).not.toBeInTheDocument();
  });
});
