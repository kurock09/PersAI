"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ContractsApiError, type AssistantSandboxEgressMode } from "@persai/contracts";
import { cn } from "@/app/lib/utils";
import { getAssistantSandboxEgress, putAssistantSandboxEgress } from "../assistant-api-client";
import { useStreamingThreadsRegistry } from "./streaming-threads";

function useAssistantOperationBusy(assistantId: string): boolean {
  const { activeThreads, activeMediaThreads, activeDocumentThreads } =
    useStreamingThreadsRegistry();
  const prefix = `${assistantId}::`;

  return useMemo(() => {
    const hasActive = (keys: ReadonlySet<string>) =>
      Array.from(keys).some((threadKey) => threadKey.startsWith(prefix));
    return (
      hasActive(activeThreads) || hasActive(activeMediaThreads) || hasActive(activeDocumentThreads)
    );
  }, [activeDocumentThreads, activeMediaThreads, activeThreads, prefix]);
}

function mapSandboxEgressError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ContractsApiError) {
    if (error.code === "sandbox_egress_change_busy" || error.status === 409) {
      return t("sandboxNetworkBusy");
    }
    if (error.code === "sandbox_egress_recycle_failed" || error.status === 503) {
      return t("sandboxNetworkRecycleFailed");
    }
  }
  return t("sandboxNetworkSaveFailed");
}

export function AssistantSandboxEgressSettings({
  assistantId,
  resolveAuthToken
}: {
  assistantId: string;
  resolveAuthToken: () => Promise<string | null>;
}) {
  const t = useTranslations("settings");
  const rowId = useId();
  const labelId = `${rowId}-label`;
  const hintId = `${rowId}-hint`;
  const loadErrorId = `${rowId}-load-error`;
  const saveErrorId = `${rowId}-save-error`;
  const busyReasonId = `${rowId}-busy`;
  const modalTitleId = `${rowId}-modal-title`;
  const modalDescId = `${rowId}-modal-desc`;
  const modalErrorId = `${rowId}-modal-error`;
  const switchRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusPendingRef = useRef(false);
  const mountedRef = useRef(false);
  const assistantRef = useRef(assistantId);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const operationBusy = useAssistantOperationBusy(assistantId);
  const [canonicalMode, setCanonicalMode] = useState<AssistantSandboxEgressMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);

  const isCurrent = useCallback((expectedAssistantId: string, generation: number) => {
    return (
      mountedRef.current &&
      assistantRef.current === expectedAssistantId &&
      generationRef.current === generation
    );
  }, []);

  const startGeneration = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { generation: generationRef.current, controller };
  }, []);

  const loadCanonical = useCallback(
    async ({
      expectedAssistantId,
      generation,
      controller,
      clearSaveError = true
    }: {
      expectedAssistantId: string;
      generation: number;
      controller: AbortController;
      clearSaveError?: boolean;
    }): Promise<boolean> => {
      if (!isCurrent(expectedAssistantId, generation)) {
        return false;
      }
      setLoading(true);
      setLoadError(null);
      setCanonicalMode(null);
      if (clearSaveError) {
        setInlineError(null);
      }
      try {
        const token = await resolveAuthToken();
        if (!token || !isCurrent(expectedAssistantId, generation)) {
          if (isCurrent(expectedAssistantId, generation)) {
            setLoadError(t("sandboxNetworkLoadFailed"));
          }
          return false;
        }
        const response = await getAssistantSandboxEgress(
          token,
          expectedAssistantId,
          controller.signal
        );
        if (
          !isCurrent(expectedAssistantId, generation) ||
          response.assistantId !== expectedAssistantId
        ) {
          if (isCurrent(expectedAssistantId, generation)) {
            setLoadError(t("sandboxNetworkLoadFailed"));
          }
          return false;
        }
        setCanonicalMode(response.mode);
        return true;
      } catch {
        if (isCurrent(expectedAssistantId, generation)) {
          setCanonicalMode(null);
          setLoadError(t("sandboxNetworkLoadFailed"));
        }
        return false;
      } finally {
        if (isCurrent(expectedAssistantId, generation)) {
          setLoading(false);
        }
      }
    },
    [isCurrent, resolveAuthToken, t]
  );

  useLayoutEffect(() => {
    if (assistantRef.current !== assistantId) {
      assistantRef.current = assistantId;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    }
    setCanonicalMode(null);
    setLoadError(null);
    setInlineError(null);
    setConfirmEnableOpen(false);
    setSaveBusy(false);
    setLoading(true);
    restoreFocusPendingRef.current = false;
  }, [assistantId]);

  useEffect(() => {
    mountedRef.current = true;
    const expectedAssistantId = assistantId;
    const { generation, controller } = startGeneration();
    void loadCanonical({ expectedAssistantId, generation, controller });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [assistantId, loadCanonical, startGeneration]);

  const applyPut = useCallback(
    async (mode: AssistantSandboxEgressMode): Promise<boolean> => {
      const expectedAssistantId = assistantRef.current;
      const { generation, controller } = startGeneration();
      setSaveBusy(true);
      setInlineError(null);
      try {
        const token = await resolveAuthToken();
        if (!token || !isCurrent(expectedAssistantId, generation)) {
          if (isCurrent(expectedAssistantId, generation)) {
            setInlineError(t("sandboxNetworkSaveFailed"));
            await loadCanonical({
              expectedAssistantId,
              generation,
              controller,
              clearSaveError: false
            });
          }
          return false;
        }
        const response = await putAssistantSandboxEgress(
          token,
          expectedAssistantId,
          mode,
          controller.signal
        );
        if (
          !isCurrent(expectedAssistantId, generation) ||
          response.assistantId !== expectedAssistantId
        ) {
          if (isCurrent(expectedAssistantId, generation)) {
            setInlineError(t("sandboxNetworkSaveFailed"));
            await loadCanonical({
              expectedAssistantId,
              generation,
              controller,
              clearSaveError: false
            });
          }
          return false;
        }

        const refetched = await loadCanonical({
          expectedAssistantId,
          generation,
          controller,
          clearSaveError: false
        });
        if (!refetched) {
          if (isCurrent(expectedAssistantId, generation)) {
            setCanonicalMode(null);
            setInlineError(t("sandboxNetworkSaveRefetchFailed"));
          }
          return false;
        }
        if (isCurrent(expectedAssistantId, generation)) {
          setInlineError(null);
        }
        return true;
      } catch (error) {
        if (!isCurrent(expectedAssistantId, generation)) {
          return false;
        }
        const mapped = mapSandboxEgressError(error, t);
        await loadCanonical({
          expectedAssistantId,
          generation,
          controller,
          clearSaveError: false
        });
        if (isCurrent(expectedAssistantId, generation)) {
          setInlineError(mapped);
        }
        return false;
      } finally {
        if (isCurrent(expectedAssistantId, generation)) {
          setSaveBusy(false);
        }
      }
    },
    [isCurrent, loadCanonical, resolveAuthToken, startGeneration, t]
  );

  const handleToggleRequest = useCallback(() => {
    if (loading || saveBusy || operationBusy || canonicalMode === null) {
      return;
    }
    if (canonicalMode === "restricted") {
      setConfirmEnableOpen(true);
      return;
    }
    void applyPut("restricted");
  }, [applyPut, canonicalMode, loading, operationBusy, saveBusy]);

  const closeEnableModal = useCallback(() => {
    restoreFocusPendingRef.current = true;
    setConfirmEnableOpen(false);
  }, []);

  const handleConfirmEnable = useCallback(async () => {
    const succeeded = await applyPut("full_public");
    if (succeeded && assistantRef.current === assistantId) {
      closeEnableModal();
    }
  }, [applyPut, assistantId, closeEnableModal]);

  const handleCancelEnable = useCallback(() => {
    if (saveBusy) {
      return;
    }
    closeEnableModal();
  }, [closeEnableModal, saveBusy]);

  useEffect(() => {
    if (!confirmEnableOpen) {
      return;
    }
    if (saveBusy) {
      modalRef.current?.focus();
    } else {
      confirmButtonRef.current?.focus();
    }
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !saveBusy) {
        event.preventDefault();
        closeEnableModal();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [closeEnableModal, confirmEnableOpen, saveBusy]);

  useEffect(() => {
    if (!confirmEnableOpen && !saveBusy && restoreFocusPendingRef.current) {
      restoreFocusPendingRef.current = false;
      switchRef.current?.focus();
    }
  }, [confirmEnableOpen, saveBusy]);

  const handleModalKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const first = cancelButtonRef.current;
    const last = confirmButtonRef.current;
    if (!first || !last) {
      return;
    }
    if (first.disabled && last.disabled) {
      event.preventDefault();
      modalRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const checked = canonicalMode === "full_public";
  const controlDisabled = loading || saveBusy || operationBusy || canonicalMode === null;
  const describedBy = [
    hintId,
    operationBusy ? busyReasonId : null,
    loadError ? loadErrorId : null,
    inlineError ? (confirmEnableOpen ? modalErrorId : saveErrorId) : null
  ].filter((value): value is string => value !== null);
  const uniqueDescribedBy = Array.from(new Set(describedBy)).join(" ");

  return (
    <>
      <div className="mt-3 border-t border-border/45 px-1 pt-3">
        <div className="flex items-start justify-between gap-3 rounded-xl px-1 py-2">
          <div className="min-w-0 flex-1">
            <p id={labelId} className="text-xs font-medium text-text">
              {t("sandboxNetwork")}
            </p>
            <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-text-subtle">
              {loading
                ? t("sandboxNetworkLoading")
                : checked
                  ? t("sandboxNetworkFullPublicHint")
                  : t("sandboxNetworkRestrictedHint")}
            </p>
            {operationBusy ? (
              <p id={busyReasonId} className="mt-1 text-[11px] text-text-muted">
                {t("sandboxNetworkWhileBusy")}
              </p>
            ) : null}
            {loadError ? (
              <p id={loadErrorId} role="alert" className="mt-2 text-[11px] text-destructive">
                {loadError}
              </p>
            ) : null}
            {inlineError && !confirmEnableOpen ? (
              <p id={saveErrorId} role="alert" className="mt-2 text-[11px] text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>
          <button
            ref={switchRef}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-labelledby={labelId}
            aria-describedby={uniqueDescribedBy.length > 0 ? uniqueDescribedBy : undefined}
            aria-disabled={controlDisabled}
            aria-busy={loading || saveBusy}
            disabled={controlDisabled}
            onClick={handleToggleRequest}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                handleToggleRequest();
              }
            }}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
              controlDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              checked ? "bg-accent" : "bg-surface-raised"
            )}
          >
            {loading || saveBusy ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-3 w-3 animate-spin text-text-muted" aria-hidden="true" />
              </span>
            ) : null}
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                checked ? "translate-x-[18px]" : "translate-x-[3px]",
                (loading || saveBusy) && "opacity-0"
              )}
            />
          </button>
        </div>
      </div>

      {confirmEnableOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
              onClick={() => {
                if (!saveBusy) {
                  handleCancelEnable();
                }
              }}
              role="presentation"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={modalTitleId}
                aria-describedby={inlineError ? `${modalDescId} ${modalErrorId}` : modalDescId}
                aria-busy={saveBusy}
                className="w-full max-w-md rounded-2xl border border-border/80 bg-[color:var(--surface)] p-5 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={handleModalKeyDown}
                ref={modalRef}
                tabIndex={-1}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-warning/10 p-2 text-warning">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 id={modalTitleId} className="text-base font-semibold text-text">
                      {t("sandboxNetworkEnableTitle")}
                    </h3>
                    <p
                      id={modalDescId}
                      className="mt-2 text-base leading-relaxed text-text-muted md:text-sm"
                    >
                      {t("sandboxNetworkEnableBody")}
                    </p>
                  </div>
                </div>
                {inlineError ? (
                  <p
                    id={modalErrorId}
                    role="alert"
                    className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {inlineError}
                  </p>
                ) : null}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    ref={cancelButtonRef}
                    type="button"
                    disabled={saveBusy}
                    onClick={handleCancelEnable}
                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    ref={confirmButtonRef}
                    type="button"
                    disabled={saveBusy}
                    onClick={() => void handleConfirmEnable()}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-wait disabled:opacity-70"
                  >
                    {saveBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {t("sandboxNetworkConfirmEnable")}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
