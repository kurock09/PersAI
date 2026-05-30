import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypewriter } from "./use-typewriter";

afterEach(() => {
  vi.useRealTimers();
});

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts with empty visibleText and isDone=false for non-empty text", () => {
    const { result } = renderHook(() => useTypewriter("hello", false));
    expect(result.current.visibleText).toBe("");
    expect(result.current.isDone).toBe(false);
  });

  it("reveals text progressively and reaches isDone=true after enough time", async () => {
    const text = "hi";
    const { result } = renderHook(() => useTypewriter(text, false));

    // Advance enough for 2 chars (each ~38ms + jitter, so ~200ms is ample)
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.visibleText).toBe("hi");
    expect(result.current.isDone).toBe(true);
  });

  it("reveals full text immediately under reducedMotion", () => {
    const text = "instant text";
    const { result } = renderHook(() => useTypewriter(text, true));
    expect(result.current.visibleText).toBe("instant text");
    expect(result.current.isDone).toBe(true);
  });

  it("returns empty visibleText and isDone=true for empty text", () => {
    const { result } = renderHook(() => useTypewriter("", false));
    expect(result.current.visibleText).toBe("");
    expect(result.current.isDone).toBe(true);
  });

  it("reveals chars deterministically (no Math.random)", async () => {
    const text = "abc";
    const { result: r1 } = renderHook(() => useTypewriter(text, false));
    const { result: r2 } = renderHook(() => useTypewriter(text, false));

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // Both hooks should be at the same visible count since timing is deterministic.
    expect(r1.current.visibleText).toBe(r2.current.visibleText);
  });

  it("resets when text changes", async () => {
    let currentText = "hello";
    const { result, rerender } = renderHook(() => useTypewriter(currentText, false));

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.isDone).toBe(true);

    // Change the text — hook should reset.
    currentText = "new text";
    rerender();

    expect(result.current.visibleText).toBe("");
    expect(result.current.isDone).toBe(false);
  });
});
