"use client";

/**
 * Module-level LIFO stack of "back press" handlers.
 *
 * Why this exists: in the Capacitor Android shell (ADR-075) the hardware
 * Back button is delivered to the JS layer via @capacitor/app. The default
 * WebView fallback (`webView.canGoBack()` → `goBack()`) is unreliable
 * across Android 13/14/15 because it depends on whether
 * `OnBackPressedDispatcher` is registered before our overrides, and whether
 * Next.js' App Router pushState entries are visible to WebView's history
 * list. We bypass that whole pile of incompatibilities by handling Back
 * entirely in JS:
 *
 *   1. Modals/lightboxes/sidebars register a close handler when they open.
 *   2. The bridge listens to Capacitor's `backButton` event.
 *   3. On a press, the highest-priority handler (latest wins ties) is invoked →
 *      the native browser can outrank settings/navigation surfaces →
 *      its useEffect cleanup pops itself from the stack. Otherwise the
 *      bridge falls back to `window.history.back()` (App Router treats
 *      this as a soft pop) or `App.exitApp()` at the root.
 *
 * The stack lives at module scope on purpose: only one Capacitor listener
 * exists per session, so a singleton is the natural representation.
 */

type BackHandler = () => void;

type BackHandlerEntry = {
  handler: BackHandler;
  priority: number;
};

const stack: BackHandlerEntry[] = [];

export function pushBackHandler(handler: BackHandler, options?: { priority?: number }): () => void {
  const entry = { handler, priority: options?.priority ?? 0 };
  stack.push(entry);
  return () => {
    // Remove a specific handler (the one that registered) — usually the
    // top entry, but if cleanups race we still want to remove the right
    // one without disturbing other modal levels.
    const idx = stack.lastIndexOf(entry);
    if (idx !== -1) stack.splice(idx, 1);
  };
}

/** Invokes the highest-priority handler; latest registration wins ties. */
export function consumeBackPress(): boolean {
  let selected: BackHandlerEntry | undefined;
  for (const entry of stack) {
    if (selected === undefined || entry.priority >= selected.priority) {
      selected = entry;
    }
  }
  if (selected === undefined) return false;
  selected.handler();
  return true;
}

export function backHandlerCount(): number {
  return stack.length;
}
