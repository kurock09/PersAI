"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/app/lib/utils";

/**
 * Touch-driven pull-to-refresh for Capacitor WebView surfaces.
 *
 * Why we don't rely on the browser's native overscroll arrow: Capacitor
 * disables the browser-level pull-to-refresh gesture on both Android
 * (`WebView` overscroll mode = NEVER for stability) and iOS (no native
 * gesture for non-system WebViews). Rendering our own indicator keeps the
 * UX consistent across platforms and matches the in-app dark theme.
 *
 * Scope: only the scroll container wrapped by this component receives the
 * gesture. Modals/sidebars over it must not trigger refresh — they have
 * their own scroll containers and naturally consume the touch first.
 *
 * Mouse / desktop: touch handlers do not fire on pointer devices, so
 * this is effectively a no-op outside of touchscreens.
 */

const TRIGGER_DISTANCE_PX = 70;
const MAX_PULL_PX = 110;
const PULL_DAMPING = 0.5;
// Minimum total move (px) before we lock the gesture's primary axis. Below
// this we stay undecided so a tiny finger jitter cannot lock us into the
// wrong direction.
const DIRECTION_LOCK_PX = 8;

type RefreshState = "idle" | "pulling" | "refreshing";
type GestureDirection = "undecided" | "vertical" | "horizontal";

export interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  /** Disable the gesture (e.g. when a modal/overlay is in front). */
  disabled?: boolean;
  className?: string;
}

export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  className
}: PullToRefreshProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const directionRef = useRef<GestureDirection>("undecided");
  const [pull, setPull] = useState(0);
  const [state, setState] = useState<RefreshState>("idle");

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (disabled || state === "refreshing") return;
      const el = scrollRef.current;
      if (el === null || el.scrollTop > 0) return;
      const t = event.touches[0];
      if (t === undefined) return;
      startYRef.current = t.clientY;
      startXRef.current = t.clientX;
      directionRef.current = "undecided";
    },
    [disabled, state]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (startYRef.current === null || startXRef.current === null) return;
      const t = event.touches[0];
      if (t === undefined) return;
      const dy = t.clientY - startYRef.current;
      const dx = t.clientX - startXRef.current;

      // Decide the gesture's primary axis once the finger has moved far
      // enough; this prevents an accidental side-swipe (e.g. a dialog
      // dismiss gesture or a horizontal carousel above us) from being
      // interpreted as a refresh pull.
      if (directionRef.current === "undecided") {
        if (Math.abs(dy) + Math.abs(dx) < DIRECTION_LOCK_PX) return;
        directionRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      }

      if (directionRef.current === "horizontal") {
        if (pull !== 0) setPull(0);
        setState((prev) => (prev === "refreshing" ? prev : "idle"));
        return;
      }

      if (dy <= 0) {
        if (pull !== 0) setPull(0);
        setState((prev) => (prev === "refreshing" ? prev : "idle"));
        return;
      }

      const damped = Math.min(MAX_PULL_PX, dy * PULL_DAMPING);
      setPull(damped);
      setState((prev) => (prev === "refreshing" ? prev : "pulling"));
    },
    [pull]
  );

  const endGesture = useCallback(async () => {
    if (startYRef.current === null) return;
    const wasHorizontal = directionRef.current === "horizontal";
    startYRef.current = null;
    startXRef.current = null;
    directionRef.current = "undecided";
    if (wasHorizontal) {
      setPull(0);
      setState((prev) => (prev === "refreshing" ? prev : "idle"));
      return;
    }
    if (pull >= TRIGGER_DISTANCE_PX && state !== "refreshing") {
      setState("refreshing");
      setPull(TRIGGER_DISTANCE_PX);
      try {
        await onRefresh();
      } finally {
        setState("idle");
        setPull(0);
      }
      return;
    }
    setPull(0);
    setState((prev) => (prev === "refreshing" ? prev : "idle"));
  }, [onRefresh, pull, state]);

  const onTouchEnd = useCallback(() => {
    void endGesture();
  }, [endGesture]);

  const progress = Math.min(1, pull / TRIGGER_DISTANCE_PX);
  const indicatorOpacity = state === "refreshing" ? 1 : progress;
  const indicatorRotation = state === "refreshing" ? 0 : progress * 270;

  return (
    <div
      ref={scrollRef}
      className={cn(
        // Caller decides the sizing (e.g. `h-full` on the app home, `flex-1`
        // inside a flex column slide-over). We only own the scroll behavior
        // and the gesture-isolation `overscroll-behavior: contain` that
        // prevents pull events from escaping to ancestor scrollers and from
        // competing with iOS rubber-band on the document root.
        "relative overflow-y-auto [overscroll-behavior:contain]",
        className
      )}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      data-pull-state={state}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{
          height: pull > 0 || state === "refreshing" ? Math.max(pull, TRIGGER_DISTANCE_PX) : 0,
          opacity: indicatorOpacity,
          transition:
            state === "idle" && pull === 0 ? "opacity 150ms ease, height 200ms ease" : undefined
        }}
      >
        <div className="mt-3 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised shadow-sm">
          <Loader2
            className={cn("h-4 w-4 text-text-muted", state === "refreshing" && "animate-spin")}
            style={
              state === "refreshing" ? undefined : { transform: `rotate(${indicatorRotation}deg)` }
            }
          />
        </div>
      </div>
      <div
        style={{
          transform: `translateY(${pull}px)`,
          transition:
            startYRef.current === null && state !== "refreshing"
              ? "transform 200ms ease"
              : undefined
        }}
      >
        {children}
      </div>
    </div>
  );
}
