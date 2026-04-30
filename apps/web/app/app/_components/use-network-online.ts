"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser/Capacitor network status with a manual recheck escape hatch.
 *
 * Source of truth is `navigator.onLine` plus the standard `online` /
 * `offline` window events. That single source covers both regular web
 * browsers and the Capacitor WebView shell (Capacitor wires the platform
 * connectivity changes back through these standard events). We deliberately
 * do not pull in `@capacitor/network` from this hook to keep `apps/web`
 * runnable as a plain web app — `@capacitor/network` stays available as a
 * pre-installed dependency for future shell-only features.
 *
 * `recheck()` performs a tiny no-cache fetch to `/api/health` to confirm
 * connectivity even when the OS-reported `navigator.onLine` is stale (some
 * browsers and the Android WebView keep `onLine` true after a captive
 * portal or DNS hiccup). It is safe to call on every Retry tap.
 */
export interface NetworkOnlineState {
  isOnline: boolean;
  isRechecking: boolean;
  recheck: () => Promise<boolean>;
}

const HEALTH_PATH = "/api/health";
const RECHECK_TIMEOUT_MS = 4000;
const NETWORK_ONLINE_CHANGE_EVENT = "persai-network-online-change";

function publishNetworkOnlineState(isOnline: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NETWORK_ONLINE_CHANGE_EVENT, {
      detail: { isOnline }
    })
  );
}

function readNetworkOnlineChange(event: Event): boolean | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail as { isOnline?: unknown } | null;
  return typeof detail?.isOnline === "boolean" ? detail.isOnline : null;
}

export function useNetworkOnline(): NetworkOnlineState {
  // SSR-safe initial state: ALWAYS `true` on the very first render, on
  // both server and client. The real value is read from
  // `navigator.onLine` in the post-mount `useEffect` below. Reading
  // `navigator.onLine` directly in the `useState` initializer is unsafe
  // in Node 18+ / 21+: `globalThis.navigator` IS defined on the server
  // but does NOT carry the `onLine` property (it returns `undefined`),
  // so `useState<boolean>(undefined)` sets the SSR state to `undefined`
  // — which is falsy at `if (isOnline) return null` in `OfflineGate`
  // and causes the server to render the full offline overlay HTML. The
  // client then mounts with `navigator.onLine === true`, renders
  // nothing, and React tears down the entire root with a hydration
  // mismatch (minified React error #418, "Hydration failed because the
  // server rendered HTML didn't match the client"). Starting at `true`
  // and updating from the effect is the canonical SSR-safe pattern and
  // matches the comment's original intent ("assume online to avoid a
  // flicker of the offline overlay before hydration completes").
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isRechecking, setIsRechecking] = useState(false);
  const recheckAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      setIsOnline(true);
      publishNetworkOnlineState(true);
    };
    const handleOffline = () => {
      setIsOnline(false);
      publishNetworkOnlineState(false);
    };
    const handleSharedChange = (event: Event) => {
      const next = readNetworkOnlineChange(event);
      if (next !== null) {
        setIsOnline(next);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener(NETWORK_ONLINE_CHANGE_EVENT, handleSharedChange);

    // Only commit to React state when the platform actually exposes a
    // boolean. On jsdom and on some Node-side polyfills `navigator`
    // exists but `navigator.onLine` is `undefined`; writing that into
    // state would set `isOnline` to `undefined`, which is falsy and
    // would render the offline overlay even though the network is up.
    if (typeof navigator.onLine === "boolean") {
      setIsOnline(navigator.onLine);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(NETWORK_ONLINE_CHANGE_EVENT, handleSharedChange);
    };
  }, []);

  const recheck = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return true;

    recheckAbortRef.current?.abort();
    const controller = new AbortController();
    recheckAbortRef.current = controller;

    setIsRechecking(true);
    const timeoutId = window.setTimeout(() => controller.abort(), RECHECK_TIMEOUT_MS);

    try {
      const res = await fetch(HEALTH_PATH, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      const ok = res.ok;
      setIsOnline(ok);
      publishNetworkOnlineState(ok);
      return ok;
    } catch {
      setIsOnline(false);
      publishNetworkOnlineState(false);
      return false;
    } finally {
      window.clearTimeout(timeoutId);
      setIsRechecking(false);
      if (recheckAbortRef.current === controller) {
        recheckAbortRef.current = null;
      }
    }
  }, []);

  return { isOnline, isRechecking, recheck };
}
