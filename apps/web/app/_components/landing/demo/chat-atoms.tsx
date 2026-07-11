import type { ReactNode } from "react";
import Image from "next/image";
import { AssistantAvatar } from "@/app/app/_components/assistant-avatar";
import { cn } from "@/app/lib/utils";

const CHAT_FILE_PILL_SURFACE_CLASS =
  "inline-flex w-fit max-w-[min(100%,320px)] min-w-0 flex-nowrap items-center gap-2 overflow-hidden rounded-full border border-[rgba(92,72,48,0.12)] bg-surface-raised/70 px-3 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.74),inset_0_-1px_0_rgba(92,72,48,0.07),0_16px_30px_-24px_rgba(92,72,48,0.42)] dark:border-white/14 dark:bg-surface-raised/72 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),inset_0_-1px_0_rgba(0,0,0,0.24),0_14px_26px_-22px_rgba(0,0,0,0.8)]";

const CHAT_FILE_PILL_BADGE_CLASS =
  "inline-flex h-6 min-w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(92,72,48,0.12)] bg-bg/70 px-2 text-[10px] font-semibold tracking-[0.08em] text-text/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] dark:border-white/14 dark:bg-bg/72 dark:text-text dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

export const DEMO_ASSISTANT_AVATAR_URL = "/avatar-presets/luma.png";

function FormatGlyph({ kind }: { kind: "pdf" | "pptx" | "docx" }) {
  const tone =
    kind === "pdf"
      ? "border-rose-400/55 bg-rose-100/55 text-rose-700 dark:border-rose-300/30 dark:bg-rose-400/15 dark:text-rose-300"
      : kind === "pptx"
        ? "border-amber-400/55 bg-amber-100/55 text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/15 dark:text-amber-300"
        : "border-sky-400/55 bg-sky-100/55 text-sky-800 dark:border-sky-300/30 dark:bg-sky-400/15 dark:text-sky-300";
  const label = kind === "pdf" ? "PDF" : kind === "pptx" ? "PPT" : "DOC";
  return (
    <span aria-hidden className={cn(CHAT_FILE_PILL_BADGE_CLASS, tone)}>
      {label}
    </span>
  );
}

interface AssistantRowProps {
  name?: string | undefined;
  avatarUrl?: string | null | undefined;
  avatarEmoji?: string | null | undefined;
  showAvatar?: boolean | undefined;
  children: ReactNode;
}

/**
 * Assistant message row — replicates chat-message.tsx layout exactly.
 *
 * Two-column flex layout:
 *   - Left: `w-11` (44 px) gutter, visible on md+, contains `AssistantAvatar size="sm"`.
 *     On mobile the gutter is hidden so content runs full-width.
 *   - Right: `min-w-0 flex-1` prose column, `text-base md:text-sm text-text leading-relaxed`.
 *
 * This approach is self-contained: no extra left padding on the thread
 * container is needed, and the avatar is always visible at md+ regardless
 * of panel width.
 */
export function AssistantRow({
  avatarUrl,
  avatarEmoji,
  showAvatar = true,
  children
}: AssistantRowProps) {
  return (
    <div className="group relative flex py-2 md:py-3">
      {/* Keep the gutter for grouped assistant rows; avatar is shown only at group start. */}
      <div className="w-11 shrink-0 pt-0.5">
        {showAvatar ? (
          <AssistantAvatar
            avatarUrl={avatarUrl ?? DEMO_ASSISTANT_AVATAR_URL}
            avatarEmoji={avatarEmoji}
            size="sm"
          />
        ) : null}
      </div>
      {/* Prose content — full-width flex-1, matches chat-message.tsx */}
      <div className="min-w-0 flex-1">
        <div className="min-w-0 max-w-full break-words text-base leading-relaxed text-text md:text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="group relative flex items-center justify-end py-2 md:py-3">
      <div className="flex max-w-[92%] flex-col items-end gap-1 sm:max-w-[85%] md:max-w-[75%]">
        <div className="min-w-0 max-w-full rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-base leading-relaxed text-text md:px-4 md:py-2.5 md:text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ArtifactPill({
  kind,
  filename,
  meta
}: {
  kind: "pdf" | "pptx" | "docx";
  filename: string;
  meta?: string | undefined;
}) {
  return (
    <div className={CHAT_FILE_PILL_SURFACE_CLASS}>
      <FormatGlyph kind={kind} />
      <span className="truncate font-medium text-text">{filename}</span>
      {meta ? <span className="shrink-0 text-text-subtle">{meta}</span> : null}
    </div>
  );
}

export function MemoryChip({ label }: { label: string }) {
  return <span className="text-text">{label}</span>;
}

export function ChannelFrame({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="inline-block w-full max-w-[36rem] rounded-2xl border border-border bg-surface-raised p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5">
        <Image src="/landing/channels/telegram.png" alt="" width={16} height={16} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-subtle">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Streaming cursor atom — the exact markup from `chat-message.tsx`.
 * Use in the thinking indicator and wherever a live-stream caret is needed.
 * R2 wires the actual streaming; this atom makes the markup available now.
 */
export function StreamingCursor({ reducedMotion = false }: { reducedMotion?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-1.5 rounded-sm bg-accent/70 align-middle",
        !reducedMotion && "animate-pulse"
      )}
    />
  );
}
