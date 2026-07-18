"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { WebChatNotifyState } from "../assistant-api-client";

export interface WorkingJobRow {
  id: string;
  label: string;
  /** Small type marker shown gray before the label. */
  emoji: string;
  /** Optional secondary line (e.g. shell command), muted mono. */
  detail?: string;
  /** Oldest-first sort key; lower = older. */
  sortKeyMs: number;
  notifyState?: WebChatNotifyState | undefined;
}

const WORKING_BODY_MAX_HEIGHT_CLASS = "max-h-[min(40vh,280px)]";
const WORKING_IDLE_COLLAPSE_MS = 10_000;

function notifyStateLabel(t: (key: string) => string, state: WebChatNotifyState): string {
  if (state === "failed") return t("notifyFailed");
  if (state === "cancelled") return t("notifyCancelled");
  return t("notifyEnabled");
}

function WorkingBounceDots({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "working-bounce-dots text-text-muted",
        size === "sm" && "working-bounce-dots-sm",
        className
      )}
      aria-hidden
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export function ChatWorkingJobsPill({
  jobs,
  className
}: {
  jobs: WorkingJobRow[];
  className?: string;
}) {
  const t = useTranslations("chat");
  const [expanded, setExpanded] = useState(false);
  const [countsCollapsed, setCountsCollapsed] = useState(true);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => a.sortKeyMs - b.sortKeyMs || a.id.localeCompare(b.id)),
    [jobs]
  );
  const oldestJob = sortedJobs[0] ?? null;
  const count = sortedJobs.length;
  const bodyId = "chat-working-jobs-body";

  const collapseToResting = () => {
    setExpanded(false);
    setCountsCollapsed(true);
  };

  useEffect(() => {
    if (count === 0) {
      collapseToResting();
    }
  }, [count]);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !cardRef.current?.contains(event.target)) {
        collapseToResting();
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, []);

  useEffect(() => {
    if (countsCollapsed && !expanded) return;
    const timer = window.setTimeout(() => {
      collapseToResting();
    }, WORKING_IDLE_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, interactionVersion, countsCollapsed]);

  if (count === 0) {
    return null;
  }

  const handleHeaderClick = () => {
    if (countsCollapsed) {
      setCountsCollapsed(false);
      return;
    }
    setExpanded((prev) => {
      if (prev) {
        setCountsCollapsed(true);
        return false;
      }
      return true;
    });
  };

  return (
    <div
      ref={cardRef}
      data-testid="chat-working-jobs-pill"
      aria-live="polite"
      onPointerDownCapture={() => setInteractionVersion((version) => version + 1)}
      className={cn(
        // Grow left from the right-edge pill; list opens upward via flex-col-reverse.
        "ml-auto overflow-hidden border border-border/40 bg-surface-raised transition-[width,border-color,background-color,box-shadow] duration-300 ease-out",
        countsCollapsed
          ? "h-11 w-11 @[500px]:h-11 @[500px]:w-auto @[500px]:min-w-[7.5rem]"
          : "w-full",
        expanded ? "rounded-[1.375rem]" : "rounded-full",
        className
      )}
    >
      <div className="flex flex-col-reverse">
        {countsCollapsed ? (
          <>
            <button
              type="button"
              data-testid="chat-working-mobile-circle"
              className="flex h-11 w-11 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-text @[500px]:hidden"
              onClick={handleHeaderClick}
              aria-label={t("workingJobs", { count })}
            >
              <span className="text-[10px] font-semibold leading-none tabular-nums text-text-muted">
                {count}
              </span>
              <WorkingBounceDots size="sm" />
            </button>
            <button
              type="button"
              data-testid="chat-working-collapsed-chip"
              className="hidden h-11 w-full items-center justify-center gap-2 whitespace-nowrap px-3.5 @[500px]:flex"
              onClick={handleHeaderClick}
              aria-label={t("workingJobs", { count })}
            >
              <WorkingBounceDots />
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">
                {t("workingTitle")}
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-text">{count}</span>
            </button>
          </>
        ) : (
          <div className="flex h-11 items-center gap-1.5 p-[3px] pl-3">
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={handleHeaderClick}
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={t("workingJobs", { count })}
              data-testid="chat-working-header"
            >
              <WorkingBounceDots className="shrink-0" />
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">
                {t("workingTitle")}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-text-muted/80">{count}</span>

              {!expanded && oldestJob !== null ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span aria-hidden className="shrink-0 text-text-muted/30">
                    ·
                  </span>
                  <span className="working-job-emoji shrink-0 text-[12px] leading-none" aria-hidden>
                    {oldestJob.emoji}
                  </span>
                  <span className="truncate text-[12px] font-medium text-text">
                    {oldestJob.label}
                  </span>
                </span>
              ) : (
                <span className="flex-1" />
              )}

              <ChevronDown
                className={cn(
                  "ml-1 h-3.5 w-3.5 shrink-0 text-text-muted/50 transition-transform duration-200 group-hover:text-text-muted",
                  // List opens upward — chevron points up when expanded.
                  expanded ? "rotate-180" : "rotate-0"
                )}
                aria-hidden
              />
            </button>
          </div>
        )}

        {expanded ? (
          <div
            id={bodyId}
            role="dialog"
            aria-label={t("workingJobsList")}
            data-testid="chat-working-jobs-body"
            className={cn(
              "space-y-0 border-b border-border/30 px-3 py-2",
              WORKING_BODY_MAX_HEIGHT_CLASS,
              "overflow-y-auto"
            )}
          >
            {sortedJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-start justify-between gap-2 py-1.5 text-[13px] leading-snug text-text"
              >
                <span className="flex min-w-0 flex-1 items-start gap-1.5">
                  <span
                    className="working-job-emoji mt-[1px] shrink-0 text-[13px] leading-none"
                    aria-hidden
                  >
                    {job.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{job.label}</span>
                    {job.detail !== undefined && job.detail.trim().length > 0 ? (
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-text-muted/70">
                        {job.detail}
                      </span>
                    ) : null}
                  </span>
                </span>
                {job.notifyState !== undefined && job.notifyState !== "none" ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                      job.notifyState === "failed" || job.notifyState === "cancelled"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-accent/10 text-accent"
                    )}
                  >
                    {notifyStateLabel(t, job.notifyState)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
