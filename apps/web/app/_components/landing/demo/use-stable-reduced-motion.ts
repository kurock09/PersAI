"use client";

import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reduced-motion preference that is deterministic across SSR and the first
 * client render.
 *
 * Framer-motion's `useReducedMotion()` can report `true` on the very first
 * render(s) and then resolve to the real value. In the assistant-creation
 * trailer that transient `true` made `show()` reveal the entire finished form
 * (avatar + name + instruction + Create button) for ~150ms before collapsing
 * back to the real step — the visible "field/button blink then restart".
 *
 * To avoid that, this hook always returns `false` on the server and on the
 * first client render (so the parked frame hydrates cleanly with no mismatch
 * and no final-frame flash), then adopts the real `matchMedia` value once,
 * after mount. Genuine reduced-motion users still get the no-animation path —
 * it just resolves one tick later, after hydration, instead of flickering.
 */
export function useStableReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mql.matches);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
