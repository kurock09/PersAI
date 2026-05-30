/**
 * Focused rendering tests for the three Tier-2 landing blocks.
 *
 * Strategy:
 * - Mock `useInViewOnce` to return `inView: true` so all reveal animations
 *   are in their final (visible) state.
 * - Mock `next-intl` with flat key→value map so blocks render without a
 *   real next-intl provider.
 * - Mock `framer-motion` to render children synchronously (no animation
 *   timing issues in the test environment).
 * - Assert that key copy and structural labels are present in the DOM.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockProject } from "./block-project";
import { BlockKnowledge } from "./block-knowledge";
import { BlockMedia } from "./block-media";

/* ------------------------------------------------------------------ */
/* Mocks                                                                */
/* ------------------------------------------------------------------ */

vi.mock("./use-in-view-once", () => ({
  useInViewOnce: () => ({ ref: { current: null }, inView: true })
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      variants: _variants,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      variants?: unknown;
    }) => {
      void _initial;
      void _animate;
      void _exit;
      void _transition;
      void _variants;
      return <div {...rest}>{children}</div>;
    },
    p: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      variants: _variants,
      ...rest
    }: React.HTMLAttributes<HTMLParagraphElement> & {
      children?: React.ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      variants?: unknown;
    }) => {
      void _initial;
      void _animate;
      void _exit;
      void _transition;
      void _variants;
      return <p {...rest}>{children}</p>;
    }
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false
}));

const BLOCK_MESSAGES: Record<string, string> = {
  // Project block
  "landing.blocks.project.tag": "Project mode",
  "landing.blocks.project.windowLabel": "Project mode demo",
  "landing.blocks.project.title": "Your assistant inside your project",
  "landing.blocks.project.body":
    "Skills, files, and memory in one context. No copy-paste between tools.",
  "landing.blocks.project.skillsLabel": "Skills",
  "landing.blocks.project.skill1": "Documents",
  "landing.blocks.project.skill2": "Research",
  "landing.blocks.project.skill3": "Strategy",
  "landing.blocks.project.file1": "Product-Brief.pdf",
  "landing.blocks.project.file1Meta": "2.4 MB",
  "landing.blocks.project.file2": "Roadmap-Q3.pptx",
  "landing.blocks.project.file2Meta": "8 slides",
  "landing.blocks.project.composerPlaceholder": "Ask Luma about this project…",
  "landing.blocks.project.userPrompt": "Summarize the brief into an executive update",
  "landing.blocks.project.assistantReply": "Done — here's the one-page summary, ready for sharing.",
  "landing.blocks.project.artifactName": "Executive-Update.pdf",
  "landing.blocks.project.artifactMeta": "1 page",
  "landing.demo.modes.normal": "Normal",
  "landing.demo.modes.smart": "Smart",
  "landing.demo.modes.project": "Project",
  "landing.demo.modes.normalCaption": "faster",
  "landing.demo.modes.smartCaption": "deeper",
  "landing.demo.modes.projectCaption": "project context",
  "landing.demo.cta.primary": "Start free",
  "landing.demo.stub.genericAckPrefix": "Create your own assistant",
  "landing.demo.stub.genericAckLink": "right now →",
  "landing.demo.sidebar.statusLabel": "Active",
  "landing.demo.sidebar.userName": "Alex",
  "landing.demo.sidebar.userPlan": "Pro plan",
  // Knowledge block
  "landing.blocks.knowledge.tag": "Knowledge base",
  "landing.blocks.knowledge.windowLabel": "Knowledge base demo",
  "landing.blocks.knowledge.title": "Answers grounded in your own sources",
  "landing.blocks.knowledge.body": "The assistant shows you exactly which source it used.",
  "landing.blocks.knowledge.filesTitle": "Project files",
  "landing.blocks.knowledge.sourcesLabel": "Sources",
  "landing.blocks.knowledge.source1": "product-brief.pdf",
  "landing.blocks.knowledge.source2": "market-research.docx",
  "landing.blocks.knowledge.citedSource": "strategy-2025.pdf",
  "landing.blocks.knowledge.citedLabel": "Source used",
  "landing.blocks.knowledge.composerPlaceholder": "Ask across your sources…",
  "landing.blocks.knowledge.userPrompt": "What are the key differentiators?",
  "landing.blocks.knowledge.assistantReply":
    "Per your strategy doc, three main points: speed, context depth, and privacy-first design.",
  // Media block
  "landing.blocks.media.tag": "Media",
  "landing.blocks.media.windowLabel": "Media before/after demo",
  "landing.blocks.media.title": "Not just text — works with media",
  "landing.blocks.media.body": "Upload a photo, get a calm edit back.",
  "landing.blocks.media.beforeLabel": "Before",
  "landing.blocks.media.afterLabel": "After",
  "landing.blocks.media.userPrompt": "Make me look like a cartoon",
  "landing.blocks.media.workingReply":
    "Done. It is processing now. I will send it separately when it is ready.",
  "landing.blocks.media.progressLabel": "Editing image 0:12",
  "landing.blocks.media.assistantReply": "Ready. The cartoon version is here.",
  "landing.blocks.media.secondaryChat": "Launch cover visual",
  "landing.blocks.media.composerPlaceholder": "Ask Luma to adjust media…",
  "landing.blocks.media.lightboxClose": "Close",
  "landing.blocks.media.originalAlt": "Original photo",
  "landing.blocks.media.resultAlt": "Edited cartoon photo"
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const value = BLOCK_MESSAGES[key];
    if (value === undefined) throw new Error(`missing block translation: ${key}`);
    return value;
  }
}));

vi.mock("@/app/app/_components/assistant-avatar", () => ({
  AssistantAvatar: () => <span data-testid="assistant-avatar" />
}));

afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------------ */
/* BlockProject                                                          */
/* ------------------------------------------------------------------ */

describe("BlockProject", () => {
  it("renders tag, title, body, project mode selector, and thread", () => {
    render(<BlockProject />);

    expect(screen.getByLabelText("Project mode demo")).toBeInTheDocument();
    expect(screen.getAllByText("Your assistant inside your project").length).toBeGreaterThan(0);
    expect(screen.getByText(/No copy-paste between tools/)).toBeInTheDocument();

    // The production-style DemoWindow shell carries the same mode selector as the hero demo.
    expect(screen.getByRole("button", { name: /Normal/i })).toBeInTheDocument();
    expect(screen.queryByText("Roadmap-Q3.pptx")).not.toBeInTheDocument();

    // Chat thread
    expect(screen.getByText("Summarize the brief into an executive update")).toBeInTheDocument();
    expect(screen.getByText(/one-page summary/)).toBeInTheDocument();

    // Produced artifact
    expect(screen.getByText("Executive-Update.pdf")).toBeInTheDocument();
  });

  it("renders with reversed layout", () => {
    render(<BlockProject reversed />);
    expect(screen.getAllByText("Your assistant inside your project").length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* BlockKnowledge                                                        */
/* ------------------------------------------------------------------ */

describe("BlockKnowledge", () => {
  it("renders tag, title, body, files sidebar, and chat thread", () => {
    render(<BlockKnowledge />);

    expect(screen.getByLabelText("Knowledge base demo")).toBeInTheDocument();
    expect(screen.getAllByText("Answers grounded in your own sources").length).toBeGreaterThan(0);
    expect(screen.getByText(/exactly which source it used/)).toBeInTheDocument();

    // Files sidebar
    expect(screen.getByText("Project files")).toBeInTheDocument();
    expect(screen.getAllByText("product-brief.pdf").length).toBeGreaterThan(0);
    expect(screen.getAllByText("market-research.docx").length).toBeGreaterThan(0);
    expect(screen.getAllByText("strategy-2025.pdf").length).toBeGreaterThan(0);

    // Chat thread
    expect(screen.getByText("What are the key differentiators?")).toBeInTheDocument();
    expect(screen.getByText(/three main points/)).toBeInTheDocument();

    // Citation label (visible when inView=true)
    expect(screen.getByText("Source used")).toBeInTheDocument();
  });

  it("renders with reversed layout", () => {
    render(<BlockKnowledge reversed />);
    expect(screen.getAllByText("Answers grounded in your own sources").length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* BlockMedia                                                            */
/* ------------------------------------------------------------------ */

describe("BlockMedia", () => {
  it("renders tag, title, body, media job status, and chat thread", () => {
    render(<BlockMedia />);

    expect(screen.getAllByText("Media").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not just text — works with media").length).toBeGreaterThan(0);
    expect(screen.getByText(/calm edit back/)).toBeInTheDocument();

    // Chat thread
    expect(screen.getByText("Make me look like a cartoon")).toBeInTheDocument();
    expect(screen.getByText("Editing image 0:12")).toBeInTheDocument();
    expect(screen.getByText("Ready. The cartoon version is here.")).toBeInTheDocument();
    expect(screen.getByAltText("Original photo")).toBeInTheDocument();
    expect(screen.getByAltText("Edited cartoon photo")).toBeInTheDocument();
  });

  it("renders with reversed layout", () => {
    render(<BlockMedia reversed />);
    expect(screen.getAllByText("Not just text — works with media").length).toBeGreaterThan(0);
  });
});
