"use client";

import { useEffect } from "react";

const STATE_KEY = "__persai_modal_back__";

/**
 * Wire a client-state overlay (modal, slide-over, sheet) into the browser's
 * history stack so the system Back gesture closes it instead of navigating
 * away from the page (or, in the Capacitor Android shell, closing the app).
 *
 * On open: push a marked history entry. When the user navigates back
 * (browser button, Android hardware Back, swipe-back), `popstate` fires and
 * we invoke `onClose`. If the overlay is closed by UI instead (Escape,
 * close button, backdrop click), we quietly pop our marked entry on cleanup
 * so the history stack stays clean.
 *
 * Multiple overlays can stack: each open pushes its own marker; Back pops
 * them one at a time, top-down — matching native mobile UX.
 */
export function useHistoryBackToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const markerId = Date.now() + Math.random();
    window.history.pushState({ [STATE_KEY]: markerId }, "");

    let consumedByPop = false;

    const onPop = () => {
      consumedByPop = true;
      onClose();
    };

    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      if (consumedByPop) return;
      // Closed via UI (not via Back). Our pushed entry is still on top —
      // pop it silently so we don't leave a phantom history step that
      // would require an extra Back press to escape.
      const currentState = (window.history.state ?? null) as Record<string, unknown> | null;
      if (currentState && currentState[STATE_KEY] === markerId) {
        window.history.back();
      }
    };
  }, [open, onClose]);
}
