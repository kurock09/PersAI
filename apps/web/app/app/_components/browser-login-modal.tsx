"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  completeAssistantBrowserLogin,
  type PendingBrowserLoginState
} from "../assistant-api-client";
import { useHistoryBackToClose } from "./use-history-back-to-close";

interface BrowserLoginModalProps {
  open: boolean;
  assistantId: string | null | undefined;
  pendingBrowserLogin: PendingBrowserLoginState | null;
  onClose: () => void;
  onCompleted?: (() => void) | undefined;
}

export function BrowserLoginModal({
  open,
  assistantId,
  pendingBrowserLogin,
  onClose,
  onCompleted
}: BrowserLoginModalProps) {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useHistoryBackToClose(open, onClose);

  useEffect(() => {
    if (!open) {
      setCompleting(false);
      setCompleteError(null);
    }
  }, [open, pendingBrowserLogin?.profileId]);

  const handleComplete = useCallback(async () => {
    if (!pendingBrowserLogin || !assistantId || completing) {
      return;
    }
    const token = await getToken();
    if (!token) {
      setCompleteError(t("browserLoginCompleteFailed"));
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      await completeAssistantBrowserLogin(token, assistantId, pendingBrowserLogin.profileId);
      onCompleted?.();
      onClose();
    } catch {
      setCompleteError(t("browserLoginCompleteFailed"));
    } finally {
      setCompleting(false);
    }
  }, [assistantId, completing, getToken, onClose, onCompleted, pendingBrowserLogin, t]);

  if (!open || pendingBrowserLogin === null || typeof document === "undefined") {
    return null;
  }

  const liveUrl = pendingBrowserLogin.liveUrl;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label={pendingBrowserLogin.displayName}
      data-testid="browser-login-modal"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">
            {pendingBrowserLogin.displayName}
          </p>
          <p className="truncate text-xs text-text-muted">{pendingBrowserLogin.loginUrl}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("browserLoginCancel")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 text-text-muted transition hover:bg-surface-hover hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-surface">
        <iframe
          title={pendingBrowserLogin.displayName}
          src={liveUrl}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write; fullscreen"
          data-testid="browser-login-iframe"
        />
      </div>

      <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
        {completeError ? <p className="mb-2 text-xs text-destructive">{completeError}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-text-muted transition hover:text-text"
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("browserLoginOpenExternal")}
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={completing}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border/70 px-3 text-xs font-medium text-text transition hover:bg-surface-hover disabled:opacity-50"
            >
              {t("browserLoginCancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleComplete()}
              disabled={completing}
              data-testid="browser-login-complete"
              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-accent px-4 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
            >
              {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : t("browserLoginDone")}
            </button>
          </div>
        </div>
      </footer>
    </div>,
    document.body
  );
}
