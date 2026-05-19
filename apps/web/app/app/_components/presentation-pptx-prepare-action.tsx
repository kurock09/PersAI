"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";

const SESSION_TOKEN_HEADER = "X-PersAI-Session-Token";

type PrepareState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "accepted"; result: "queued" | "already_running" | "ready" }
  | { status: "error" };

interface PresentationPptxPrepareActionProps {
  href: string;
  filename: string | null;
  onAccepted?: (() => void) | undefined;
}

export function PresentationPptxPrepareAction({
  href,
  filename,
  onAccepted
}: PresentationPptxPrepareActionProps): ReactElement {
  const t = useTranslations("chat");
  const { getToken } = useAuth();
  const [state, setState] = useState<PrepareState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalTitleId = useId();

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const isModalOpen = state.status !== "idle";

  const closeModal = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  }, []);

  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && state.status !== "submitting") {
        event.preventDefault();
        closeModal();
      }
    },
    [closeModal, state.status]
  );

  const submit = useCallback(async () => {
    if (state.status === "submitting") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "submitting" });
    try {
      const token = await resolveFreshSessionToken(getToken);
      const headers = token === null ? undefined : { [SESSION_TOKEN_HEADER]: token };
      const response = await fetch(href, {
        method: "POST",
        credentials: "same-origin",
        ...(headers === undefined ? {} : { headers }),
        signal: controller.signal
      });
      if (!response.ok) {
        setState({ status: "error" });
        return;
      }
      const payload = (await response.json()) as { status?: unknown };
      if (payload.status === "rejected") {
        setState({ status: "error" });
        return;
      }
      const result =
        payload.status === "ready" ||
        payload.status === "already_running" ||
        payload.status === "queued"
          ? payload.status
          : "queued";
      setState({ status: "accepted", result });
      onAccepted?.();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("[presentation-pptx] prepare failed", error);
      setState({ status: "error" });
    }
  }, [getToken, href, onAccepted, state.status]);

  useEffect(() => {
    if (!isModalOpen) return;
    window.setTimeout(() => {
      primaryButtonRef.current?.focus();
    }, 0);
  }, [isModalOpen, state.status]);

  const titleKey =
    state.status === "accepted"
      ? "presentationDownloadPptxAcceptedTitle"
      : state.status === "error"
        ? "presentationDownloadPptxFailedTitle"
        : "presentationDownloadPptxConfirmTitle";
  const bodyKey =
    state.status === "accepted"
      ? state.result === "ready"
        ? "presentationDownloadPptxReadyBody"
        : state.result === "already_running"
          ? "presentationDownloadPptxAlreadyRunningBody"
          : "presentationDownloadPptxAcceptedBody"
      : state.status === "error"
        ? "presentationDownloadPptxFailedBody"
        : "presentationDownloadPptxConfirmBody";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setState({ status: "confirming" });
        }}
        disabled={state.status === "submitting"}
        className={cn(
          "mt-1.5 inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] font-medium tracking-tight text-text-subtle transition-colors hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-0",
          "disabled:cursor-default disabled:opacity-70"
        )}
        aria-busy={state.status === "submitting"}
      >
        {state.status === "submitting" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{t("presentationDownloadPptxStarting")}</span>
          </>
        ) : (
          <span className="underline decoration-dotted underline-offset-[3px]">
            {t("presentationDownloadPptxAction")}
          </span>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state.status === "submitting"
          ? t("presentationDownloadPptxStarting")
          : state.status === "accepted"
            ? t("presentationDownloadPptxAcceptedTitle")
            : state.status === "error"
              ? t("presentationDownloadPptxFailedTitle")
              : ""}
      </span>

      {isModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="fixed inset-0 z-[9000] flex items-center justify-center bg-bg/85 px-5 backdrop-blur-sm"
          onClick={state.status === "submitting" ? undefined : closeModal}
          onKeyDown={handleDialogKeyDown}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border-strong/70 bg-surface-raised/98 p-5 text-text shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 id={modalTitleId} className="mb-2 text-base font-semibold tracking-tight">
              {t(titleKey)}
            </h2>
            <p className="mb-5 text-sm leading-relaxed text-text-muted">
              {t(bodyKey, { filename: filename ?? "presentation.pptx" })}
            </p>
            <div className="flex justify-end gap-2">
              {state.status === "confirming" ? (
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-border-strong/70 bg-transparent px-4 text-sm font-medium text-text-muted transition-colors hover:text-text"
                >
                  {t("presentationDownloadPptxCancel")}
                </button>
              ) : null}
              <button
                ref={primaryButtonRef}
                type="button"
                onClick={() => {
                  if (state.status === "confirming") {
                    void submit();
                    return;
                  }
                  closeModal();
                }}
                disabled={state.status === "submitting"}
                className="inline-flex h-9 items-center justify-center rounded-full border border-border-strong/70 bg-bg px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-70"
              >
                {state.status === "submitting" ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    {t("presentationDownloadPptxStarting")}
                  </>
                ) : state.status === "confirming" ? (
                  t("presentationDownloadPptxConfirmAction")
                ) : (
                  t("presentationDownloadPptxClose")
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

async function resolveFreshSessionToken(
  getToken: ReturnType<typeof useAuth>["getToken"]
): Promise<string | null> {
  try {
    return (await getToken({ skipCache: true })) ?? (await getToken()) ?? null;
  } catch {
    return null;
  }
}
