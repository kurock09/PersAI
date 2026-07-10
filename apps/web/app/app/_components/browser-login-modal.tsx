"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import { CircleHelp, Download, Loader2, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import {
  completeAssistantBrowserLogin,
  dismissAssistantBrowserProfileView,
  openAssistantBrowserProfileView,
  type PendingBrowserLoginState
} from "../assistant-api-client";
import {
  getExtensionBridgeStatus,
  hideNativeBrowserBridgeView,
  isNativeBrowserBridgeShell,
  PERSAI_BROWSER_BRIDGE_WEB_STORE_URL,
  registerExtensionBridgeDevice,
  registerNativeBrowserBridgeDevice,
  showNativeBrowserBridgeView,
  type ExtensionBridgeStatus
} from "../browser-bridge-client";
import { pushBackHandler } from "./back-handler-stack";
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
  const [showInstructions, setShowInstructions] = useState(false);
  const [bridgeViewOpened, setBridgeViewOpened] = useState(false);
  const [openingBridgeView, setOpeningBridgeView] = useState(false);
  const [nativeViewVisible, setNativeViewVisible] = useState(false);
  const openedViewProfileIdRef = useRef<string | null>(null);
  const extensionStatusRef = useRef<ExtensionBridgeStatus | null>(null);
  const nativeRefreshInFlightRef = useRef(false);
  const openViewAbortControllerRef = useRef<AbortController | null>(null);
  const completionMode = pendingBrowserLogin?.completionMode ?? "login";
  const bridgeClientKind = pendingBrowserLogin?.bridgeClientKind ?? null;
  const nativeShell = useMemo(() => isNativeBrowserBridgeShell(), []);
  const extensionTarget = bridgeClientKind === "extension" && !nativeShell;
  const nativeTarget = bridgeClientKind === "capacitor" || nativeShell;
  const bridgeTarget = extensionTarget || nativeTarget;
  const extensionAvailable = extensionStatus !== null;
  const extensionConnected = extensionStatus?.connected === true;

  useHistoryBackToClose(open, onDismiss);

  const openPendingLoginView = useCallback(
    async (token: string) => {
      if (
        completionMode !== "login" ||
        !assistantId ||
        !pendingBrowserLogin ||
        openedViewProfileIdRef.current === pendingBrowserLogin.profileId
      ) {
        return;
      }
      openViewAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      openViewAbortControllerRef.current = abortController;
      // Target the device THIS surface registered: with both desktop and
      // mobile bridges connected, the server otherwise picks ambiguously.
      try {
        await openAssistantBrowserProfileView(
          token,
          assistantId,
          pendingBrowserLogin.profileId,
          extensionStatusRef.current?.bridgeDeviceId ?? null,
          { signal: abortController.signal }
        );
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        throw error;
      } finally {
        if (openViewAbortControllerRef.current === abortController) {
          openViewAbortControllerRef.current = null;
        }
      }
      if (abortController.signal.aborted) {
        return;
      }
      openedViewProfileIdRef.current = pendingBrowserLogin.profileId;
      setShowInstructions(false);
      setBridgeViewOpened(true);
      if (nativeTarget) {
        setNativeViewVisible(true);
      }
    },
    [assistantId, completionMode, nativeTarget, pendingBrowserLogin]
  );

  const updateExtensionStatus = useCallback((next: ExtensionBridgeStatus | null) => {
    extensionStatusRef.current = next;
    setExtensionStatus(next);
  }, []);

  const refreshExtensionStatus = useCallback(
    async (options?: { showChecking?: boolean }) => {
      const showChecking = options?.showChecking !== false;
      if (!bridgeTarget) {
        updateExtensionStatus(null);
        setCheckingExtension(false);
        return;
      }
      if (showChecking) {
        setCheckingExtension(true);
      }
      try {
        if (nativeTarget) {
          // register + open-live can take many seconds server-side (dispatch
          // timeout). Without this guard the 3s poll stacks parallel requests
          // and trips the relay's dispatch rate limit (429 storm).
          if (nativeRefreshInFlightRef.current) {
            return;
          }
          nativeRefreshInFlightRef.current = true;
          try {
            const token = await getToken();
            if (!token || !assistantId || !pendingBrowserLogin) {
              updateExtensionStatus(null);
              return;
            }
            const registered = await registerNativeBrowserBridgeDevice({
              token,
              assistantId,
              workspaceId: pendingBrowserLogin.workspaceId
            });
            updateExtensionStatus(registered);
          } finally {
            nativeRefreshInFlightRef.current = false;
          }
          return;
        }
        const next = await getExtensionBridgeStatus();
        const sameScope =
          next.assistantId === assistantId && next.workspaceId === pendingBrowserLogin?.workspaceId;
        // A matching scope is only good enough while the socket is live. Device
        // tokens expire after ~15 min, and the extension cannot mint a new one
        // itself — if the connection is down we must fall through and
        // re-register so the extension gets a fresh token.
        // `registerExtensionBridgeDevice` itself throttles registration across
        // every open PersAI tab (via localStorage), so it is safe to call on
        // every poll tick here without re-implementing a per-tab throttle.
        if (
          (sameScope && next.connected) ||
          (next.assistantId === null &&
            next.workspaceId === null &&
            extensionStatusRef.current !== null)
        ) {
          updateExtensionStatus(next);
          return;
        }
        const token = await getToken();
        if (!token || !assistantId || !pendingBrowserLogin) {
          updateExtensionStatus(next);
          return;
        }
        try {
          const registered = await registerExtensionBridgeDevice({
            token,
            assistantId,
            workspaceId: pendingBrowserLogin.workspaceId
          });
          updateExtensionStatus(registered);
        } catch {
          updateExtensionStatus(extensionStatusRef.current ?? next);
        }
      } catch {
        if (extensionStatusRef.current === null) {
          updateExtensionStatus(null);
        }
      } finally {
        if (showChecking) {
          setCheckingExtension(false);
        }
      }
    },
    [
      assistantId,
      bridgeTarget,
      getToken,
      nativeTarget,
      openPendingLoginView,
      pendingBrowserLogin,
      t,
      updateExtensionStatus
    ]
  );

  useEffect(() => {
    if (!open) {
      openViewAbortControllerRef.current?.abort();
      openViewAbortControllerRef.current = null;
      setCompleting(false);
      setCompleteError(null);
      updateExtensionStatus(null);
      setCheckingExtension(false);
      setShowInstructions(false);
      setBridgeViewOpened(false);
      setOpeningBridgeView(false);
      setNativeViewVisible(false);
      openedViewProfileIdRef.current = null;
    }
  }, [open, pendingBrowserLogin?.profileId, updateExtensionStatus]);

  useEffect(() => {
    openViewAbortControllerRef.current?.abort();
    openViewAbortControllerRef.current = null;
    setBridgeViewOpened(false);
    setOpeningBridgeView(false);
    setNativeViewVisible(false);
    openedViewProfileIdRef.current = null;
  }, [pendingBrowserLogin?.profileId]);

  /**
   * While the native overlay covers the app (including this modal's own
   * buttons), the hardware Back press must hide the overlay and return the
   * user here — NOT dismiss the modal. Registered after the modal's own
   * back-to-close handler so it sits on top of the stack.
   */
  const pendingProfileKey = pendingBrowserLogin?.profileKey ?? null;
  useEffect(() => {
    if (!open || !nativeTarget || !nativeViewVisible || pendingProfileKey === null) {
      return;
    }
    const remove = pushBackHandler(
      () => {
        void hideNativeBrowserBridgeView(pendingProfileKey).catch(() => undefined);
        setNativeViewVisible(false);
      },
      { priority: 100 }
    );
    return () => remove();
  }, [nativeTarget, nativeViewVisible, open, pendingProfileKey]);

  const handleShowNativeView = useCallback(async () => {
    if (pendingProfileKey === null) {
      return;
    }
    try {
      await showNativeBrowserBridgeView(pendingProfileKey);
      setNativeViewVisible(true);
    } catch {
      setCompleteError(t("browserLoginOpenFailed"));
    }
  }, [pendingProfileKey, t]);

  /**
   * Kept as a defensive desktop-extension fallback: the primary UX now keeps
   * Готово/Отмена in this compact web modal, but any future extension-side
   * completion signal still has to be relayed through the authenticated web
   * tab because the extension has no Clerk session.
   */
  const checkExtensionPendingCompletionAction = useCallback(async () => {
    if (!extensionTarget || !extensionConnected || !assistantId || !pendingBrowserLogin) {
      return;
    }
    let status: ExtensionBridgeStatus;
    try {
      status = await getExtensionBridgeStatus(undefined, pendingBrowserLogin.profileKey);
    } catch {
      return;
    }
    if (
      status.pendingCompletionAction !== "complete" &&
      status.pendingCompletionAction !== "cancel"
    ) {
      return;
    }
    const token = await getToken();
    if (!token) {
      return;
    }
    if (status.pendingCompletionAction === "complete") {
      try {
        if (completionMode === "assist") {
          await dismissAssistantBrowserProfileView(
            token,
            assistantId,
            pendingBrowserLogin.profileId
          );
        } else {
          await completeAssistantBrowserLogin(token, assistantId, pendingBrowserLogin.profileId);
        }
        onCompleted?.();
        onDismiss();
      } catch {
        setCompleteError(t("browserLoginCompleteFailed"));
      }
      return;
    }
    if (completionMode === "assist") {
      try {
        await dismissAssistantBrowserProfileView(token, assistantId, pendingBrowserLogin.profileId);
      } catch {
        // Keep dismiss usable even if the close-view request fails.
      }
      onDismiss();
      return;
    }
    onCancel();
  }, [
    assistantId,
    completionMode,
    extensionConnected,
    extensionTarget,
    getToken,
    onCancel,
    onCompleted,
    onDismiss,
    pendingBrowserLogin,
    t
  ]);

  useEffect(() => {
    if (!open || !bridgeTarget) {
      return;
    }
    // Only surface the "checking" spinner while we have no status at all;
    // re-runs of this effect (parent re-renders) must not flicker the UI.
    void refreshExtensionStatus({ showChecking: extensionStatusRef.current === null });
    const intervalId = window.setInterval(() => {
      void refreshExtensionStatus({ showChecking: false });
      void checkExtensionPendingCompletionAction();
    }, 3_000);
    return () => window.clearInterval(intervalId);
  }, [bridgeTarget, checkExtensionPendingCompletionAction, open, refreshExtensionStatus]);

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

  const handleOpenBridgeView = useCallback(async () => {
    if (!assistantId || !pendingBrowserLogin || openingBridgeView || !extensionConnected) {
      return;
    }
    const token = await getToken();
    if (!token) {
      setCompleteError(t("browserLoginCompleteFailed"));
      return;
    }
    setOpeningBridgeView(true);
    setCompleteError(null);
    try {
      await openPendingLoginView(token);
    } catch (error) {
      const serverMessage = error instanceof Error && error.message ? error.message : null;
      setCompleteError(serverMessage ?? t("browserLoginOpenFailed"));
    } finally {
      setOpeningBridgeView(false);
    }
  }, [
    assistantId,
    extensionConnected,
    getToken,
    openPendingLoginView,
    openingBridgeView,
    pendingBrowserLogin,
    t
  ]);

  const handleComplete = useCallback(async () => {
    if (
      !pendingBrowserLogin ||
      !assistantId ||
      completing ||
      (bridgeTarget && !extensionConnected)
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
        await completeAssistantBrowserLogin(
          token,
          assistantId,
          pendingBrowserLogin.profileId,
          extensionStatusRef.current?.bridgeDeviceId ?? null
        );
      }
      onCompleted?.();
      onDismiss();
    } catch (error) {
      const serverMessage = error instanceof Error && error.message ? error.message : null;
      setCompleteError(serverMessage ?? t("browserLoginCompleteFailed"));
    } finally {
      setCompleting(false);
    }
  }, [
    assistantId,
    completing,
    completionMode,
    extensionConnected,
    bridgeTarget,
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
      openViewAbortControllerRef.current?.abort();
      openViewAbortControllerRef.current = null;
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
    completionMode === "assist" ? t("browserLoginAssistBody") : t("browserLoginCompactHint");
  // Desktop extension flows are ALWAYS the compact centered modal — both the
  // pending-login flow and the assist/live view opened from a settings
  // session card. The full-screen layout is reserved for the mobile shell,
  // where the native overlay owns the screen.
  const compactDesktopModal = extensionTarget;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[100]",
        compactDesktopModal
          ? "flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
          : "flex flex-col bg-bg"
      )}
      data-testid="browser-login-modal-backdrop"
    >
      <div
        className={cn(
          "flex flex-col overflow-hidden bg-bg",
          compactDesktopModal
            ? "max-h-[calc(100vh-3rem)] w-full max-w-lg rounded-3xl border border-border shadow-2xl"
            : "min-h-0 flex-1"
        )}
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
            {bridgeTarget && extensionConnected ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {nativeTarget
                  ? t("browserLoginNativeConnected")
                  : t("browserLoginExtensionConnected")}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowInstructions((current) => !current)}
              aria-label={showInstructions ? t("browserLoginHideHelp") : t("browserLoginHelp")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-hover hover:text-text"
              data-testid="browser-login-help-toggle"
            >
              <CircleHelp className="h-4 w-4" />
            </button>
            {bridgeTarget ? (
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

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-6">
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 text-center">
            <section>
              <p className="text-lg font-semibold tracking-tight text-text">{stepTitle}</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-text-muted">{stepBody}</p>
            </section>

            {bridgeTarget && extensionConnected && completionMode === "login" ? (
              <div className="flex w-full flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleOpenBridgeView()}
                  disabled={openingBridgeView}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                  data-testid="browser-login-open-bridge-view"
                >
                  {openingBridgeView ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("browserLoginOpenSite", { site: pendingBrowserLogin.displayName })
                  )}
                </button>
                <p className="max-w-sm text-xs leading-5 text-text-subtle">
                  {bridgeViewOpened
                    ? t("browserLoginBridgeWindowOpened")
                    : t("browserLoginOpenSiteHint")}
                </p>
              </div>
            ) : null}

            {showInstructions ? (
              <section
                className="w-full rounded-2xl border border-border bg-bg px-4 py-4 text-left"
                data-testid="browser-login-instructions"
              >
                <p className="text-sm font-medium text-text">{t("browserLoginHowItWorks")}</p>
                <p className="mt-1 text-sm leading-6 text-text-muted">
                  {t("browserLoginHelpBody")}
                </p>
              </section>
            ) : null}

            {nativeTarget && bridgeViewOpened && !nativeViewVisible ? (
              <button
                type="button"
                onClick={() => void handleShowNativeView()}
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-text transition hover:bg-surface-hover"
                data-testid="browser-login-show-native-view"
              >
                {t("browserLoginMobileShowSite")}
              </button>
            ) : null}

            {extensionTarget && !extensionConnected ? (
              <section
                className="w-full rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-left"
                data-testid="browser-login-extension-status"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">{extensionStatusLabel}</p>
                    <p className="mt-0.5 text-xs leading-5 text-text-muted">
                      {extensionAvailable
                        ? t("browserLoginExtensionReconnectHint")
                        : t("browserLoginExtensionInstallHint")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!extensionAvailable && PERSAI_BROWSER_BRIDGE_WEB_STORE_URL !== null ? (
                      <a
                        href={PERSAI_BROWSER_BRIDGE_WEB_STORE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-warning/30 bg-bg px-3 text-xs font-semibold text-text transition hover:bg-surface-hover"
                        data-testid="browser-login-extension-cta"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("browserLoginInstallExtension")}
                      </a>
                    ) : null}
                    {!extensionAvailable && PERSAI_BROWSER_BRIDGE_WEB_STORE_URL === null ? (
                      <span
                        className="max-w-40 text-xs leading-5 text-text-muted"
                        data-testid="browser-login-extension-dev-guidance"
                      >
                        {t("browserLoginExtensionDeveloperInstall")}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void refreshExtensionStatus()}
                      className="inline-flex min-h-9 items-center justify-center rounded-full border border-warning/30 px-3 text-xs font-medium text-text transition hover:bg-warning/10"
                    >
                      {t("browserLoginCheckBridge")}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          {completeError ? <p className="mb-2 text-xs text-destructive">{completeError}</p> : null}
          <div className="flex justify-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={completing}
                className="inline-flex min-h-9 items-center justify-center rounded-full border border-border/70 px-4 text-sm font-medium text-text transition hover:bg-surface-hover disabled:opacity-50"
              >
                {t("browserLoginCancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={completing || (bridgeTarget && !extensionConnected)}
                data-testid="browser-login-complete"
                className="inline-flex min-h-9 items-center justify-center rounded-full bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
              >
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : doneLabel}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
