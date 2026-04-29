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
  // Initial render is on the server during SSR — assume online to avoid a
  // flicker of the offline overlay before hydration completes.
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
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

    setIsOnline(navigator.onLine);

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
