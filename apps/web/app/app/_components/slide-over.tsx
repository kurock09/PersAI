"use client";

import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { PullToRefresh } from "./pull-to-refresh";
import { useHistoryBackToClose } from "./use-history-back-to-close";

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

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

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
            className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-2xl ${
              size === "narrow"
                ? "md:max-w-[520px] lg:max-w-[600px] xl:max-w-[660px]"
                : "md:max-w-[560px] lg:max-w-[680px] xl:max-w-[760px]"
            }`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 220 }}
          >
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
