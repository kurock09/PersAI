"use client";

import { useEffect, type RefObject } from "react";

/** Scroll a viewport element to its bottom, guarding for jsdom/test envs. */
export function scrollElementToBottom(el: HTMLElement, reduced: boolean | null) {
  if (typeof el.scrollTo === "function") {
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  } else {
    el.scrollTop = el.scrollHeight;
  }
}

/**
 * Keeps a scrollable thread viewport pinned to the newest content whenever
 * `changeKey` changes (e.g. a message count). Uses a rAF plus a couple of
 * follow-up timers so the scroll lands after layout/entrance animations.
 */
export function useScrollToBottom(
  viewportRef: RefObject<HTMLDivElement | null>,
  changeKey: number,
  reduced: boolean | null
) {
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => scrollElementToBottom(el, reduced));
    const timers = [120, 360].map((delay) =>
      window.setTimeout(() => scrollElementToBottom(el, reduced), delay)
    );
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [changeKey, reduced, viewportRef]);
}
