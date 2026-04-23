"use client";

import { useEffect, useRef } from "react";
import { pushBackHandler } from "./back-handler-stack";

/**
 * Wire a client-state overlay (modal, slide-over, sheet, mobile sidebar)
 * into the system "back" gesture so it closes the overlay instead of
 * leaving the page or, in the Capacitor Android shell, closing the app.
 *
 * Implementation: while `open` is true, register the `onClose` callback
 * on a module-level back-handler stack. The Capacitor bridge in
 * {@link BackButtonBridge} drains the stack on every hardware Back press;
 * if no handlers remain it falls back to `window.history.back()` for
 * normal page navigation, and `App.exitApp()` at the root.
 *
 * Why not pushState markers anymore: an earlier version pushed a marker
 * history entry on open and listened for `popstate` to detect Back. That
 * worked for leaf modals but broke whenever the overlay contained a
 * `router.push` link (mobile sidebar tapping a chat) — Next.js stacked
 * its own entry on top of the marker, leaving an orphan in the middle of
 * the history stack and corrupting subsequent forward/back navigation.
 *
 * The stack approach has no history side effects, so it composes cleanly
 * with router pushes inside an open overlay.
 *
 * Multiple overlays stack: each open pushes its own handler, Back pops
 * them top-down, matching native mobile UX.
 */
export function useHistoryBackToClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // Indirect through the ref so the registered handler always invokes
    // the latest onClose without re-subscribing on every render.
    const remove = pushBackHandler(() => onCloseRef.current());
    return () => remove();
  }, [open]);
}
