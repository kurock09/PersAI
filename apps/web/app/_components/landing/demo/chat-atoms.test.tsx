import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRow, ArtifactPill, MemoryChip, UserBubble } from "./chat-atoms";

vi.mock("@/app/app/_components/assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
  }) => <img src={src} alt={alt} width={width} height={height} />
}));

afterEach(() => {
  cleanup();
});

describe("AssistantRow", () => {
  it("renders the given text and an avatar", () => {
    render(<AssistantRow>Hello from assistant</AssistantRow>);

    expect(screen.getByText("Hello from assistant")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-avatar")).toBeInTheDocument();
  });

  it("accepts optional name, avatarUrl, and avatarEmoji props without error", () => {
    render(
      <AssistantRow name="Aurora" avatarEmoji="✨">
        Ready when you are
      </AssistantRow>
    );

    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
  });
});

describe("UserBubble", () => {
  it("renders text inside the bubble element carrying bg-accent/15 and rounded-br-md classes", () => {
    const { container } = render(<UserBubble>User message</UserBubble>);

    expect(screen.getByText("User message")).toBeInTheDocument();

    const bubble = container.querySelector("div.bg-accent\\/15.rounded-br-md");
    expect(bubble).not.toBeNull();
    expect(bubble?.className).toContain("bg-accent/15");
    expect(bubble?.className).toContain("rounded-br-md");
  });
});

describe("ArtifactPill", () => {
  it("renders the filename and PDF format label for pdf kind", () => {
    render(<ArtifactPill kind="pdf" filename="report.pdf" />);

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("renders PPT label for pptx kind", () => {
    render(<ArtifactPill kind="pptx" filename="slides.pptx" meta="2.1 MB" />);

    expect(screen.getByText("slides.pptx")).toBeInTheDocument();
    expect(screen.getByText("PPT")).toBeInTheDocument();
    expect(screen.getByText("2.1 MB")).toBeInTheDocument();
  });

  it("renders DOC label for docx kind", () => {
    render(<ArtifactPill kind="docx" filename="brief.docx" />);

    expect(screen.getByText("brief.docx")).toBeInTheDocument();
    expect(screen.getByText("DOC")).toBeInTheDocument();
  });

  it("omits the meta span when meta is not provided", () => {
    const { container } = render(<ArtifactPill kind="pdf" filename="doc.pdf" />);

    const spans = container.querySelectorAll("span.shrink-0.text-text-subtle");
    expect(spans).toHaveLength(0);
  });
});

describe("MemoryChip", () => {
  it("renders its label", () => {
    render(<MemoryChip label="Prefers dark mode" />);

    expect(screen.getByText("Prefers dark mode")).toBeInTheDocument();
  });
});
