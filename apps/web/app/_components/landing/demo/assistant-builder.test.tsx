import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantBuilder } from "./assistant-builder";

vi.mock("framer-motion", () => {
  const Passthrough = ({
    children,
    className
  }: {
    children?: React.ReactNode;
    className?: string;
    exit?: unknown;
    initial?: unknown;
    animate?: unknown;
    transition?: unknown;
  }) => <div className={className}>{children}</div>;

  return {
    motion: {
      div: Passthrough,
      span: Passthrough,
      button: Passthrough
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>
  };
});

const labels = {
  ariaLabel: "Setting up Aurora",
  title: "Create assistant",
  subtitle: "Avatar, name, tone, skills",
  nameLabel: "Name",
  namePlaceholder: "Assistant name",
  instructionLabel: "Instruction",
  instructionText:
    "You behave calmly, briefly, and professionally. You help with documents, summaries, and work-ready replies without fluff.",
  createLabel: "Create"
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AssistantBuilder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("renders with the aria-label", () => {
    render(
      <AssistantBuilder onDone={vi.fn()} shouldPlay={false} reducedMotion={false} labels={labels} />
    );
    expect(screen.getByLabelText("Setting up Aurora")).toBeInTheDocument();
  });

  it("does not complete before playback starts", async () => {
    const onDone = vi.fn();
    render(
      <AssistantBuilder onDone={onDone} shouldPlay={false} reducedMotion={false} labels={labels} />
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows instruction text and create CTA in the final state", async () => {
    // In test env (IS_TEST=true in assistant-builder), all timers are 0ms.
    render(
      <AssistantBuilder onDone={vi.fn()} shouldPlay={true} reducedMotion={false} labels={labels} />
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText("Instruction")).toBeInTheDocument();
    expect(screen.getByText(/behave calmly, briefly, and professionally/i)).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
  });

  it("calls onDone after animation completes", async () => {
    const onDone = vi.fn();
    render(
      <AssistantBuilder onDone={onDone} shouldPlay={true} reducedMotion={false} labels={labels} />
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onDone immediately under reducedMotion", async () => {
    const onDone = vi.fn();
    render(
      <AssistantBuilder onDone={onDone} shouldPlay={true} reducedMotion={true} labels={labels} />
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows instruction text and create CTA under reducedMotion", async () => {
    render(
      <AssistantBuilder onDone={vi.fn()} shouldPlay={true} reducedMotion={true} labels={labels} />
    );
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText("Instruction")).toBeInTheDocument();
    expect(screen.getByText(/behave calmly, briefly, and professionally/i)).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
  });
});
