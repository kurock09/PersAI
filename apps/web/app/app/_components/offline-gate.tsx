"use client";

import { useTranslations } from "next-intl";
import { useNetworkOnline } from "./use-network-online";

/**
 * Mid-session offline overlay for the web app and Capacitor WebView shell.
 *
 * Renders nothing while the network is up. When the browser/WebView reports
 * offline, mounts a fullscreen, themed overlay over the existing app so the
 * user sees a calm "no internet" screen instead of broken navigations or
 * frozen send/voice flows. The underlying app is intentionally not
 * unmounted: chats, drafts, and pending UI remain in memory and resume
 * cleanly the moment connectivity returns.
 *
 * Cold-start mobile fallback (when the WebView cannot reach the remote
 * `server.url` at all) is handled separately by the static
 * `persai-mobile/www/offline.html` via Capacitor's `errorPath` — see
 * ADR-075 "Offline behaviour".
 */
export function OfflineGate() {
  const { isOnline, isRechecking, recheck } = useNetworkOnline();
  const t = useTranslations("offline");

  if (isOnline) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg/95 px-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-title"
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-5 text-2xl font-semibold tracking-tight text-text">
          Pers<span className="text-accent">AI</span>
        </div>
        <h2 id="offline-title" className="mb-2 text-lg font-medium text-text">
          {t("title")}
        </h2>
        <p className="mb-6 text-base text-text-muted md:text-sm">{t("message")}</p>
        <button
          type="button"
          onClick={() => {
            void recheck();
          }}
          disabled={isRechecking}
          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
        >
          {isRechecking ? t("rechecking") : t("retry")}
        </button>
      </div>
    </div>
  );
}
