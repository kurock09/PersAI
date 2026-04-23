"use client";

import { useEffect } from "react";
import { consumeBackPress } from "./back-handler-stack";

/**
 * Wires the Capacitor Android hardware Back button to the JS back-handler
 * stack. No-op on web/iOS (the listener registration is gated by
 * `Capacitor.isNativePlatform()`, and the native event itself is
 * Android-only — see https://capacitorjs.com/docs/apis/app#addlistenerbackbutton).
 *
 * Resolution order on a press:
 *   1. If a modal/lightbox/sidebar registered a handler → close it.
 *   2. Else if the WebView has page history (`canGoBack` from the event)
 *      → soft-pop via `window.history.back()` so Next.js App Router
 *      handles the route change.
 *   3. Else exit the app, matching the platform default at the root.
 *
 * Mounted once near the top of the React tree (in AppShell) so a single
 * Capacitor listener exists per session.
 */
export function BackButtonBridge(): null {
  useEffect(() => {
    let removeListener: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");
        if (cancelled) return;
        const handle = await App.addListener("backButton", ({ canGoBack }) => {
          if (consumeBackPress()) return;
          if (canGoBack) {
            // App Router listens for popstate and re-renders; this is
            // equivalent to the WebView's native goBack but goes through
            // pure JS so it works reliably across Android 13/14/15 and
            // independent of how Capacitor proxies the back gesture.
            window.history.back();
            return;
          }
          void App.exitApp();
        });
        if (cancelled) {
          await handle.remove();
          return;
        }
        removeListener = () => void handle.remove();
      } catch {
        // Capacitor not available (web build) or plugin missing — silently
        // do nothing; the browser's own Back button continues to work.
      }
    })();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  return null;
}
