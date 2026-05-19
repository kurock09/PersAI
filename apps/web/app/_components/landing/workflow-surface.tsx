import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/lib/utils";

export type WorkflowSurfaceKind =
  | "personality"
  | "memory"
  | "plans"
  | "documents"
  | "media"
  | "knowledge";

export type PersonalitySurfaceStrings = {
  prompt: string;
  reply: string;
  nameLabel: string;
  chosenName: string;
  toneLabel: string;
  toneWarm: string;
  toneDirect: string;
  toneFormal: string;
  voiceLabel: string;
};

export type MemorySurfaceStrings = {
  prompt: string;
  reply: string;
  recall: string;
  memoryTag: string;
};

export type PlansSurfaceStrings = {
  prompt: string;
  reply: string;
  task1: string;
  task2: string;
  task3: string;
  task4: string;
};

export type DocumentsSurfaceStrings = {
  prompt: string;
  reply: string;
  deckCaption: string;
};

export type MediaSurfaceStrings = {
  prompt: string;
  reply: string;
};

export type KnowledgeSurfaceStrings = {
  prompt: string;
  reply: string;
  skillsLabel: string;
  sourcesLabel: string;
  usingLabel: string;
  sourceFile: string;
};

export type WorkflowSurfaceStrings =
  | { kind: "personality"; values: PersonalitySurfaceStrings }
  | { kind: "memory"; values: MemorySurfaceStrings }
  | { kind: "plans"; values: PlansSurfaceStrings }
  | { kind: "documents"; values: DocumentsSurfaceStrings }
  | { kind: "media"; values: MediaSurfaceStrings }
  | { kind: "knowledge"; values: KnowledgeSurfaceStrings };

/**
 * Workflow surface — a premium pseudo-3D *interaction schematic*. Not a
 * screenshot, not a stock illustration. A chat sits under a soft 3D tilt and
 * the right artifacts settle into the scene per kind: memory bubbles, document
 * cards drifting out of chat with mini "real" thumbnails inside (slide
 * preview, paragraph layout), image and video tiles tumbling out of chat with
 * mini illustrations (sunset horizon, abstract composition, silhouette
 * portrait, video frame with timeline), Skills and Sources panels orbiting the
 * chat with file-type glyphs. Composition is held by layout, depth and color —
 * no hairline connectors. Palette uses our tokens plus a tiny set of warm /
 * cool / mono tints that bring life without shouting. Works unchanged in light
 * and dark themes.
 */
export function WorkflowSurface(props: {
  kind: WorkflowSurfaceKind;
  strings: WorkflowSurfaceStrings;
}) {
  const { kind, strings } = props;
  if (kind !== strings.kind) {
    return null;
  }

  return <SceneFrame>{renderScene(strings)}</SceneFrame>;
}

function renderScene(strings: WorkflowSurfaceStrings) {
  switch (strings.kind) {
    case "personality":
      return <PersonalityScene s={strings.values} />;
    case "memory":
      return <MemoryScene s={strings.values} />;
    case "plans":
      return <PlansScene s={strings.values} />;
    case "documents":
      return <DocumentsScene s={strings.values} />;
    case "media":
      return <MediaScene s={strings.values} />;
    case "knowledge":
      return <KnowledgeScene s={strings.values} />;
  }
}

function SceneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[18.5rem] w-full overflow-hidden rounded-2xl border border-border/40 bg-surface-raised/15 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.45)] sm:h-auto sm:aspect-[16/10]">
      {/* Soft aurora glow behind the schematic — gives depth without competing. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-12 top-1/3 h-72 w-72 rounded-full bg-accent/12 blur-[110px]" />
        <div className="absolute -right-14 bottom-1/4 h-64 w-64 rounded-full bg-accent/10 blur-[100px]" />
      </div>
      <div className="relative h-full w-full [perspective:1100px]">
        <div className="h-full w-full origin-center scale-[0.84] min-[360px]:scale-[0.9] sm:scale-100">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Shared schematic atoms
   ────────────────────────────────────────────────────────── */

function ChatBubble(props: {
  side: "user" | "assistant";
  label: string;
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { side, label, text, className, style } = props;
  const isUser = side === "user";
  return (
    <div
      style={style}
      className={cn(
        "relative rounded-2xl border p-2.5 backdrop-blur-sm shadow-[0_14px_30px_-18px_rgba(0,0,0,0.55)] sm:p-3",
        isUser ? "border-border/55 bg-surface-raised/55" : "border-accent/35 bg-accent/[0.07]",
        className
      )}
    >
      <p
        className={cn(
          "text-[9px] font-semibold uppercase tracking-[0.2em]",
          isUser ? "text-text-subtle/75" : "text-accent/85"
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-text">{text}</p>
    </div>
  );
}

function FloatingChip(props: {
  text: string;
  tone?: "accent" | "muted";
  className?: string;
  style?: CSSProperties;
}) {
  const { text, tone = "accent", className, style } = props;
  return (
    <div
      style={style}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] backdrop-blur-sm shadow-[0_8px_18px_-12px_rgba(0,0,0,0.55)]",
        tone === "accent"
          ? "border-accent/45 bg-accent/[0.08] text-accent/90"
          : "border-border/55 bg-surface-raised/60 text-text-subtle",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1 w-1 rounded-full",
          tone === "accent" ? "bg-accent/85" : "bg-text-subtle/55"
        )}
      />
      {text}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Memory scene · stacked chat thread; memory carries forward
   without literal connector lines
   ────────────────────────────────────────────────────────── */

function MemoryScene({ s }: { s: MemorySurfaceStrings }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-3 min-[360px]:px-4 sm:px-10">
      <div className="relative w-full max-w-[22rem] [transform-style:preserve-3d] [transform:rotateY(-12deg)_rotateX(6deg)]">
        <div className="flex flex-col gap-3">
          <ChatBubble
            side="user"
            label="USER"
            text={s.prompt}
            className="self-start max-w-[78%]"
            style={{ transform: "translateZ(0px)" }}
          />
          <ChatBubble
            side="assistant"
            label="PersAI"
            text={s.reply}
            className="self-end max-w-[88%]"
            style={{ transform: "translateZ(20px)" }}
          />
          <ChatBubble
            side="user"
            label="USER"
            text={s.recall}
            className="self-start max-w-[70%]"
            style={{ transform: "translateZ(8px)" }}
          />
        </div>

        {/* Floating memory chip + small color stamps that suggest a thread of
            stored moments without literal text. */}
        <FloatingChip
          text={s.memoryTag}
          className="absolute -right-3 top-[8%]"
          style={{ transform: "translateZ(56px)" }}
        />
        <span
          aria-hidden
          className="absolute -left-4 top-[42%] flex h-3 w-3 items-center justify-center rounded-full bg-amber-400/70 ring-2 ring-amber-200/40 dark:bg-amber-300/65 dark:ring-amber-200/20"
          style={{ transform: "translateZ(48px)" }}
        />
        <span
          aria-hidden
          className="absolute -left-2 top-[68%] h-2.5 w-2.5 rounded-full bg-accent/70 ring-2 ring-accent/20"
          style={{ transform: "translateZ(38px)" }}
        />
        <span
          aria-hidden
          className="absolute -right-1 top-[78%] h-2 w-2 rounded-full bg-rose-400/55 ring-2 ring-rose-200/25 dark:bg-rose-300/55 dark:ring-rose-200/10"
          style={{ transform: "translateZ(30px)" }}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Documents scene · chat on the left, document cards drop out
   ────────────────────────────────────────────────────────── */

function DocumentsScene({ s }: { s: DocumentsSurfaceStrings }) {
  return (
    <div className="absolute inset-0 grid grid-cols-12 items-center gap-2.5 px-3 min-[360px]:gap-3 min-[360px]:px-4 sm:gap-4 sm:px-10">
      <div className="col-span-5">
        <div className="space-y-3 [transform-style:preserve-3d] [transform:rotateY(-10deg)_rotateX(4deg)]">
          <ChatBubble
            side="user"
            label="USER"
            text={s.prompt}
            className="max-w-full"
            style={{ transform: "translateZ(0px)" }}
          />
          <ChatBubble
            side="assistant"
            label="PersAI"
            text={s.reply}
            className="max-w-full"
            style={{ transform: "translateZ(18px)" }}
          />
        </div>
      </div>

      <div className="relative col-span-7 h-full">
        <PdfDocumentCard
          caption={s.deckCaption}
          className="absolute right-[8%] top-[10%] w-[66.5%] sm:w-[55%] [transform:rotate(-4deg)_translateZ(34px)]"
        />
        <PptxDocumentCard
          caption={s.deckCaption}
          className="absolute right-[20%] top-[34%] w-[72.5%] sm:w-[60%] [transform:rotate(2deg)_translateZ(20px)]"
        />
        <DocxDocumentCard
          caption={s.deckCaption}
          className="absolute right-[10%] top-[58%] w-[55%] sm:w-[50%] [transform:rotate(6deg)_translateZ(8px)]"
        />
      </div>
    </div>
  );
}

function DocumentCardShell(props: {
  format: string;
  caption: string;
  tone: "muted" | "accent";
  className?: string | undefined;
  children: ReactNode;
}) {
  const { format, caption, tone, className, children } = props;
  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface-raised/55 p-2.5 backdrop-blur-sm shadow-[0_22px_40px_-22px_rgba(0,0,0,0.65)] sm:p-3",
        tone === "accent" ? "border-accent/45 bg-accent/[0.07]" : "border-border/55",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-[0.22em]",
            tone === "accent"
              ? "border-accent/60 text-accent/95"
              : "border-border/70 text-text-subtle"
          )}
        >
          {format}
        </span>
        <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-text-subtle/70">
          {caption}
        </span>
      </div>
      {children}
    </div>
  );
}

function PdfDocumentCard({ caption, className }: { caption: string; className?: string }) {
  return (
    <DocumentCardShell format="PDF" caption={caption} tone="muted" className={className}>
      <div className="mt-3 space-y-1.5">
        <div className="h-2 w-3/4 rounded-full bg-text/45" />
        <div className="h-1.5 w-full rounded-full bg-text-subtle/30" />
        <div className="h-1.5 w-5/6 rounded-full bg-text-subtle/30" />
        <div className="h-1.5 w-2/3 rounded-full bg-text-subtle/30" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="h-3 w-3 rounded-sm bg-amber-400/60" aria-hidden />
        <div className="h-1.5 flex-1 rounded-full bg-text-subtle/22" />
      </div>
      <div className="mt-1.5 h-1.5 w-4/5 rounded-full bg-text-subtle/22" />
    </DocumentCardShell>
  );
}

function PptxDocumentCard({ caption, className }: { caption: string; className?: string }) {
  return (
    <DocumentCardShell format="PPTX" caption={caption} tone="accent" className={className}>
      {/* Mini slide preview — warm title strip + sage bullets + a tiny chart */}
      <div className="mt-3 overflow-hidden rounded-md border border-border/45 bg-surface-raised/70">
        <div className="h-2 w-full bg-gradient-to-r from-amber-400/70 via-amber-300/45 to-transparent dark:from-amber-300/60 dark:via-amber-200/30" />
        <div className="space-y-1.5 p-2">
          <div className="h-1.5 w-3/4 rounded-full bg-text/45" />
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-accent/80" aria-hidden />
            <div className="h-1 flex-1 rounded-full bg-text-subtle/35" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-accent/80" aria-hidden />
            <div className="h-1 flex-1 rounded-full bg-text-subtle/30" />
          </div>
          {/* Mini bar chart */}
          <div className="mt-1.5 flex h-5 items-end gap-1">
            <div className="h-2/5 w-2 rounded-sm bg-accent/55" />
            <div className="h-3/5 w-2 rounded-sm bg-accent/70" />
            <div className="h-full w-2 rounded-sm bg-accent/85" />
            <div className="h-3/5 w-2 rounded-sm bg-accent/45" />
            <div className="h-1/2 w-2 rounded-sm bg-accent/65" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent/80" aria-hidden />
          <span className="h-1.5 w-1.5 rounded-full bg-text-subtle/35" aria-hidden />
          <span className="h-1.5 w-1.5 rounded-full bg-text-subtle/35" aria-hidden />
        </div>
        <span className="text-[8px] font-medium uppercase tracking-[0.18em] text-text-subtle/70">
          12 slides
        </span>
      </div>
    </DocumentCardShell>
  );
}

function DocxDocumentCard({ caption, className }: { caption: string; className?: string }) {
  return (
    <DocumentCardShell format="DOCX" caption={caption} tone="muted" className={className}>
      <div className="mt-3 space-y-1.5">
        {/* Heading */}
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-400/60" aria-hidden />
          <div className="h-2 flex-1 rounded-full bg-text/45" />
        </div>
        {/* Paragraph */}
        <div className="h-1.5 w-full rounded-full bg-text-subtle/30" />
        <div className="h-1.5 w-11/12 rounded-full bg-text-subtle/30" />
        <div className="h-1.5 w-3/4 rounded-full bg-text-subtle/30" />
        {/* Subheading */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-sm bg-text-subtle/55" aria-hidden />
          <div className="h-1.5 w-1/2 rounded-full bg-text/35" />
        </div>
        <div className="h-1.5 w-5/6 rounded-full bg-text-subtle/30" />
      </div>
    </DocumentCardShell>
  );
}

/* ──────────────────────────────────────────────────────────
   Media scene · chat with mini-illustrated tiles falling out
   ────────────────────────────────────────────────────────── */

function MediaScene({ s }: { s: MediaSurfaceStrings }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-3 min-[360px]:px-4 sm:px-10">
      <div className="relative w-full max-w-[26rem] [transform-style:preserve-3d] [transform:rotateY(-10deg)_rotateX(4deg)]">
        <div className="space-y-3">
          <ChatBubble
            side="user"
            label="USER"
            text={s.prompt}
            className="self-start max-w-[70%]"
            style={{ transform: "translateZ(0px)" }}
          />
          <ChatBubble
            side="assistant"
            label="PersAI"
            text={s.reply}
            className="self-end max-w-[55%]"
            style={{ transform: "translateZ(16px)" }}
          />
        </div>

        {/* Each tile is a tiny "real" composition — sunset horizon, abstract
            blobs, silhouette portrait, video frame with timeline — so the
            scene has palette and life without screenshots. */}
        <SunsetTile className="absolute right-[-6%] top-[18%] h-20 w-20 [transform:rotate(-6deg)_translateZ(40px)]" />
        <AbstractTile className="absolute right-[14%] top-[44%] h-24 w-24 [transform:rotate(3deg)_translateZ(28px)]" />
        <VideoTile className="absolute right-[-8%] top-[60%] h-24 w-32 [transform:rotate(-2deg)_translateZ(50px)]" />
        <PortraitTile className="absolute left-[-4%] top-[78%] h-16 w-20 [transform:rotate(8deg)_translateZ(18px)]" />
      </div>
    </div>
  );
}

function MediaTileShell({
  className,
  children,
  bg
}: {
  className?: string | undefined;
  children: ReactNode;
  bg: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/40 shadow-[0_22px_40px_-22px_rgba(0,0,0,0.65)]",
        bg,
        className
      )}
    >
      {children}
    </div>
  );
}

function SunsetTile({ className }: { className?: string }) {
  return (
    <MediaTileShell
      className={className}
      bg="bg-gradient-to-b from-amber-300/85 via-rose-300/55 to-amber-100/35 dark:from-amber-400/55 dark:via-rose-500/35 dark:to-amber-700/25"
    >
      {/* Sun */}
      <span
        aria-hidden
        className="absolute left-1/2 top-[55%] h-5 w-5 -translate-x-1/2 rounded-full bg-amber-50/95 shadow-[0_0_18px_rgba(255,200,140,0.7)] dark:bg-amber-100/85"
      />
      {/* Horizon */}
      <span
        aria-hidden
        className="absolute inset-x-1 top-[68%] h-px bg-amber-100/85 dark:bg-amber-200/45"
      />
      {/* Mountains */}
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-1/3 w-full bg-gradient-to-t from-text/30 to-transparent dark:from-text/25"
      />
      <span
        aria-hidden
        className="absolute bottom-0 left-[15%] h-[35%] w-[35%] rounded-tl-full rounded-tr-full bg-text/40 dark:bg-text/35"
      />
      <span
        aria-hidden
        className="absolute bottom-0 left-[45%] h-[28%] w-[40%] rounded-tl-full rounded-tr-full bg-text/30 dark:bg-text/30"
      />
    </MediaTileShell>
  );
}

function AbstractTile({ className }: { className?: string }) {
  return (
    <MediaTileShell
      className={className}
      bg="bg-gradient-to-br from-sky-200/70 via-indigo-200/45 to-violet-200/40 dark:from-sky-700/45 dark:via-indigo-700/35 dark:to-violet-700/30"
    >
      {/* Floating blobs that read as a clean, abstract composition */}
      <span
        aria-hidden
        className="absolute left-[20%] top-[20%] h-8 w-8 rounded-full bg-violet-300/70 mix-blend-multiply blur-[1px] dark:bg-violet-400/55 dark:mix-blend-screen"
      />
      <span
        aria-hidden
        className="absolute right-[12%] top-[42%] h-6 w-12 rounded-full bg-sky-300/70 mix-blend-multiply blur-[1px] dark:bg-sky-400/55 dark:mix-blend-screen"
      />
      <span
        aria-hidden
        className="absolute bottom-[14%] left-[30%] h-5 w-7 rounded-full bg-rose-300/70 mix-blend-multiply blur-[1px] dark:bg-rose-400/55 dark:mix-blend-screen"
      />
    </MediaTileShell>
  );
}

function PortraitTile({ className }: { className?: string }) {
  return (
    <MediaTileShell
      className={className}
      bg="bg-gradient-to-b from-stone-200/85 via-stone-300/65 to-stone-400/55 dark:from-stone-700/55 dark:via-stone-800/55 dark:to-stone-900/55"
    >
      {/* Head */}
      <span
        aria-hidden
        className="absolute left-1/2 top-[22%] h-4 w-4 -translate-x-1/2 rounded-full bg-stone-100/90 dark:bg-stone-200/85"
      />
      {/* Shoulders */}
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 h-1/2 w-3/4 -translate-x-1/2 rounded-tl-full rounded-tr-full bg-stone-100/70 dark:bg-stone-200/55"
      />
    </MediaTileShell>
  );
}

function VideoTile({ className }: { className?: string }) {
  return (
    <MediaTileShell
      className={className}
      bg="bg-gradient-to-br from-slate-700/85 via-slate-800/85 to-slate-900/85 dark:from-slate-700/85 dark:via-slate-800/90 dark:to-slate-900/95"
    >
      {/* Subject silhouette */}
      <span
        aria-hidden
        className="absolute bottom-[18%] left-1/2 h-8 w-10 -translate-x-1/2 rounded-tl-full rounded-tr-full bg-slate-300/30"
      />
      <span
        aria-hidden
        className="absolute bottom-[44%] left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-slate-300/40"
      />
      {/* Play button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-[0_4px_14px_rgba(0,0,0,0.5)]">
          <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      {/* Timeline strip */}
      <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-1">
        <div className="h-0.5 flex-1 rounded-full bg-white/30">
          <div className="h-full w-1/3 rounded-full bg-rose-400/85" />
        </div>
        <span className="text-[7px] font-medium tracking-[0.14em] text-white/75">0:24</span>
      </div>
    </MediaTileShell>
  );
}

/* ──────────────────────────────────────────────────────────
   Knowledge scene · skills + sources orbit a chat with attribution
   ────────────────────────────────────────────────────────── */

function KnowledgeScene({ s }: { s: KnowledgeSurfaceStrings }) {
  return (
    <div className="absolute inset-0 grid grid-cols-12 items-center gap-2.5 px-1 min-[360px]:gap-3 min-[360px]:px-1.5 sm:px-10">
      <div className="col-span-4">
        <KnowledgePanel
          title={s.skillsLabel}
          className="[transform:rotate(-3deg)_translateZ(34px)]"
        >
          <div className="flex flex-wrap gap-1.5">
            <KnowledgePill label="marketing" tone="warm" />
            <KnowledgePill label="engineering" tone="cool" />
            <KnowledgePill label="operations" tone="neutral" />
          </div>
        </KnowledgePanel>
      </div>

      <div className="col-span-5">
        <div className="relative space-y-3 [transform-style:preserve-3d] [transform:rotateY(-6deg)_rotateX(4deg)]">
          <ChatBubble
            side="user"
            label="USER"
            text={s.prompt}
            className="max-w-full"
            style={{ transform: "translateZ(0px)" }}
          />
          <ChatBubble
            side="assistant"
            label="PersAI"
            text={s.reply}
            className="max-w-full"
            style={{ transform: "translateZ(20px)" }}
          />
          <FloatingChip
            tone="muted"
            text={`${s.usingLabel} · ${s.sourceFile}`}
            className="self-start"
            style={{ transform: "translateZ(36px)" }}
          />
        </div>
      </div>

      <div className="col-span-3">
        <KnowledgePanel
          title={s.sourcesLabel}
          className="-ml-[15%] w-[125%] max-w-none sm:ml-0 sm:w-auto [transform:rotate(4deg)_translateZ(28px)]"
        >
          <div className="space-y-1.5">
            <SourceRow label="project-brief.pdf" type="pdf" highlighted />
            <SourceRow label="launch-plan.pptx" type="pptx" />
            <SourceRow label="personas.docx" type="docx" />
          </div>
        </KnowledgePanel>
      </div>
    </div>
  );
}

function KnowledgePanel(props: { title: string; className?: string; children: ReactNode }) {
  const { title, className, children } = props;
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/55 bg-surface-raised/55 p-2.5 backdrop-blur-sm shadow-[0_22px_40px_-22px_rgba(0,0,0,0.6)] sm:p-3",
        className
      )}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-text-subtle/75">
        {title}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function KnowledgePill({ label, tone }: { label: string; tone: "warm" | "cool" | "neutral" }) {
  const dotClass =
    tone === "warm" ? "bg-amber-400/80" : tone === "cool" ? "bg-sky-400/80" : "bg-text-subtle/55";
  const borderClass =
    tone === "warm"
      ? "border-amber-300/40 bg-amber-100/40 text-amber-900 dark:border-amber-300/25 dark:bg-amber-200/15 dark:text-amber-200"
      : tone === "cool"
        ? "border-sky-300/40 bg-sky-100/40 text-sky-900 dark:border-sky-300/25 dark:bg-sky-200/15 dark:text-sky-200"
        : "border-border/60 text-text-subtle";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        borderClass
      )}
    >
      <span aria-hidden className={cn("h-1 w-1 rounded-full", dotClass)} />
      {label}
    </span>
  );
}

function SourceRow({
  label,
  type,
  highlighted
}: {
  label: string;
  type: "pdf" | "pptx" | "docx";
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1",
        highlighted ? "border-accent/35 bg-accent/[0.05]" : null
      )}
    >
      <FileTypeGlyph type={type} />
      <span className="truncate text-[10px] font-medium text-text-subtle">{label}</span>
    </div>
  );
}

function FileTypeGlyph({ type }: { type: "pdf" | "pptx" | "docx" }) {
  const tone =
    type === "pdf"
      ? "border-rose-400/55 bg-rose-100/55 text-rose-700 dark:border-rose-300/30 dark:bg-rose-400/15 dark:text-rose-300"
      : type === "pptx"
        ? "border-amber-400/55 bg-amber-100/55 text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/15 dark:text-amber-300"
        : "border-sky-400/55 bg-sky-100/55 text-sky-800 dark:border-sky-300/30 dark:bg-sky-400/15 dark:text-sky-300";
  const label = type === "pdf" ? "PDF" : type === "pptx" ? "PPT" : "DOC";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3.5 w-3 items-center justify-center rounded-[2px] border text-[6px] font-bold tracking-[0.05em]",
        tone
      )}
    >
      {label}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────
   Personality scene · chat assembled from name / tone / voice chips
   ────────────────────────────────────────────────────────── */

function PersonalityScene({ s }: { s: PersonalitySurfaceStrings }) {
  return (
    <div className="absolute inset-0 grid grid-cols-12 items-center gap-2.5 px-3 min-[360px]:gap-3 min-[360px]:px-4 sm:px-10">
      {/* Left side — avatar + name panels */}
      <div className="col-span-4 flex flex-col gap-3">
        <AvatarTile className="[transform:rotate(-4deg)_translateZ(36px)]" />
        <NameChip
          label={s.nameLabel}
          name={s.chosenName}
          className="[transform:rotate(-2deg)_translateZ(26px)]"
        />
      </div>

      {/* Center — chat with one quiet self-introduction */}
      <div className="col-span-5">
        <div className="space-y-3 [transform-style:preserve-3d] [transform:rotateY(-6deg)_rotateX(4deg)]">
          <ChatBubble
            side="user"
            label="USER"
            text={s.prompt}
            className="self-start max-w-[85%]"
            style={{ transform: "translateZ(0px)" }}
          />
          <ChatBubble
            side="assistant"
            label={s.chosenName.toUpperCase()}
            text={s.reply}
            className="max-w-full"
            style={{ transform: "translateZ(22px)" }}
          />
        </div>
      </div>

      {/* Right side — tone + voice */}
      <div className="col-span-3 flex flex-col gap-3">
        <TonePanel
          label={s.toneLabel}
          warm={s.toneWarm}
          direct={s.toneDirect}
          formal={s.toneFormal}
          className="-ml-[15%] w-[125%] max-w-none sm:ml-0 sm:w-auto [transform:rotate(3deg)_translateZ(28px)]"
        />
        <VoiceWaveformPanel
          label={s.voiceLabel}
          className="[transform:rotate(5deg)_translateZ(38px)]"
        />
      </div>
    </div>
  );
}

function AvatarTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative h-16 w-16 self-start overflow-hidden rounded-2xl border border-border/55 bg-gradient-to-br from-accent/35 via-amber-200/40 to-rose-200/40 shadow-[0_14px_30px_-18px_rgba(0,0,0,0.55)] dark:from-accent/40 dark:via-amber-300/25 dark:to-rose-400/25",
        className
      )}
    >
      {/* head */}
      <span
        aria-hidden
        className="absolute left-1/2 top-[28%] h-4 w-4 -translate-x-1/2 rounded-full bg-stone-100/95 dark:bg-stone-200/85"
      />
      {/* shoulders */}
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 h-1/2 w-3/4 -translate-x-1/2 rounded-tl-full rounded-tr-full bg-stone-100/70 dark:bg-stone-200/55"
      />
    </div>
  );
}

function NameChip(props: { label: string; name: string; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/55 bg-surface-raised/55 p-2 backdrop-blur-sm shadow-[0_12px_24px_-14px_rgba(0,0,0,0.55)] sm:p-2.5",
        props.className
      )}
    >
      <p className="text-[8px] font-semibold uppercase tracking-[0.22em] text-text-subtle/75">
        {props.label}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-text-subtle/35" />
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-text-subtle/35" />
        <span className="ml-1.5 text-[11px] font-semibold tracking-[0.02em] text-text">
          {props.name}
        </span>
      </div>
    </div>
  );
}

function TonePanel(props: {
  label: string;
  warm: string;
  direct: string;
  formal: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/55 bg-surface-raised/55 p-2 backdrop-blur-sm shadow-[0_12px_24px_-14px_rgba(0,0,0,0.55)] sm:p-2.5",
        props.className
      )}
    >
      <p className="text-[8px] font-semibold uppercase tracking-[0.22em] text-text-subtle/75">
        {props.label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <ToneChip label={props.warm} tone="warm" active />
        <ToneChip label={props.direct} tone="cool" />
        <ToneChip label={props.formal} tone="neutral" />
      </div>
    </div>
  );
}

function ToneChip({
  label,
  tone,
  active
}: {
  label: string;
  tone: "warm" | "cool" | "neutral";
  active?: boolean;
}) {
  const baseTone =
    tone === "warm"
      ? "border-amber-300/40 text-amber-900 dark:border-amber-300/25 dark:text-amber-200"
      : tone === "cool"
        ? "border-sky-300/40 text-sky-900 dark:border-sky-300/25 dark:text-sky-200"
        : "border-border/55 text-text-subtle";
  const activeBg =
    tone === "warm"
      ? "bg-amber-100/55 dark:bg-amber-200/15"
      : tone === "cool"
        ? "bg-sky-100/55 dark:bg-sky-200/15"
        : "bg-surface-raised/60";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium",
        baseTone,
        active ? activeBg : "bg-transparent"
      )}
    >
      {active ? (
        <span
          aria-hidden
          className={cn(
            "h-1 w-1 rounded-full",
            tone === "warm"
              ? "bg-amber-400/85"
              : tone === "cool"
                ? "bg-sky-400/80"
                : "bg-text-subtle/55"
          )}
        />
      ) : null}
      {label}
    </span>
  );
}

function VoiceWaveformPanel({ label, className }: { label: string; className?: string }) {
  // Bar heights chosen to read as a calm waveform — symmetric rise & fall.
  const bars = [22, 38, 58, 80, 100, 78, 56, 38, 22, 32, 18];
  return (
    <div
      className={cn(
        "rounded-xl border border-accent/35 bg-accent/[0.07] p-2 backdrop-blur-sm shadow-[0_12px_24px_-14px_rgba(0,0,0,0.55)] sm:p-2.5",
        className
      )}
    >
      <p className="text-[8px] font-semibold uppercase tracking-[0.22em] text-accent/85">{label}</p>
      <div className="mt-2 flex h-7 items-end gap-[3px]">
        {bars.map((height, idx) => (
          <span
            key={idx}
            aria-hidden
            style={{ height: `${height}%` }}
            className={cn(
              "w-[3px] rounded-full",
              idx === 4 || idx === 5 ? "bg-accent" : "bg-accent/55"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Plans scene · chat with task chips drifting out (plans, reminders, jobs)
   ────────────────────────────────────────────────────────── */

function PlansScene({ s }: { s: PlansSurfaceStrings }) {
  return (
    <div className="absolute inset-0 grid grid-cols-12 items-center gap-2.5 px-3 min-[360px]:gap-3 min-[360px]:px-4 sm:px-10">
      {/* Left: chat */}
      <div className="col-span-5">
        <div className="space-y-3 [transform-style:preserve-3d] [transform:rotateY(-10deg)_rotateX(4deg)]">
          <ChatBubble
            side="user"
            label="USER"
            text={s.prompt}
            className="max-w-full"
            style={{ transform: "translateZ(0px)" }}
          />
          <ChatBubble
            side="assistant"
            label="PersAI"
            text={s.reply}
            className="max-w-full"
            style={{ transform: "translateZ(18px)" }}
          />
        </div>
      </div>

      {/* Right: floating task chips with statuses */}
      <div className="relative col-span-7 h-full">
        <TaskChip
          icon="calendar"
          tone="warm"
          text={s.task1}
          className="absolute right-[8%] top-[10%] [transform:rotate(-3deg)_translateZ(36px)]"
        />
        <TaskChip
          icon="bell"
          tone="cool"
          text={s.task2}
          className="absolute right-[20%] top-[30%] [transform:rotate(2deg)_translateZ(24px)]"
        />
        <TaskChip
          icon="cog"
          tone="sage"
          pulsing
          text={s.task3}
          className="absolute right-[6%] top-[52%] [transform:rotate(-1deg)_translateZ(44px)]"
        />
        <TaskChip
          icon="check"
          tone="success"
          text={s.task4}
          className="absolute right-[16%] top-[74%] [transform:rotate(4deg)_translateZ(14px)]"
        />
      </div>
    </div>
  );
}

function TaskChip(props: {
  icon: "calendar" | "bell" | "cog" | "check";
  tone: "warm" | "cool" | "sage" | "success";
  text: string;
  pulsing?: boolean;
  className?: string;
}) {
  const { icon, tone, text, pulsing, className } = props;
  const toneClasses =
    tone === "warm"
      ? "border-amber-300/40 bg-amber-100/55 text-amber-900 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200"
      : tone === "cool"
        ? "border-sky-300/40 bg-sky-100/55 text-sky-900 dark:border-sky-300/25 dark:bg-sky-300/10 dark:text-sky-200"
        : tone === "sage"
          ? "border-accent/40 bg-accent/[0.08] text-accent"
          : "border-emerald-300/40 bg-emerald-100/55 text-emerald-900 dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-200";
  const iconColor =
    tone === "warm"
      ? "text-amber-600 dark:text-amber-300"
      : tone === "cool"
        ? "text-sky-600 dark:text-sky-300"
        : tone === "sage"
          ? "text-accent"
          : "text-emerald-600 dark:text-emerald-300";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-surface-raised/60 px-2.5 py-1.5 backdrop-blur-sm shadow-[0_14px_28px_-16px_rgba(0,0,0,0.6)]",
        toneClasses,
        className
      )}
    >
      <span aria-hidden className={cn("relative inline-flex", iconColor)}>
        <TaskIcon icon={icon} />
        {pulsing ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ) : null}
      </span>
      <span className="text-[10px] font-medium leading-none">{text}</span>
    </div>
  );
}

function TaskIcon({ icon }: { icon: "calendar" | "bell" | "cog" | "check" }) {
  const common = { className: "h-3 w-3", viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (icon === "calendar") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === "bell") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 2a1 1 0 0 1 1 1v.6a6 6 0 0 1 5 5.9V13l1.4 2.4a1 1 0 0 1-.9 1.6H5.5a1 1 0 0 1-.9-1.6L6 13V9.5a6 6 0 0 1 5-5.9V3a1 1 0 0 1 1-1zm-2 17h4a2 2 0 0 1-4 0z" />
      </svg>
    );
  }
  if (icon === "cog") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    );
  }
  return (
    <svg
      {...common}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
