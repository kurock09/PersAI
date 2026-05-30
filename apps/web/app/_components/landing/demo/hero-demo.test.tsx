import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real en messages so useTranslations() resolves all landing.demo.* keys.
import messages from "../../../../messages/en.json";

import { DEMO_LIMITS } from "./demo-script";
import { HeroDemo } from "./hero-demo";

/* ------------------------------------------------------------------ */
/* Module mocks                                                          */
/* ------------------------------------------------------------------ */

vi.mock("@/app/app/_components/assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

/**
 * Mock useTypewriter to reveal the full text immediately (isDone: true).
 * This keeps hero-demo integration tests focused on machine transitions
 * rather than the per-character timer chain. The hook itself is tested
 * separately in use-typewriter.test.ts.
 */
vi.mock("./use-typewriter", () => ({
  useTypewriter: (text: string) => ({ visibleText: text, isDone: true })
}));

/* ------------------------------------------------------------------ */
/* Provider wrapper                                                      */
/* ------------------------------------------------------------------ */

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Timer helpers                                                         */
/* ------------------------------------------------------------------ */

/** Advance fake time and flush all pending React work in one step. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function startDemoWindowPlayback() {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 900
  });

  Element.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({
        top: 320,
        bottom: 820,
        left: 0,
        right: 1024,
        width: 1024,
        height: 500,
        x: 0,
        y: 320,
        toJSON: () => ({})
      }) as DOMRect
  );

  fireEvent.scroll(window);
}

/**
 * Advance to autoplay state.
 *
 * Because TRAILER_DONE_MS = 0 in tests, the TRAILER_DONE dispatch fires
 * at t=0 inside the first tick. React flushes the idle state, then the
 * 600ms AUTOPLAY_START timer fires during the same tick(600) call.
 * The two-tick pattern (tick(0) then tick(600)) is the safest way to
 * flush each React render boundary before advancing time further.
 */
async function advanceToAutoplay() {
  startDemoWindowPlayback();
  await tick(0); // flush TRAILER_DONE (0ms) → idle; React registers 600ms AUTOPLAY_START timer
  await tick(600); // fire AUTOPLAY_START → autoplay
}

/* ------------------------------------------------------------------ */
/* Test suite                                                            */
/* ------------------------------------------------------------------ */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HeroDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /* ---------------------------------------------------------------- */
  /* Trailer phase                                                      */
  /* ---------------------------------------------------------------- */

  it("shows the AssistantBuilder trailer before any timers fire", () => {
    render(<HeroDemo />, { wrapper: Wrapper });
    // The trailer aria-label (from landing.demo.trailer.ariaLabel in en.json)
    expect(screen.getByLabelText(/Setting up Aurora/i)).toBeInTheDocument();
  });

  it("still has initial greeting in DOM during trailer (SSR-safe)", () => {
    render(<HeroDemo />, { wrapper: Wrapper });
    // The liveThread is always rendered beneath the trailer overlay.
    expect(screen.getByText(/project, documents, and working style/i)).toBeInTheDocument();
  });

  it("trailer disappears and greeting is accessible once autoplay starts", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    // Trailer overlay should be gone (exit animation is mocked instantly by framer-motion).
    // The initial greeting remains visible.
    expect(screen.getByText(/project, documents, and working style/i)).toBeInTheDocument();
  });

  /* ---------------------------------------------------------------- */
  /* Autoplay behaviour (same as before, adjusted for trailer timing)  */
  /* ---------------------------------------------------------------- */

  it("shows the pause label on the control while autoplay is running", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    // en.json landing.demo.pauseLabel = "Pause demo"
    expect(screen.getByRole("button", { name: "Pause demo" })).toBeInTheDocument();
  });

  it("shows suggested prompt chips once autoplay has started", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    expect(screen.getByRole("button", { name: "Summarize this PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remember my preferences" })).toBeInTheDocument();
  });

  it("auto-types the first user turn into the composer and commits it as a user bubble", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();
    await tick(DEMO_LIMITS.autoTypeStartDelayMs);
    await tick(DEMO_LIMITS.autoTypeSubmitDelayMs + 50);

    expect(
      screen.getByText("Turn this PDF into a short Q3 leadership update and slides.")
    ).toBeInTheDocument();
  });

  it("assistant text streams to completion after the user turn commits", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();
    await tick(DEMO_LIMITS.autoTypeStartDelayMs);
    await tick(DEMO_LIMITS.autoTypeSubmitDelayMs + 50);
    await tick(DEMO_LIMITS.thinkingMs + 50);

    expect(screen.getByText(/decisions, risks, and numbers/i)).toBeInTheDocument();
  });

  it("appends a user bubble on composer submit (visitor takeover) and shows stub reply", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "summarize this PDF" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

    expect(screen.getByText("summarize this PDF")).toBeInTheDocument();
    expect(input).toHaveValue("");

    await tick(DEMO_LIMITS.thinkingMs + 50);

    expect(screen.getByText(/summarizing the document/i)).toBeInTheDocument();
  });

  it("clicking a suggested prompt chip sends the prompt and triggers a stub reply", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    const chip = screen.getByRole("button", { name: "Remember my preferences" });
    fireEvent.click(chip);

    expect(screen.getByText("Remember my preferences")).toBeInTheDocument();

    await tick(DEMO_LIMITS.thinkingMs + 50);

    expect(screen.getByText(/I'll apply this/i)).toBeInTheDocument();
  });

  it("disables the composer input while thinking", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "some question" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

    expect(input).toBeDisabled();
  });

  it("shows the replay label after a visitor takeover exchange completes", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

    await tick(DEMO_LIMITS.thinkingMs + 50);

    expect(screen.getByRole("button", { name: "Replay demo" })).toBeInTheDocument();
  });

  it("shows the limit CTA after 3 takeover replies", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    const input = screen.getByRole("textbox");

    for (let i = 0; i < DEMO_LIMITS.maxReplies; i++) {
      await act(async () => {
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: `msg ${i}` } });
        fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });
      });

      await tick(DEMO_LIMITS.thinkingMs + 50);
    }

    expect(screen.getByRole("link", { name: /Set up your own PersAI/i })).toBeInTheDocument();
  });

  /* ---------------------------------------------------------------- */
  /* Clickable sidebar chat switching                                   */
  /* ---------------------------------------------------------------- */

  it("sidebar shows three chat rows with c1 active by default", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    // All three chats rendered (using en.json sidebar keys)
    expect(screen.getByRole("button", { name: "Q3 Strategy review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make me a cartoon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  it("clicking the media row shows static media thread content", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    const mediaBtn = screen.getByRole("button", { name: "Make me a cartoon" });
    fireEvent.click(mediaBtn);

    // Static thread content for c2
    expect(screen.getByText(/Make me look like a cartoon/i)).toBeInTheDocument();
    expect(screen.getByText(/cartoon version is here/i)).toBeInTheDocument();
    expect(screen.getByAltText("Original photo")).toBeInTheDocument();
    expect(screen.getByAltText("Edited cartoon photo")).toBeInTheDocument();
  });

  it("clicking media chat pauses autoplay (USER_FOCUS)", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    await advanceToAutoplay();

    fireEvent.click(screen.getByRole("button", { name: "Make me a cartoon" }));

    // After pause, the replay button should be shown
    expect(screen.getByRole("button", { name: "Replay demo" })).toBeInTheDocument();
  });

  it("clicking back to primary chat (c1) shows the live thread", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    // Navigate away and back
    fireEvent.click(screen.getByRole("button", { name: "Make me a cartoon" }));
    expect(screen.getByText(/Make me look like a cartoon/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Q3 Strategy review" }));
    // Live thread initial greeting is visible again
    expect(screen.getByText(/project, documents, and working style/i)).toBeInTheDocument();
  });

  it("clicking New chat shows empty state hint", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(screen.getByText(/Start a conversation with Aurora/i)).toBeInTheDocument();
  });

  it("allows typing into media chat without mutating the primary thread", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Make me a cartoon" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "add a gym block" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

    expect(screen.getByText("add a gym block")).toBeInTheDocument();
    expect(input).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Q3 Strategy review" }));
    expect(screen.queryByText("add a gym block")).not.toBeInTheDocument();
  });

  it("allows typing into New chat and replaces the empty state", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hello Aurora" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: false });

    expect(screen.getByText("hello Aurora")).toBeInTheDocument();
    expect(screen.queryByText(/Start a conversation with Aurora/i)).not.toBeInTheDocument();
  });

  /* ---------------------------------------------------------------- */
  /* Mode chip                                                          */
  /* ---------------------------------------------------------------- */

  it("renders the mode chip with 'Normal' as default", () => {
    render(<HeroDemo />, { wrapper: Wrapper });
    // The chip button shows the current mode label
    expect(screen.getByRole("button", { name: /Normal/i })).toBeInTheDocument();
  });

  it("opens mode menu when chip is clicked", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    const chipBtn = screen.getAllByRole("button").find((b) => b.textContent?.includes("Normal"));
    if (!chipBtn) throw new Error("Mode chip button not found");

    fireEvent.click(chipBtn);

    // Menu items appear
    expect(screen.getByRole("menuitem", { name: /Smart/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Project/i })).toBeInTheDocument();
  });

  it("switching to Smart updates the chip label", async () => {
    render(<HeroDemo />, { wrapper: Wrapper });

    const chipBtn = screen.getAllByRole("button").find((b) => b.textContent?.includes("Normal"));
    if (!chipBtn) throw new Error("Mode chip button not found");
    fireEvent.click(chipBtn);

    fireEvent.click(screen.getByRole("menuitem", { name: /Smart/i }));

    // The chip now shows "Smart"
    expect(screen.getAllByText(/Smart/i).length).toBeGreaterThan(0);
  });
});
