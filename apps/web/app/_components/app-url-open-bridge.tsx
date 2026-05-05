"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

function toInAppRoute(rawUrl: string): string | null {
  try {
    const incoming = new URL(rawUrl);
    if (incoming.protocol !== "https:" || incoming.host !== "persai.dev") {
      return null;
    }
    if (!incoming.pathname.startsWith("/app")) {
      return null;
    }
    return `${incoming.pathname}${incoming.search}${incoming.hash}`;
  } catch {
    return null;
  }
}

/**
 * Capacitor Android App Links bridge.
 *
 * When Android resolves a verified `https://persai.dev/app/...` link back into
 * the native shell, the App plugin surfaces it via `appUrlOpen` / `getLaunchUrl`.
 * We then soft-route the same in-app path inside Next App Router instead of
 * leaving the user stranded on the shell's default origin entrypoint.
 */
export function AppUrlOpenBridge(): null {
  const router = useRouter();

  useEffect(() => {
    let removeListener: (() => void) | null = null;
    let cancelled = false;

    const handleIncomingUrl = (rawUrl: string | null | undefined) => {
      if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
        return;
      }

      const targetRoute = toInAppRoute(rawUrl);
      if (targetRoute === null) {
        return;
      }

      const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (currentRoute === targetRoute) {
        return;
      }

      router.replace(targetRoute as Route);
    };

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        const { App } = await import("@capacitor/app");
        if (cancelled) return;

        const launch = await App.getLaunchUrl();
        if (!cancelled) {
          handleIncomingUrl(launch?.url);
        }

        const handle = await App.addListener("appUrlOpen", ({ url }) => {
          handleIncomingUrl(url);
        });

        if (cancelled) {
          await handle.remove();
          return;
        }

        removeListener = () => void handle.remove();
      } catch {
        // Browser build or missing Capacitor App plugin: no-op.
      }
    })();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [router]);

  return null;
}
