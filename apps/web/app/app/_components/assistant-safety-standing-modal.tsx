"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, OctagonX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { UserSafetyStandingState } from "../assistant-api-client";

type AssistantSafetyStandingModalKind = Exclude<UserSafetyStandingState["standing"], "none">;

interface AssistantSafetyStandingModalProps {
  kind: AssistantSafetyStandingModalKind;
  daysRemaining: number | null;
  onClose: () => void;
  onOpenSupport: () => void;
}

export function AssistantSafetyStandingModal({
  kind,
  daysRemaining,
  onClose,
  onOpenSupport
}: AssistantSafetyStandingModalProps) {
  const t = useTranslations("sidebar");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  const isWarn = kind === "warn";

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-safety-standing-title"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full max-w-sm rounded-2xl border bg-surface p-4 shadow-xl",
          isWarn ? "border-amber-200/80 dark:border-amber-400/20" : "border-destructive/20"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
              isWarn
                ? "border-amber-300/80 bg-amber-100/80 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200"
                : "border-destructive/25 bg-destructive/10 text-destructive"
            )}
          >
            {isWarn ? <AlertTriangle className="h-4 w-4" /> : <OctagonX className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p
              id="assistant-safety-standing-title"
              className={cn(
                "text-sm font-semibold",
                isWarn ? "text-amber-900 dark:text-amber-100" : "text-destructive"
              )}
            >
              {isWarn ? t("safetyWarnModalTitle") : t("safetyRestrictedModalTitle")}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              {isWarn ? t("safetyWarnModalBody") : t("safetyRestrictedModalBody")}
            </p>
            {isWarn && daysRemaining !== null ? (
              <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
                {t("safetyWarnModalDaysRemaining", { days: daysRemaining })}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSupport();
                }}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border/70 bg-bg/70 px-3 text-[12px] font-medium text-text transition-colors hover:bg-surface-hover"
              >
                {t("safetyModalOpenSupport")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                {t("safetyModalClose")}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-text-subtle transition-colors hover:text-text"
            aria-label={t("safetyModalClose")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
