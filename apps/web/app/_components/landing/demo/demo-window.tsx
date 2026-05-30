"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  ChevronDown,
  Files,
  FolderKanban,
  Image as ImageIcon,
  Menu,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/app/lib/utils";
import { AssistantAvatar } from "@/app/app/_components/assistant-avatar";
import { DEMO_ASSISTANT_AVATAR_URL } from "./chat-atoms";

/* ------------------------------------------------------------------ */
/* Shared types                                                          */
/* ------------------------------------------------------------------ */

export interface DemoChatRow {
  id: string;
  title: string;
  time?: string | undefined;
  active?: boolean | undefined;
}

export type DemoChatMode = "normal" | "smart" | "project";

/* ------------------------------------------------------------------ */
/* DemoComposer                                                          */
/* ------------------------------------------------------------------ */

export interface DemoComposerProps {
  placeholder: string;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onFocus?: (() => void) | undefined;
  onSubmit?: ((value: string) => void) | undefined;
  disabled?: boolean | undefined;
  /** Optional right-edge slot override (e.g. Send button). */
  rightSlot?: ReactNode | undefined;
}

/**
 * Presentational replica of the real chat composer pill.
 * Matches the `rounded-full border border-border/80 bg-surface-raised` shell
 * from `chat-input.tsx`, with `Paperclip` left and `Mic` right.
 *
 * Two modes:
 * - **Static** (default, no `onChange`): renders the placeholder as a plain
 *   `<span>` so the component stays purely declarative. This is the A2
 *   behavior — existing tests assert `screen.getByText(placeholder)`.
 * - **Interactive** (`onChange` provided): renders a focusable `<input>`
 *   wiring `value`, `onChange`, `onFocus`, `onSubmit` (on Enter), and
 *   `disabled`. Used by the A4 `HeroDemo` island.
 */
export function DemoComposer(props: DemoComposerProps) {
  const { placeholder, value, onChange, onFocus, onSubmit, disabled, rightSlot } = props;
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [recordingPreview, setRecordingPreview] = useState(false);

  const shellClass =
    "relative flex min-h-12 items-center gap-0.5 rounded-full border border-border/80 bg-surface-raised py-1 pl-1 pr-1.5 shadow-sm";
  const iconClass =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors active:bg-surface-hover active:text-text-muted [@media(hover:hover)_and_(pointer:fine)]:hover:bg-surface-hover [@media(hover:hover)_and_(pointer:fine)]:hover:text-text-muted";
  const canSend = (value ?? "").trim().length > 0;
  const attachmentTiles = (
    <AnimatePresence>
      {attachMenuOpen && !disabled && (
        <motion.div
          role="menu"
          aria-label="Attach file"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-full left-0 z-30 mb-2 rounded-2xl border border-border bg-surface-raised p-2 shadow-xl backdrop-blur-sm"
        >
          <div className="grid w-[14rem] grid-cols-3 gap-2">
            {[
              { label: "Camera", icon: <Camera className="h-5 w-5" /> },
              { label: "Photos", icon: <ImageIcon className="h-5 w-5" /> },
              { label: "File", icon: <Files className="h-5 w-5" /> }
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => setAttachMenuOpen(false)}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  const recordingOverlay = (
    <AnimatePresence>
      {recordingPreview && !disabled && (
        <motion.div
          role="status"
          aria-live="polite"
          aria-label="Recording 0:03"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 flex w-auto max-w-[15rem] -translate-x-1/2 flex-col items-stretch"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-raised/92 text-text-subtle shadow-lg backdrop-blur-sm">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-3 rounded-[1.25rem] border border-border bg-surface-raised/95 px-3.5 py-2.5 shadow-xl backdrop-blur-sm">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-ping rounded-full bg-accent/30"
                />
                <span className="relative flex h-full w-full items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Mic className="h-5 w-5" aria-hidden="true" />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-sm font-medium tabular-nums text-text">
                  0:03
                </span>
                <span className="block text-[11px] leading-tight text-text-subtle">
                  Release to send · swipe left to cancel
                </span>
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  const endSlot =
    rightSlot ??
    (canSend ? (
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors active:scale-[0.96] hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        disabled={disabled}
        onClick={() => onSubmit?.(value ?? "")}
        aria-label="Send message"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    ) : (
      <button
        type="button"
        className={iconClass}
        disabled={disabled}
        onPointerDown={() => setRecordingPreview(true)}
        onPointerUp={() => setRecordingPreview(false)}
        onPointerCancel={() => setRecordingPreview(false)}
        onPointerLeave={() => setRecordingPreview(false)}
        aria-label="Voice message"
      >
        <Mic className="h-4 w-4" aria-hidden="true" />
      </button>
    ));

  if (onChange !== undefined) {
    return (
      <div className={shellClass} role="group" aria-label={placeholder}>
        {attachmentTiles}
        {recordingOverlay}
        <button
          type="button"
          className={cn(iconClass, attachMenuOpen && "bg-surface-hover text-text-muted")}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={attachMenuOpen}
          onClick={() => setAttachMenuOpen((open) => !open)}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="text"
          value={value ?? ""}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={placeholder}
          className="flex-1 bg-transparent px-0.5 text-sm leading-5 text-text outline-none placeholder:text-text-subtle disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !disabled) {
              e.preventDefault();
              onSubmit?.(value ?? "");
            }
          }}
        />
        {endSlot}
      </div>
    );
  }

  return (
    <div className={shellClass} role="group" aria-label={placeholder}>
      {attachmentTiles}
      {recordingOverlay}
      <button
        type="button"
        className={cn(iconClass, attachMenuOpen && "bg-surface-hover text-text-muted")}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={attachMenuOpen}
        onClick={() => setAttachMenuOpen((open) => !open)}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="flex-1 px-0.5 text-sm leading-5 text-text-subtle">{placeholder}</span>
      {endSlot}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DemoModeChip — interactive 3-mode switcher                           */
/* ------------------------------------------------------------------ */

export interface DemoModeChipProps {
  mode: DemoChatMode;
  onChange: (mode: DemoChatMode) => void;
  /** Visual-only scripted open state used by landing micro-demos. */
  previewOpen?: boolean | undefined;
  /** Visual-only scripted hover target used by landing micro-demos. */
  previewHoverMode?: DemoChatMode | null | undefined;
  labels: {
    normal: string;
    smart: string;
    project: string;
    normalCaption: string;
    smartCaption: string;
    projectCaption: string;
  };
}

const ALL_MODES: DemoChatMode[] = ["normal", "smart", "project"];

function modeLabel(mode: DemoChatMode, labels: DemoModeChipProps["labels"]): string {
  if (mode === "project") return labels.project;
  if (mode === "smart") return labels.smart;
  return labels.normal;
}

function modeCaption(mode: DemoChatMode, labels: DemoModeChipProps["labels"]): string {
  if (mode === "project") return labels.projectCaption;
  if (mode === "smart") return labels.smartCaption;
  return labels.normalCaption;
}

function ModeIcon({ mode, className }: { mode: DemoChatMode; className?: string }) {
  if (mode === "project") return <FolderKanban className={className} />;
  if (mode === "smart") return <Sparkles className={className} />;
  return null;
}

/**
 * Compact mode-selector chip replicating the real `ChatModeToggle` from
 * `chat-area.tsx`. Visual-only: selecting a mode updates the chip label
 * and premium accent treatment, but does NOT change the thread content.
 *
 * Outside-click and Escape close the menu. All timers cleaned up.
 */
export function DemoModeChip({
  mode,
  onChange,
  previewOpen,
  previewHoverMode,
  labels
}: DemoModeChipProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuOpen = open || previewOpen === true;

  useEffect(() => {
    if (!open || previewOpen === true) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, previewOpen]);

  const select = useCallback(
    (next: DemoChatMode) => {
      setOpen(false);
      onChange(next);
    },
    [onChange]
  );

  const isPremium = mode !== "normal";

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-raised/90 px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm backdrop-blur-sm transition-colors md:px-3 md:py-1.5",
          isPremium && "border-accent-premium/25 text-accent-premium",
          menuOpen && "border-border-strong bg-surface-raised"
        )}
      >
        <ModeIcon
          mode={mode}
          className={cn("h-3.5 w-3.5", isPremium ? "text-accent-premium" : "text-text-muted")}
        />
        <span>{modeLabel(mode, labels)}</span>
        <ChevronDown
          className={cn("h-3 w-3 text-text-subtle transition-transform", menuOpen && "rotate-180")}
        />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute top-full right-0 z-30 mt-2 flex min-w-[11rem] flex-col gap-1 rounded-xl border border-border bg-surface-raised p-1 shadow-xl backdrop-blur-sm"
        >
          {ALL_MODES.map((option) => {
            const active = mode === option;
            const previewHovered = previewHoverMode === option && !active;
            const optionPremium = option !== "normal";
            return (
              <button
                key={option}
                type="button"
                role="menuitem"
                aria-current={active ? "true" : undefined}
                onClick={() => select(option)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold transition-colors",
                  active
                    ? optionPremium
                      ? "bg-accent-premium/10 text-accent-premium"
                      : "bg-surface text-text"
                    : previewHovered
                      ? "bg-surface-hover text-text"
                      : "text-text-muted hover:bg-surface-hover hover:text-text"
                )}
              >
                <ModeIcon
                  mode={option}
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    optionPremium ? "text-accent-premium" : "text-text-muted"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{modeLabel(option, labels)}</span>
                  <span className="block text-[10px] font-normal text-text-subtle">
                    {modeCaption(option, labels)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DemoSidebar                                                           */
/* ------------------------------------------------------------------ */

export interface DemoSidebarProps {
  assistantName: string;
  /** Defaults to "Active" when omitted. */
  assistantStatusLabel?: string | undefined;
  chats?: DemoChatRow[] | undefined;
  userName?: string | undefined;
  userPlanLabel?: string | undefined;
  /** Called when a chat row is clicked. Receives the chat id. */
  onChatSelect?: ((id: string) => void) | undefined;
}

/**
 * Presentational replica of the real `Sidebar`.
 * Uses the same token-based classes as `sidebar.tsx` —
 * `w-[280px] bg-surface md:rounded-2xl md:border md:border-border`,
 * `bg-surface-raised p-3 rounded-xl` assistant card,
 * `bg-chat-active-tint` active row, `text-text-subtle` group labels —
 * but carries zero Clerk/AppData/router dependencies.
 *
 * When `onChatSelect` is provided, each chat row is rendered as a
 * `<button>` so visitors can click to switch threads (visual only).
 */
export function DemoSidebar({
  assistantName,
  assistantStatusLabel = "Active",
  chats,
  userName,
  userPlanLabel,
  onChatSelect
}: DemoSidebarProps) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col rounded-2xl border border-border bg-surface">
      {/* 1. Assistant card — bg-surface-raised p-3 rounded-xl + cog */}
      <div className="px-3 pt-4 pb-3">
        <div className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl bg-surface-raised p-3">
          <AssistantAvatar avatarUrl={DEMO_ASSISTANT_AVATAR_URL} size="md" />
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-text">{assistantName}</p>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" />
              <span className="text-xs text-text-muted">{assistantStatusLabel}</span>
            </span>
          </div>
          <span aria-hidden="true" className="ml-1 shrink-0 rounded-full p-1.5 text-text-subtle/40">
            <Settings className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      {/* 2. New chat button — ghost, matches sidebar.tsx */}
      <div className="px-3 pb-3">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="flex w-full cursor-default items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm font-medium text-text"
        >
          <MessageSquarePlus className="h-4 w-4 text-text-muted" aria-hidden="true" />
          {chats?.find((chat) => chat.id === "c3")?.title ?? "New chat"}
        </button>
      </div>

      {/* 3. Chat list — date-grouped rows, matches sidebar.tsx */}
      <div className="flex-1 overflow-y-auto px-3">
        {chats && chats.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 px-2 text-[11px] font-medium text-text-subtle">Today</p>
            {chats.map((chat) => {
              const rowClass = cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left",
                chat.active
                  ? "bg-chat-active-tint text-text"
                  : "text-text-muted hover:bg-surface-hover hover:text-text",
                onChatSelect ? "cursor-pointer transition-colors" : "cursor-default"
              );
              const inner = (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{chat.title}</span>
                  {chat.time != null && (
                    <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">
                      {chat.time}
                    </span>
                  )}
                </>
              );

              if (onChatSelect) {
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => onChatSelect(chat.id)}
                    className={rowClass}
                  >
                    {inner}
                  </button>
                );
              }

              return (
                <div key={chat.id} className={rowClass}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Account footer — initials circle + name + plan · % + cog */}
      {(userName != null || userPlanLabel != null) && (
        <div className="shrink-0 border-t border-border p-2">
          <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-surface-raised text-[13px] font-semibold text-text-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              {userName?.charAt(0)?.toUpperCase() ?? "U"}
            </span>
            <span className="min-w-0 flex-1">
              {userName != null && (
                <span className="block truncate text-sm font-medium text-text">{userName}</span>
              )}
              {userPlanLabel != null && (
                <span className="block truncate text-[11px] tracking-wide text-text-muted">
                  {userPlanLabel}
                </span>
              )}
            </span>
            <Settings className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
          </div>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* DemoWindow                                                            */
/* ------------------------------------------------------------------ */

export interface DemoWindowProps {
  /** Assistant display name shown in the sidebar header. */
  assistantName: string;
  /** Status label beside the dot in the sidebar header. Defaults to "Active". */
  assistantStatusLabel?: string | undefined;
  /** Sidebar chat row list. */
  chats?: DemoChatRow[] | undefined;
  /** Called when a sidebar chat row is clicked. Receives the chat id. */
  onChatSelect?: ((id: string) => void) | undefined;
  /** Hide the desktop sidebar for focused product moments below the hero. */
  hideSidebar?: boolean | undefined;
  /** Optional replacement for the default assistant/chat sidebar. */
  sidebar?: ReactNode | undefined;
  /** Main panel header title (left side). */
  headerTitle?: string | undefined;
  /**
   * Interactive 3-mode chip props. When provided, renders a `DemoModeChip`.
   * When absent, falls back to the legacy `headerModeLabel` static pill.
   */
  chatMode?: DemoChatMode | undefined;
  onModeChange?: ((mode: DemoChatMode) => void) | undefined;
  modeLabels?: DemoModeChipProps["labels"] | undefined;
  modePreviewOpen?: boolean | undefined;
  modePreviewHoverMode?: DemoChatMode | null | undefined;
  /** @deprecated Replaced by chatMode + onModeChange. Kept for snapshot-test compat. */
  headerModeLabel?: string | undefined;
  /** Bottom sidebar user card name. */
  userName?: string | undefined;
  /** Bottom sidebar user card plan label. */
  userPlanLabel?: string | undefined;
  /**
   * Slot for the composer bar. Defaults to a static `<DemoComposer>`
   * with `composerPlaceholder` if not provided.
   */
  composer?: ReactNode | undefined;
  /** Placeholder text forwarded to the default `DemoComposer`. */
  composerPlaceholder?: string | undefined;
  /** Overlay rendered above the thread and composer inside the main panel. */
  overlay?: ReactNode | undefined;
  /** Ref to the scrollable thread viewport, used by HeroDemo for autoscroll. */
  threadViewportRef?: React.RefObject<HTMLDivElement | null> | undefined;
  /** Optional fixed-height class override for compact landing sections. */
  windowHeightClassName?: string | undefined;
  /** Optional outer frame class override for section-specific alignment. */
  frameClassName?: string | undefined;
  /** The message thread — rendered inside the scrollable thread area. */
  children: ReactNode;
}

/**
 * Desktop-window-framed PersAI-replica shell.
 *
 * Cursor-style product screenshot framing:
 *   backdrop (bg-chrome inset plate) → window card (rounded-2xl border + shadow)
 *   → top bar (traffic-light dots + centered title) → app-shell bento.
 *
 * App-shell bento replicates app-shell.tsx exactly:
 *   bg-chrome outer, gap-2 p-2, w-[280px] sidebar (desktop), main panel
 *   bg-bg rounded-2xl border border-border.
 *
 * All colors use tokens — renders correctly in dark (default) and html.light
 * (ADR-076 re-bound dark: variant). No raw hex outside neumorphic rgba recipes.
 */
export function DemoWindow({
  assistantName,
  assistantStatusLabel,
  chats,
  onChatSelect,
  hideSidebar,
  sidebar,
  headerTitle,
  chatMode,
  onModeChange,
  modeLabels,
  modePreviewOpen,
  modePreviewHoverMode,
  headerModeLabel,
  userName,
  userPlanLabel,
  composer,
  composerPlaceholder,
  overlay,
  threadViewportRef,
  windowHeightClassName,
  frameClassName,
  children
}: DemoWindowProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const hasInteractiveChip =
    chatMode !== undefined && onModeChange !== undefined && modeLabels !== undefined;
  const hasSidebar = sidebar != null || !hideSidebar;
  const sidebarContent = sidebar ?? (
    <DemoSidebar
      assistantName={assistantName}
      assistantStatusLabel={assistantStatusLabel}
      chats={chats}
      userName={userName}
      userPlanLabel={userPlanLabel}
      onChatSelect={(id) => {
        onChatSelect?.(id);
        setMobileSidebarOpen(false);
      }}
    />
  );

  return (
    <div
      className={cn(
        "w-full min-w-0 rounded-3xl bg-chrome p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.06)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_-1px_0_rgba(0,0,0,0.20)] sm:p-4",
        frameClassName
      )}
    >
      {/* The window card — border + neumorphic drop shadow */}
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl border border-border shadow-[0_24px_60px_-12px_rgba(92,72,48,0.26),0_6px_16px_-8px_rgba(92,72,48,0.12)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.58),0_6px_16px_-8px_rgba(0,0,0,0.32)]",
          windowHeightClassName ?? "h-[33rem] md:h-[38rem]"
        )}
      >
        {/* Window top bar — traffic-light dots + centered "PersAI" title */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-chrome px-3 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-destructive/55 dark:bg-destructive/45" />
            <span className="h-3 w-3 rounded-full bg-warning/55 dark:bg-warning/45" />
            <span className="h-3 w-3 rounded-full bg-success/55 dark:bg-success/45" />
          </div>
          <span className="text-xs font-medium text-text-subtle">
            Pers<span className="text-accent">AI</span>
          </span>
          {/* Mirror spacer so title stays truly centered */}
          <div className="w-[3.375rem]" aria-hidden="true" />
        </div>

        {/* App-shell bento: bg-chrome with md:gap-2 md:p-2 */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-chrome md:gap-2 md:p-2">
          {/* Desktop sidebar — hidden on mobile to match app-shell.tsx */}
          {sidebar != null ? (
            <div className="hidden md:flex">{sidebar}</div>
          ) : !hideSidebar ? (
            <div className="hidden md:flex">{sidebarContent}</div>
          ) : null}

          {/* Main panel — bg-bg md:rounded-2xl md:border md:border-border */}
          <div className="relative flex flex-1 flex-col overflow-hidden bg-bg md:rounded-2xl md:border md:border-border">
            {/* Header row — title text-sm font-medium text-text-muted */}
            {headerTitle != null && (
              <div className="flex items-center border-b border-border px-4 py-3">
                {hasSidebar && (
                  <button
                    type="button"
                    className="mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-surface-raised text-text-muted shadow-sm transition-colors hover:bg-surface-hover hover:text-text md:hidden"
                    aria-label="Open sidebar"
                    aria-expanded={mobileSidebarOpen}
                    onClick={() => setMobileSidebarOpen(true)}
                  >
                    <Menu className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                <h1 className="min-w-0 flex-1 truncate text-sm font-medium tracking-normal text-text-muted">
                  {headerTitle}
                </h1>
                {hasInteractiveChip ? (
                  <DemoModeChip
                    mode={chatMode}
                    onChange={onModeChange}
                    previewOpen={modePreviewOpen}
                    previewHoverMode={modePreviewHoverMode}
                    labels={modeLabels}
                  />
                ) : headerModeLabel != null ? (
                  <span className="ml-2 shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted">
                    {headerModeLabel}
                  </span>
                ) : null}
              </div>
            )}

            {/*
              Scrollable thread area. Inner column mirrors chat-area.tsx:
              mx-auto w-full max-w-[50rem]. AssistantRow uses a two-column
              flex layout so the avatar gutter is self-contained without
              needing extra left padding or overflow tricks.
            */}
            <div
              ref={threadViewportRef}
              className="relative flex-1 overflow-x-hidden overflow-y-auto"
            >
              <div
                className="mx-auto w-full max-w-[50rem] px-3 pt-4 pb-4 md:px-4"
                aria-live="polite"
              >
                {children}
              </div>
            </div>

            {/* Composer — pinned at bottom */}
            <div className="border-t border-border p-3">
              {composer ?? (
                <DemoComposer placeholder={composerPlaceholder ?? "…or type your own"} />
              )}
            </div>
            {overlay}
          </div>

          <AnimatePresence>
            {hasSidebar && mobileSidebarOpen && (
              <motion.div
                className="absolute inset-0 z-50 flex md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <button
                  type="button"
                  className="absolute inset-0 bg-black/45"
                  aria-label="Close sidebar"
                  onClick={() => setMobileSidebarOpen(false)}
                />
                <motion.div
                  className="relative z-10 flex h-full w-[min(82vw,280px)] shrink-0 flex-col bg-surface shadow-2xl"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  <button
                    type="button"
                    aria-label="Close sidebar"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="absolute top-3 right-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <div className="h-full [&>aside]:h-full [&>aside]:w-full [&>aside]:rounded-none [&>aside]:border-0">
                    {sidebarContent}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
