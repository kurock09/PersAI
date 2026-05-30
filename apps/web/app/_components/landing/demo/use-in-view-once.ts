"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

// React 19 types: useRef<T>(null) → RefObject<T | null>
type NullableRefObject<T extends Element> = RefObject<T | null>;

/**
 * Fires `inView = true` exactly once when the element enters the viewport,
 * then disconnects the observer (one-shot, never re-triggers).
 *
 * SSR-safe: `useState(false)` avoids any module-scope window/IO access.
 * If `IntersectionObserver` is unavailable in the runtime environment,
 * `inView` is set to `true` immediately on mount so content is always visible.
 */
export function useInViewOnce<T extends Element>(options?: {
  rootMargin?: string;
  threshold?: number;
}): { ref: NullableRefObject<T>; inView: boolean } {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: options?.rootMargin ?? "0px 0px -10% 0px",
        threshold: options?.threshold ?? 0.15
      }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, inView };
}
