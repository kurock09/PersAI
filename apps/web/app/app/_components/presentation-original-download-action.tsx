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

type DownloadState =
  | { status: "idle" }
  | { status: "downloading" }
  | { status: "error"; reason: "unavailable" | "failed" };

interface PresentationOriginalDownloadActionProps {
  /**
   * BFF URL to GET. The endpoint is expected to either stream the original
   * PPTX with `Content-Disposition: attachment; filename=...` or return a
   * non-2xx status (commonly 410 Gone when the Gamma export link has
   * expired). The component never renders the BFF's HTML error body inline;
   * non-2xx is mapped onto a quiet in-place modal.
   */
  href: string;
  /** Suggested filename for the saved PPTX. */
  filename: string | null;
}

/**
 * Quiet "Download PPTX" affordance that lives directly under the PDF banner
 * and never navigates the user away from the chat.
 *
 * Why it exists:
 *
 *  - The previous design rendered a high-contrast `PPTX` pill inside the file
 *    banner (looked like a separate file and competed visually with the PDF).
 *  - It linked out via `target="_blank"`, which forced a full-page tab
 *    (especially fragile in Capacitor WebView, where it routes to the
 *    external browser without the Clerk session cookie). On expiry the user
 *    landed on a standalone error page instead of staying in chat.
 *
 * Design notes:
 *
 *  - The trigger is a small subdued text-button under the banner — quiet,
 *    "expensive but not loud", as the founder asked for.
 *  - We `fetch()` the BFF, then materialise the body as a Blob and trigger
 *    the browser save through a hidden `<a download>` so the chat keeps
 *    focus and Capacitor WebView keeps the same tab.
 *  - The BFF (`/api/assistant-document/[docId]/original/route.ts`) first tries
 *    server-side Clerk auth from the session cookie. For long-lived tabs where
 *    that server token can be null on the route handler, the client also sends
 *    a fresh Clerk token in a PersAI-owned same-origin header. We deliberately
 *    do NOT attach `Authorization: Bearer ...` on this client fetch because
 *    Clerk middleware in front of the BFF treats that as request auth and can
 *    reject before the route handler can forward the token upstream.
 *  - Any non-2xx (auth, 410-gone, 500) opens a small in-page modal with
 *    honest "PDF still in chat" copy. Modal is dismissable.
 */
export function PresentationOriginalDownloadAction({
  href,
  filename
}: PresentationOriginalDownloadActionProps): ReactElement {
  const t = useTranslations("chat");
  const { getToken } = useAuth();
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalTitleId = useId();

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const closeModal = useCallback(() => {
    setState({ status: "idle" });
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  }, []);

  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    },
    [closeModal]
  );

  const handleClick = useCallback(async () => {
    if (state.status === "downloading") return;

    // Abort any in-flight previous attempt before starting a new one. This
    // also keeps the StrictMode dev-time double-mount from racing against
    // itself if the user clicks twice in quick succession.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "downloading" });
    try {
      const token = await resolveFreshSessionToken(getToken);
      const headers = token === null ? undefined : { [SESSION_TOKEN_HEADER]: token };
      const response = await fetch(href, {
        credentials: "same-origin",
        ...(headers === undefined ? {} : { headers }),
        signal: controller.signal
      });
      if (!response.ok) {
        // 410 Gone is the explicit "Gamma export expired" path from
        // `AssistantDocumentOriginalDownloadService`. Anything else (401,
        // 500, network) is grouped under the generic "couldn't download"
        // modal with the same honest "PDF is still in chat" reassurance.
        const reason: "unavailable" | "failed" = response.status === 410 ? "unavailable" : "failed";
        setState({ status: "error", reason });
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download =
        readDispositionFilename(response.headers.get("Content-Disposition")) ??
        filename ??
        "presentation.pptx";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 0);
      setState({ status: "idle" });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("[presentation-pptx] download failed", error);
      setState({ status: "error", reason: "failed" });
    }
  }, [filename, getToken, href, state.status]);

  const isModalOpen = state.status === "error";

  useEffect(() => {
    if (!isModalOpen) return;
    window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
  }, [isModalOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          void handleClick();
        }}
        disabled={state.status === "downloading"}
        className={cn(
          "mt-1.5 inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] font-medium tracking-tight text-text-subtle transition-colors hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-0",
          "disabled:cursor-default disabled:opacity-70"
        )}
        aria-busy={state.status === "downloading"}
      >
        {state.status === "downloading" ? (
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
        {state.status === "downloading"
          ? t("presentationDownloadPptxStarting")
          : state.status === "error"
            ? t(
                state.reason === "unavailable"
                  ? "presentationDownloadPptxUnavailableTitle"
                  : "presentationDownloadPptxFailedTitle"
              )
            : ""}
      </span>

      {isModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="fixed inset-0 z-[9000] flex items-center justify-center bg-bg/85 px-5 backdrop-blur-sm"
          onClick={closeModal}
          onKeyDown={handleDialogKeyDown}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border-strong/70 bg-surface-raised/98 p-5 text-text shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 id={modalTitleId} className="mb-2 text-base font-semibold tracking-tight">
              {t(
                state.reason === "unavailable"
                  ? "presentationDownloadPptxUnavailableTitle"
                  : "presentationDownloadPptxFailedTitle"
              )}
            </h2>
            <p className="mb-5 text-sm leading-relaxed text-text-muted">
              {t(
                state.reason === "unavailable"
                  ? "presentationDownloadPptxUnavailableBody"
                  : "presentationDownloadPptxFailedBody"
              )}
            </p>
            <div className="flex justify-end">
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeModal}
                className="inline-flex h-9 items-center justify-center rounded-full border border-border-strong/70 bg-bg px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 hover:text-accent"
              >
                {t("presentationDownloadPptxClose")}
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

/**
 * Best-effort filename extraction from `Content-Disposition`. Supports both
 * the `filename="..."` form and the RFC 5987 `filename*=UTF-8''...` form
 * that the API emits for Cyrillic filenames. Falls back to null when the
 * header is absent or unparseable; the caller will then use its own
 * suggested filename.
 */
function readDispositionFilename(headerValue: string | null): string | null {
  if (headerValue === null) return null;
  const star = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(headerValue);
  if (star && typeof star[1] === "string") {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // ignore, fall through to plain match
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(headerValue);
  if (plain && typeof plain[1] === "string") {
    return plain[1].trim();
  }
  return null;
}
