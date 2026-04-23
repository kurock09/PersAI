"use client";

import { useEffect, useState } from "react";

/**
 * Detect touch-only devices (phones, tablets) so the UI can offer
 * mobile-appropriate affordances — for example, inserting a newline on
 * Enter instead of submitting, or always showing controls that desktop
 * normally gates behind hover.
 *
 * Returns `false` on the server and during the first client render to keep
 * SSR markup stable, then settles to the real value after hydration.
 */
export function useTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setIsTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isTouch;
}
