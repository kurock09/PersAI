import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  StreamingThreadsProvider,
  useIsThreadStreaming,
  useStreamingThreadsRegistry
} from "./streaming-threads";

function withProvider({ children }: { children: ReactNode }) {
  return <StreamingThreadsProvider>{children}</StreamingThreadsProvider>;
}

describe("StreamingThreadsRegistry", () => {
  it("tracks active threads independently and exposes per-thread booleans", () => {
    const { result } = renderHook(
      () => {
        const registry = useStreamingThreadsRegistry();
        const isThreadAStreaming = useIsThreadStreaming("thread-a");
        const isThreadBStreaming = useIsThreadStreaming("thread-b");
        return { registry, isThreadAStreaming, isThreadBStreaming };
      },
      { wrapper: withProvider }
    );

    expect(result.current.registry.activeThreads.size).toBe(0);
    expect(result.current.isThreadAStreaming).toBe(false);
    expect(result.current.isThreadBStreaming).toBe(false);

    act(() => {
      result.current.registry.markStreaming("thread-a", true);
    });
    expect(result.current.isThreadAStreaming).toBe(true);
    expect(result.current.isThreadBStreaming).toBe(false);

    act(() => {
      result.current.registry.markStreaming("thread-b", true);
    });
    expect(result.current.isThreadAStreaming).toBe(true);
    expect(result.current.isThreadBStreaming).toBe(true);

    act(() => {
      result.current.registry.markStreaming("thread-a", false);
    });
    expect(result.current.isThreadAStreaming).toBe(false);
    expect(result.current.isThreadBStreaming).toBe(true);
  });

  it("treats repeated marks with the same value as a no-op (returns the same Set)", () => {
    const { result } = renderHook(() => useStreamingThreadsRegistry(), { wrapper: withProvider });

    act(() => {
      result.current.markStreaming("thread-x", true);
    });
    const setAfterFirstMark = result.current.activeThreads;

    act(() => {
      result.current.markStreaming("thread-x", true);
    });
    expect(result.current.activeThreads).toBe(setAfterFirstMark);

    act(() => {
      result.current.markStreaming("thread-y", false);
    });
    expect(result.current.activeThreads).toBe(setAfterFirstMark);
  });

  it("falls back to a hook-local registry when no provider is mounted", () => {
    const { result } = renderHook(() => useStreamingThreadsRegistry());

    expect(result.current.activeThreads.size).toBe(0);

    act(() => {
      result.current.markStreaming("thread-orphan", true);
    });
    expect(result.current.activeThreads.has("thread-orphan")).toBe(true);
  });
});
