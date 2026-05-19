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

  "workflow.scenes.personality.tag": "Your assistant",
  "workflow.scenes.personality.title": "Name, voice, character",
  "workflow.scenes.personality.body":
    "Give your assistant a name, avatar, tone, and voice. Talk to PersAI and hear it back.",
  "workflow.scenes.personality.surface.prompt": "What should I call you?",
  "workflow.scenes.personality.surface.reply": "I'm Aurora. How can I help?",
  "workflow.scenes.personality.surface.nameLabel": "Name",
  "workflow.scenes.personality.surface.chosenName": "Aurora",
  "workflow.scenes.personality.surface.toneLabel": "Tone",
  "workflow.scenes.personality.surface.toneWarm": "warm",
  "workflow.scenes.personality.surface.toneDirect": "direct",
  "workflow.scenes.personality.surface.toneFormal": "formal",
  "workflow.scenes.personality.surface.voiceLabel": "Voice",

  "workflow.scenes.memory.tag": "Conversation",
  "workflow.scenes.memory.title": "Conversation with memory",
  "workflow.scenes.memory.body": "PersAI carries your thread.",
  "workflow.scenes.memory.surface.prompt": "Plan a 4-week launch",
  "workflow.scenes.memory.surface.reply": "Prep -> Warm-up -> Launch -> Review",
  "workflow.scenes.memory.surface.recall": "What about week 2?",
  "workflow.scenes.memory.surface.memoryTag": "memory",

  "workflow.scenes.plans.tag": "Acts",
  "workflow.scenes.plans.title": "Plans and reminds",
  "workflow.scenes.plans.body": "PersAI schedules tasks and reminds you on time.",
  "workflow.scenes.plans.surface.prompt": "Prep a post for launch",
  "workflow.scenes.plans.surface.reply": "Scheduled. I'll remind you in the morning.",
  "workflow.scenes.plans.surface.task1": "Tomorrow 11:00 · post",
  "workflow.scenes.plans.surface.task2": "in 30 min · report",
  "workflow.scenes.plans.surface.task3": "in background · gathering data",
  "workflow.scenes.plans.surface.task4": "done · sent",

  "workflow.scenes.documents.tag": "Documents",
  "workflow.scenes.documents.title": "PDFs, decks, reports",
  "workflow.scenes.documents.body": "Creates PDFs and presentations.",
  "workflow.scenes.documents.surface.prompt": "Build a deck from this plan",
  "workflow.scenes.documents.surface.reply": "Done. Files attached.",
  "workflow.scenes.documents.surface.deckCaption": "Slide 1 / 12",
  "workflow.scenes.media.tag": "Media",
  "workflow.scenes.media.title": "Images and video",
  "workflow.scenes.media.body": "Generates visuals and video.",
  "workflow.scenes.media.surface.prompt": "Cover for the launch",
  "workflow.scenes.media.surface.reply": "Here are options",
  "workflow.scenes.knowledge.tag": "Knowledge",
  "workflow.scenes.knowledge.title": "Knowledge base and Skills",
  "workflow.scenes.knowledge.body": "Connect your documents and Skills.",
  "workflow.scenes.knowledge.surface.prompt": "What did we miss in the plan?",
  "workflow.scenes.knowledge.surface.reply": "Per sources, two items.",
  "workflow.scenes.knowledge.surface.skillsLabel": "Skills",
  "workflow.scenes.knowledge.surface.sourcesLabel": "Sources",
  "workflow.scenes.knowledge.surface.usingLabel": "using",
  "workflow.scenes.knowledge.surface.sourceFile": "project-brief.pdf",

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

afterEach(() => {
  cleanup();
  delete (window as unknown as { PersaiNative?: unknown }).PersaiNative;
});

describe("Landing page", () => {
  // The full landing page renders four async server sections, each with its
  // own pseudo-3D surfaces and a long string of getByText assertions, so the
  // default 5s vitest timeout can be flaky on slower machines / CI agents.
  // 15s is comfortably above the steady-state ~6s render we observe locally.
  it("renders hero, 6-scene workflow, unified system block, and finale", async () => {
    const view = await HomePage();
    render(view);

    // Hero — clean, no capability rail anymore.
    expect(screen.getByText("Personal AI,")).toBeInTheDocument();
    expect(screen.getByText("built around you.")).toBeInTheDocument();
    expect(screen.queryByText("Context memory")).not.toBeInTheDocument();

    // Workflow — 6 scenes, including the two new ones (Personality, Plans).
    expect(screen.getByText("Name, voice, character")).toBeInTheDocument();
    expect(screen.getByText("Conversation with memory")).toBeInTheDocument();
    expect(screen.getByText("Plans and reminds")).toBeInTheDocument();
    expect(screen.getByText("PDFs, decks, reports")).toBeInTheDocument();
    expect(screen.getByText("Images and video")).toBeInTheDocument();
    expect(screen.getByText("Knowledge base and Skills")).toBeInTheDocument();

    // Surface labels live inside the schematic itself.
    expect(screen.getAllByText("What about week 2?").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Slide 1 / 12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cover for the launch").length).toBeGreaterThan(0);
    expect(screen.getAllByText("project-brief.pdf").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aurora").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tomorrow 11:00 · post").length).toBeGreaterThan(0);

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
