"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { PullToRefresh } from "./pull-to-refresh";
import { useHistoryBackToClose } from "./use-history-back-to-close";
import {
  clampDesktopSlideOverWidthPx,
  defaultDesktopSlideOverWidthPx,
  DESKTOP_SLIDE_OVER_WIDTH_MAX_PX,
  DESKTOP_SLIDE_OVER_WIDTH_MIN_PX
} from "./desktop-slide-over-width";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "narrow";
  /**
   * Optional pull-to-refresh handler. When provided, the scrollable body of
   * the slide-over is wrapped in a touch-driven pull-to-refresh container.
   * The slide-over's title bar stays fixed at the top — only the body
   * content translates with the pull gesture. Designed for mobile / Capacitor
   * WebView; on pointer devices the gesture is a no-op because touch events
   * do not fire on mouse input.
   */
  onPullToRefresh?: () => Promise<void> | void;
}

export function SlideOver({
  open,
  onClose,
  title,
  children,
  footer,
  size = "default",
  onPullToRefresh
}: SlideOverProps) {
  useHistoryBackToClose(open, onClose);

  const [widthPx, setWidthPx] = useState(() => defaultDesktopSlideOverWidthPx(size));
  const [resizeActive, setResizeActive] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setWidthPx(defaultDesktopSlideOverWidthPx(size));
  }, [size]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!resizeActive) {
      return;
    }
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [resizeActive]);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      resizeRef.current = {
        startX: event.clientX,
        startWidth: widthPx
      };
      setResizeActive(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [widthPx]
  );

  const handleResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeRef.current;
    if (start === null) {
      return;
    }
    // Dragging the left edge: move left → wider panel.
    setWidthPx(clampDesktopSlideOverWidthPx(start.startWidth - (event.clientX - start.startX)));
  }, []);

  const handleResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current === null) {
      return;
    }
    resizeRef.current = null;
    setResizeActive(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWidthPx((current) => clampDesktopSlideOverWidthPx(current + 16));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWidthPx((current) => clampDesktopSlideOverWidthPx(current - 16));
    }
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            data-testid="slide-over-panel"
            data-slide-over-width={widthPx}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden bg-surface shadow-2xl",
              "inset-y-0 right-0 w-full border-l border-border",
              "md:inset-y-4 md:right-4 md:left-auto md:w-[var(--slide-over-width)] md:rounded-[1.375rem] md:border md:border-border"
            )}
            style={{ ["--slide-over-width" as string]: `${widthPx}px` }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 220 }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              aria-valuemin={DESKTOP_SLIDE_OVER_WIDTH_MIN_PX}
              aria-valuemax={DESKTOP_SLIDE_OVER_WIDTH_MAX_PX}
              aria-valuenow={widthPx}
              tabIndex={0}
              data-testid="slide-over-resize-handle"
              className={cn(
                "absolute top-1/2 left-0 z-20 hidden -translate-x-1/2 -translate-y-1/2 cursor-col-resize flex-col items-center gap-0.5 rounded-full px-0.5 py-2 md:flex",
                "touch-none select-none",
                resizeActive ? "opacity-70" : "opacity-35 hover:opacity-70"
              )}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
              onPointerCancel={handleResizePointerUp}
              onKeyDown={handleResizeKeyDown}
            >
              <span className="h-1 w-1 rounded-full bg-text-subtle/28" aria-hidden="true" />
              <span className="h-1 w-1 rounded-full bg-text-subtle/28" aria-hidden="true" />
              <span className="h-1 w-1 rounded-full bg-text-subtle/28" aria-hidden="true" />
              <span className="h-1 w-1 rounded-full bg-text-subtle/28" aria-hidden="true" />
            </div>
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-text">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">
              {onPullToRefresh ? (
                <PullToRefresh onRefresh={onPullToRefresh} className="min-h-0 flex-1">
                  {children}
                </PullToRefresh>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
              )}
              {footer ? (
                <div className="shrink-0 border-t border-border px-5 py-3">{footer}</div>
              ) : null}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
