"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/app/lib/utils";

type AssistantSettingsDialogShellProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider shell for the change-role split layout (desktop only). */
  size?: "md" | "xl";
  /** Optional header leading control (e.g. back). */
  leading?: ReactNode;
  className?: string;
  bodyClassName?: string;
  closeDisabled?: boolean;
  "aria-describedby"?: string;
};

export function AssistantSettingsDialogShell({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
  leading,
  className,
  bodyClassName,
  closeDisabled = false,
  "aria-describedby": ariaDescribedBy
}: AssistantSettingsDialogShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !closeDisabled) {
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[140]",
        // Mobile: edge-to-edge sheet. Desktop: dimmed centered dialog.
        "bg-[color:var(--surface)] md:flex md:items-center md:justify-center md:bg-black/40 md:p-5 md:backdrop-blur-[2px]"
      )}
      onClick={() => {
        if (!closeDisabled) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[color:var(--surface)] outline-none",
          // Desktop window chrome only — mobile stays full-bleed flat.
          "md:h-auto md:max-h-[min(88vh,820px)] md:rounded-2xl md:border md:border-border/70",
          size === "xl" ? "md:max-w-4xl" : "md:max-w-lg",
          className
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-3.5 md:px-5">
          {leading}
          <h2
            id={titleId}
            className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-text"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50 md:h-8 md:w-8 md:rounded-lg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5",
            bodyClassName
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer className="shrink-0 border-t border-border/50 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] md:px-5 md:pb-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
