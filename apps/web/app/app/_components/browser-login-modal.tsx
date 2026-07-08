"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Smartphone,
  X
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  completeAssistantBrowserLogin,
  dismissAssistantBrowserProfileView,
  type PendingBrowserLoginState
} from "../assistant-api-client";
import {
  getExtensionBridgeStatus,
  isNativeBrowserBridgeShell,
  PERSAI_BROWSER_BRIDGE_WEB_STORE_URL,
  type ExtensionBridgeStatus
} from "../browser-bridge-client";
import { useHistoryBackToClose } from "./use-history-back-to-close";

interface BrowserLoginModalProps {
  open: boolean;
  assistantId: string | null | undefined;
  pendingBrowserLogin: PendingBrowserLoginState | null;
  onDismiss: () => void;
  onCancel: () => void;
  onCompleted?: (() => void) | undefined;
}

export function BrowserLoginModal({
  open,
  assistantId,
  pendingBrowserLogin,
  onDismiss,
  onCancel,
  onCompleted
}: BrowserLoginModalProps) {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionBridgeStatus | null>(null);
  const [checkingExtension, setCheckingExtension] = useState(false);
  const completionMode = pendingBrowserLogin?.completionMode ?? "login";
  const bridgeClientKind = pendingBrowserLogin?.bridgeClientKind ?? null;
  const nativeShell = useMemo(() => isNativeBrowserBridgeShell(), []);
  const extensionTarget = bridgeClientKind === "extension" && !nativeShell;
  const extensionAvailable = extensionStatus !== null;
  const extensionConnected = extensionStatus?.connected === true;

  useHistoryBackToClose(open, onDismiss);

  const refreshExtensionStatus = useCallback(async () => {
    if (!extensionTarget) {
      setExtensionStatus(null);
      setCheckingExtension(false);
      return;
    }
    setCheckingExtension(true);
    try {
      const next = await getExtensionBridgeStatus();
      setExtensionStatus(next);
    } catch {
      setExtensionStatus(null);
    } finally {
      setCheckingExtension(false);
    }
  }, [extensionTarget]);

  useEffect(() => {
    if (!open) {
      setCompleting(false);
      setCompleteError(null);
      setExtensionStatus(null);
      setCheckingExtension(false);
    }
  }, [open, pendingBrowserLogin?.profileId]);

  useEffect(() => {
    if (!open || !extensionTarget) {
      return;
    }
    void refreshExtensionStatus();
    const intervalId = window.setInterval(() => {
      void refreshExtensionStatus();
    }, 3_000);
    return () => window.clearInterval(intervalId);
  }, [extensionTarget, open, refreshExtensionStatus]);

  const closeAssistView = useCallback(async () => {
    if (!pendingBrowserLogin || !assistantId) {
      return;
    }
    const token = await getToken();
    if (!token) {
      throw new Error("Missing auth token.");
    }
    await dismissAssistantBrowserProfileView(token, assistantId, pendingBrowserLogin.profileId);
  }, [assistantId, getToken, pendingBrowserLogin]);

  const handleComplete = useCallback(async () => {
    if (
      !pendingBrowserLogin ||
      !assistantId ||
      completing ||
      (extensionTarget && !extensionConnected)
    ) {
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
      if (completionMode === "assist") {
        await dismissAssistantBrowserProfileView(token, assistantId, pendingBrowserLogin.profileId);
      } else {
        await completeAssistantBrowserLogin(token, assistantId, pendingBrowserLogin.profileId);
      }
      onCompleted?.();
      onDismiss();
    } catch {
      setCompleteError(t("browserLoginCompleteFailed"));
    } finally {
      setCompleting(false);
    }
  }, [
    assistantId,
    completing,
    completionMode,
    extensionConnected,
    extensionTarget,
    getToken,
    onDismiss,
    onCompleted,
    pendingBrowserLogin,
    t
  ]);

  const handleHeaderDismiss = useCallback(async () => {
    if (completionMode !== "assist") {
      onDismiss();
      return;
    }
    try {
      await closeAssistView();
    } catch {
      // Keep dismiss usable even if the close-view request fails.
    }
    onDismiss();
  }, [closeAssistView, completionMode, onDismiss]);

  const handleCancel = useCallback(async () => {
    if (completionMode !== "assist") {
      onCancel();
      return;
    }
    try {
      await closeAssistView();
    } catch {
      // Keep dismiss usable even if the close-view request fails.
    }
    onCancel();
  }, [closeAssistView, completionMode, onCancel]);

  if (!open || pendingBrowserLogin === null || typeof document === "undefined") {
    return null;
  }

  const doneLabel =
    completionMode === "assist" ? t("browserLoginAssistDone") : t("browserLoginDone");
  const extensionStatusTone = extensionConnected
    ? "border-success/30 bg-success/8 text-success"
    : extensionAvailable
      ? "border-warning/25 bg-warning/10 text-warning"
      : "border-destructive/20 bg-destructive/5 text-destructive";
  const extensionStatusLabel = checkingExtension
    ? t("browserLoginExtensionChecking")
    : extensionConnected
      ? t("browserLoginExtensionConnected")
      : extensionAvailable
        ? t("browserLoginExtensionInstalled")
        : t("browserLoginExtensionUnavailable");
  const stepTitle =
    completionMode === "assist" ? t("browserLoginAssistTitle") : t("browserLoginTitle");
  const stepBody =
    completionMode === "assist"
      ? t("browserLoginAssistBody")
      : bridgeClientKind === "capacitor" || nativeShell
        ? t("browserLoginMobileBody")
        : t("browserLoginDesktopBody");

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
        <div className="flex shrink-0 items-center gap-1.5">
          {extensionTarget ? (
            <button
              type="button"
              onClick={() => void refreshExtensionStatus()}
              aria-label={t("browserLoginCheckBridge")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-hover hover:text-text"
              data-testid="browser-login-refresh-status"
            >
              <RefreshCw className={cn("h-4 w-4", checkingExtension && "animate-spin")} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleHeaderDismiss()}
            aria-label={t("browserLoginClose")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-text-muted transition hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <section className="rounded-2xl border border-border bg-bg px-4 py-4">
            <p className="text-sm font-semibold text-text">{stepTitle}</p>
            <p className="mt-2 text-sm leading-6 text-text-muted">{stepBody}</p>
            <div className="mt-4 rounded-xl border border-border/70 bg-surface px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                {t("browserLoginHowItWorks")}
              </p>
              <ol className="mt-2 space-y-2 text-sm text-text-muted">
                <li>{t("browserLoginStepOpenWindow")}</li>
                <li>{t("browserLoginStepFinishOnDevice")}</li>
                <li>{t("browserLoginStepReturnAndDone")}</li>
              </ol>
            </div>
          </section>

          {bridgeClientKind === "capacitor" || nativeShell ? (
            <section className="rounded-2xl border border-accent/20 bg-accent/[0.06] px-4 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent">
                  <Smartphone className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">
                    {t("browserLoginMobileStatusTitle")}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-text-muted">
                    {t("browserLoginMobileStatusBody")}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {extensionTarget ? (
            <section
              className={cn("rounded-2xl border px-4 py-4", extensionStatusTone)}
              data-testid="browser-login-extension-status"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-current/20 bg-white/40">
                  {extensionAvailable ? (
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  ) : (
                    <AlertCircle className="h-4.5 w-4.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{extensionStatusLabel}</p>
                  <p className="mt-1 text-sm leading-6 opacity-90">
                    {extensionAvailable
                      ? t("browserLoginExtensionAvailableBody")
                      : t("browserLoginExtensionUnavailableBody")}
                  </p>
                  {extensionAvailable ? (
                    <p className="mt-2 text-xs opacity-80">
                      {extensionConnected
                        ? t("browserLoginExtensionConnectedHint")
                        : t("browserLoginExtensionInstalledHint")}
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {PERSAI_BROWSER_BRIDGE_WEB_STORE_URL !== null ? (
                        <a
                          href={PERSAI_BROWSER_BRIDGE_WEB_STORE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-current/20 bg-white/60 px-3 text-xs font-semibold transition hover:bg-white/80"
                          data-testid="browser-login-extension-cta"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t("browserLoginInstallExtension")}
                        </a>
                      ) : (
                        <div
                          className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-current/20 bg-white/50 px-3 py-2 text-xs leading-5"
                          data-testid="browser-login-extension-dev-guidance"
                        >
                          <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{t("browserLoginExtensionDeveloperInstall")}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void refreshExtensionStatus()}
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-current/20 px-3 text-xs font-medium transition hover:bg-white/40"
                      >
                        {t("browserLoginCheckBridge")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
        {completeError ? <p className="mb-2 text-xs text-destructive">{completeError}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-text-muted">{t("browserLoginFooterTruth")}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={completing}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border/70 px-3 text-xs font-medium text-text transition hover:bg-surface-hover disabled:opacity-50"
            >
              {t("browserLoginCancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleComplete()}
              disabled={completing || (extensionTarget && !extensionConnected)}
              data-testid="browser-login-complete"
              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-accent px-4 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
            >
              {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : doneLabel}
            </button>
          </div>
        </div>
      </footer>
    </div>,
    document.body
  );
}
