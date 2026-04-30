import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNetworkOnline } from "./use-network-online";

describe("useNetworkOnline", () => {
  let originalOnLine: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalOnLine = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), "onLine");
  });

  afterEach(() => {
    if (originalOnLine !== undefined) {
      Object.defineProperty(Object.getPrototypeOf(navigator), "onLine", originalOnLine);
    }
    vi.restoreAllMocks();
  });

  /*
   * SSR-mismatch repro (live caught via CDP on the running pod, surfaced
   * as minified React error #418 "Hydration failed because the server
   * rendered HTML didn't match the client"):
   *
   * In Node 18+ / 21+ `globalThis.navigator` IS defined on the server
   * but does NOT carry the `onLine` property — `navigator.onLine`
   * returns `undefined`. The previous initializer
   *
   *   useState<boolean>(() => {
   *     if (typeof navigator === "undefined") return true;
   *     return navigator.onLine;
   *   })
   *
   * therefore set the SSR state to `undefined`, which is falsy at
   * `if (isOnline) return null` in `OfflineGate`, so the server
   * rendered the FULL offline overlay HTML. The browser then mounted
   * with `navigator.onLine === true` and rendered nothing — React
   * tore down the entire root with a hydration mismatch.
   *
   * The fix is to initialise with `true` unconditionally and update
   * from the post-mount `useEffect`, which is the canonical SSR-safe
   * pattern for browser-only state.
   */
  it("starts at `isOnline = true` even when navigator.onLine returns undefined (SSR-safe init)", () => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "onLine", {
      configurable: true,
      get: () => undefined as unknown as boolean
    });

    const { result } = renderHook(() => useNetworkOnline());

    // The initial render value must be a real boolean, never undefined.
    // Previously this was `undefined`, which is falsy at the
    // `OfflineGate` consumer and produced the founder-reported
    // hydration-mismatch overlay flash.
    expect(typeof result.current.isOnline).toBe("boolean");
    expect(result.current.isOnline).toBe(true);
  });

  it("transitions to `false` when the browser fires the `offline` event and back to `true` on `online`", () => {
    Object.defineProperty(Object.getPrototypeOf(navigator), "onLine", {
      configurable: true,
      get: () => true
    });

    const { result } = renderHook(() => useNetworkOnline());

    expect(result.current.isOnline).toBe(true);

    act(() => {
      Object.defineProperty(Object.getPrototypeOf(navigator), "onLine", {
        configurable: true,
        get: () => false
      });
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.isOnline).toBe(false);

    act(() => {
      Object.defineProperty(Object.getPrototypeOf(navigator), "onLine", {
        configurable: true,
        get: () => true
      });
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.isOnline).toBe(true);
  });
});
