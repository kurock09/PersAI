"use client";

import { type ReactNode, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function SlideOver({ open, onClose, title, children }: SlideOverProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
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
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface border-l border-border shadow-2xl md:max-w-[420px]"
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
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
