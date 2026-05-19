"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Cross-thread streaming registry (Slice 1.1).
 *
 * The chat composer was wired to a single boolean `isStreaming` inside
 * `useChat(threadKey)`. Switching from Chat A (mid-stream) to Chat B kept
 * that boolean `true` for the new view, so the textarea in Chat B stayed
 * disabled until Chat A's stream completed or aborted. The fix is to lift
 * "which threads are currently streaming" into one shared registry that is
 * keyed by `threadKey`. The composer for Chat B then reads "is *this* thread
 * streaming?" rather than "is *any* stream running?".
 *
 * The registry is intentionally narrow: it carries only the active set, not
 * messages or pending-slot state. Each per-thread send still owns its own
 * `AbortController` so the Stop button on Chat B can't clobber Chat A's
 * in-flight request and vice versa. See `apps/web/app/app/_components/use-chat.ts`.
 *
 * Server-side soft-detach (so a closed SSE / backgrounded tab doesn't abort
 * the runtime turn) lives in Slice 1.2 — it requires API + runtime changes
 * and is out of scope here.
 */
export interface StreamingThreadsRegistry {
  /** Set of `threadKey`s with a stream currently in flight. */
  readonly activeThreads: ReadonlySet<string>;
  /** Set of `threadKey`s with background media jobs currently in flight. */
  readonly activeMediaThreads: ReadonlySet<string>;
  /** Set of `threadKey`s with background document jobs currently in flight. */
  readonly activeDocumentThreads: ReadonlySet<string>;
  /**
   * Mark a `threadKey` as streaming (`active: true`) or idle (`active: false`).
   * Idempotent — repeated calls with the same value do not trigger a
   * re-render of subscribers.
   */
  markStreaming(threadKey: string, active: boolean): void;
  /** Mark a `threadKey` as having active media jobs or not. */
  markMediaActive(threadKey: string, active: boolean): void;
  /** Mark a `threadKey` as having active document jobs or not. */
  markDocumentActive(threadKey: string, active: boolean): void;
}

const StreamingThreadsContext = createContext<StreamingThreadsRegistry | null>(null);

function useRegistryState(): StreamingThreadsRegistry {
  const [activeThreads, setActiveThreads] = useState<ReadonlySet<string>>(() => new Set());
  const [activeMediaThreads, setActiveMediaThreads] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [activeDocumentThreads, setActiveDocumentThreads] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const markStreaming = useCallback((threadKey: string, active: boolean) => {
    setActiveThreads((prev) => {
      if (active) {
        if (prev.has(threadKey)) return prev;
        const next = new Set(prev);
        next.add(threadKey);
        return next;
      }
      if (!prev.has(threadKey)) return prev;
      const next = new Set(prev);
      next.delete(threadKey);
      return next;
    });
  }, []);

  const markMediaActive = useCallback((threadKey: string, active: boolean) => {
    setActiveMediaThreads((prev) => {
      if (active) {
        if (prev.has(threadKey)) return prev;
        const next = new Set(prev);
        next.add(threadKey);
        return next;
      }
      if (!prev.has(threadKey)) return prev;
      const next = new Set(prev);
      next.delete(threadKey);
      return next;
    });
  }, []);

  const markDocumentActive = useCallback((threadKey: string, active: boolean) => {
    setActiveDocumentThreads((prev) => {
      if (active) {
        if (prev.has(threadKey)) return prev;
        const next = new Set(prev);
        next.add(threadKey);
        return next;
      }
      if (!prev.has(threadKey)) return prev;
      const next = new Set(prev);
      next.delete(threadKey);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      activeThreads,
      activeMediaThreads,
      activeDocumentThreads,
      markStreaming,
      markMediaActive,
      markDocumentActive
    }),
    [
      activeDocumentThreads,
      activeMediaThreads,
      activeThreads,
      markDocumentActive,
      markMediaActive,
      markStreaming
    ]
  );
}

export function StreamingThreadsProvider({ children }: { children: ReactNode }) {
  const value = useRegistryState();
  return (
    <StreamingThreadsContext.Provider value={value}>{children}</StreamingThreadsContext.Provider>
  );
}

/**
 * Returns the shared streaming-threads registry. When no provider is mounted
 * (e.g. in `vitest renderHook` setups that don't wrap with the provider) a
 * hook-local fallback registry is returned so legacy single-thread tests keep
 * working without per-test wrapper boilerplate. In production the provider is
 * always mounted by `AppShell`, so consumers see the same shared instance.
 */
export function useStreamingThreadsRegistry(): StreamingThreadsRegistry {
  const ctx = useContext(StreamingThreadsContext);
  const fallback = useRegistryState();
  return ctx ?? fallback;
}

/** Narrow read-only hook for components that only need a per-thread boolean. */
export function useIsThreadStreaming(threadKey: string): boolean {
  const { activeThreads } = useStreamingThreadsRegistry();
  return activeThreads.has(threadKey);
}

export function useHasThreadActiveMediaJobs(threadKey: string): boolean {
  const { activeMediaThreads } = useStreamingThreadsRegistry();
  return activeMediaThreads.has(threadKey);
}

export function useHasThreadActiveDocumentJobs(threadKey: string): boolean {
  const { activeDocumentThreads } = useStreamingThreadsRegistry();
  return activeDocumentThreads.has(threadKey);
}
