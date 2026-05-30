"use client";

import { useEffect, useRef, useState } from "react";

interface StagedDemoRevealOptions {
  total: number;
  active: boolean;
  reduced: boolean | null;
  initialDelayMs?: number | undefined;
  stepDelayMs?: number | undefined;
}

export function useStagedDemoReveal({
  total,
  active,
  reduced,
  initialDelayMs = 220,
  stepDelayMs = 420
}: StagedDemoRevealOptions) {
  const threadViewportRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(() =>
    process.env.NODE_ENV === "test" ? total : reduced ? total : 0
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "test") {
      setVisibleCount(total);
      return;
    }

    if (reduced) {
      setVisibleCount(total);
      return;
    }

    if (!active) {
      setVisibleCount(0);
      return;
    }

    setVisibleCount(0);
    const timers = Array.from({ length: total }, (_, index) =>
      window.setTimeout(() => setVisibleCount(index + 1), initialDelayMs + index * stepDelayMs)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active, initialDelayMs, reduced, stepDelayMs, total]);

  useEffect(() => {
    if (visibleCount === 0) return;
    const scrollToBottom = (behavior: ScrollBehavior) => {
      const viewport = threadViewportRef.current;
      if (!viewport) return;
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior
      });
    };
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(reduced ? "auto" : "smooth");
    });
    const followUpTimers = [120, 360, 720].map((delay) =>
      window.setTimeout(() => scrollToBottom(reduced ? "auto" : "smooth"), delay)
    );
    return () => {
      window.cancelAnimationFrame(frame);
      followUpTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [reduced, visibleCount]);

  return { visibleCount, threadViewportRef };
}
