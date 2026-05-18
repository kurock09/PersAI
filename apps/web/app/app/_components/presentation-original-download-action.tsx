"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";

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
 *  - Any non-2xx (auth, 410-gone, 500) opens a small in-page modal with
 *    honest "PDF still in chat" copy. Modal is dismissable.
 */
export function PresentationOriginalDownloadAction({
  href,
  filename
}: PresentationOriginalDownloadActionProps): ReactElement {
  const { getToken } = useAuth();
  const t = useTranslations("chat");
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const closeModal = useCallback(() => {
    setState({ status: "idle" });
  }, []);

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
      const token = await getToken();
      const headers = new Headers();
      if (typeof token === "string" && token.trim().length > 0) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const response = await fetch(href, {
        credentials: "same-origin",
        headers,
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
      URL.revokeObjectURL(objectUrl);
      setState({ status: "idle" });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("[presentation-pptx] download failed", error);
      setState({ status: "error", reason: "failed" });
    }
  }, [filename, getToken, href, state.status]);

  const isModalOpen = state.status === "error";
  const modalTitleId = "presentation-pptx-download-modal-title";

  return (
    <>
      <button
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

      {isModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          className="fixed inset-0 z-[9000] flex items-center justify-center bg-bg/85 px-5 backdrop-blur-sm"
          onClick={closeModal}
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
