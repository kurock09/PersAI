"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "katex/dist/katex.min.css";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  EyeOff,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  FileText,
  Loader2,
  Play
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { AssistantAvatar } from "./assistant-avatar";
import {
  ActivityCommandPreview,
  getActivityDisplayParts,
  type ActivityEvent
} from "./activity-badge";
import {
  buildStreamingMarkdownTailPreview,
  splitStreamingMarkdownContent
} from "./chat-message-streaming";
import { VoiceMessagePlayer } from "./voice-message-player";
import { ImageLightbox } from "./image-lightbox";
import { PresentationPptxPrepareAction } from "./presentation-pptx-prepare-action";
import { AuthenticatedAttachmentImage } from "./authenticated-attachment-image";
import {
  buildChatFileUrl,
  getAssistantDocumentPptxPrepareUrl,
  getAssistantAttachmentPreviewUrl
} from "../assistant-api-client";
import type { ChatAttachment, ChatMessage } from "./use-chat";
import { isAttachmentsOnlyPlaceholderText } from "./attachments-only-placeholder";
import type { RuntimeTurnToolInvocation } from "@persai/runtime-contract";

hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("bash", shell);
hljs.registerLanguage("sh", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex];

type AssistantResponseBlock =
  | { type: "header"; content: string }
  | {
      type: "body";
      content: string;
      title?: string | undefined;
      titleLevel?: 1 | 2 | 3 | undefined;
    }
  | { type: "callout"; content: string; label?: string | undefined }
  | { type: "actions"; actions: string[] }
  | { type: "divider" };

const HEADER_WORDS = new Set([
  "понял",
  "готово",
  "собрал",
  "давай так",
  "принял",
  "окей",
  "хорошо",
  "итак",
  "done",
  "ready",
  "got it",
  "understood"
]);

const ACTION_HEADING_RE =
  /^(actions?|quick actions?|next|next steps?|действия|быстрые действия|варианты|дальше|следующие шаги|что можно сделать дальше)$/i;
const CALLOUT_HEADING_RE =
  /^(важно|итог|фокус|вывод|результат|следующий шаг|note|important|summary|focus|result)$/i;

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[*>_`~]+|[*>_`~]+$/g, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeActionLabel(value: string): string {
  const text = stripInlineMarkdown(value)
    .replace(
      /^(?:(?:if you want|if you'd like),?\s*i can|i can(?: also| still| just)?|want me to)\s+/i,
      ""
    )
    .replace(
      /^(?:(?:если\s+хочешь|если\s+хотите|хочешь|хотите),?\s*(?:я\s+)?)|(?:(?:я\s+)?могу(?:\s+ещ[её])?(?:\s+сразу)?(?:\s+ещ[её])?\s+)/i,
      ""
    )
    .replace(/^[,.:;!?-]+/, "")
    .trim();

  if (text.length === 0) {
    return "";
  }
  return text[0]?.toLocaleUpperCase("ru-RU") + text.slice(1);
}

function isShortHeaderCandidate(value: string): boolean {
  const text = stripInlineMarkdown(value)
    .replace(/[.!?:;]+$/g, "")
    .trim();
  if (!text || text.length > 48) return false;
  if (HEADER_WORDS.has(text.toLowerCase())) return true;
  return text.split(/\s+/).length <= 3 && !/[,.!?;:]/.test(text);
}

function isDividerLine(line: string): boolean {
  return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function parseActionLine(line: string): string | null {
  const explicit = line.match(/^\s*(?:[-*]\s*)?\[\[?action:\s*(.+?)\]?\]\s*$/i);
  if (explicit) {
    const text = normalizeActionLabel(explicit[1] ?? "");
    return text.length === 0 ? null : text;
  }

  const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/);
  if (!bullet) return null;

  const text = normalizeActionLabel(bullet[1] ?? "");
  if (!text || text.length > 72) return null;
  if (/```|`{3,}/.test(text)) return null;
  return text;
}

function isExplicitActionLine(line: string): boolean {
  return /^\s*(?:[-*]\s*)?\[\[?action:\s*.+?\]?\]\s*$/i.test(line);
}

function maybeExtractActionBlock(
  lines: string[],
  startIndex = 0
): { actions: string[]; consumed: number } | null {
  let idx = startIndex;
  while (idx < lines.length && lines[idx]?.trim() === "") idx += 1;
  if (idx >= lines.length) return null;

  const heading = stripInlineMarkdown(lines[idx] ?? "");
  const hasActionHeading = ACTION_HEADING_RE.test(heading);
  if (hasActionHeading) idx += 1;

  const actions: string[] = [];
  let consumed = idx;
  let hasExplicitAction = false;
  while (consumed < lines.length) {
    const line = lines[consumed] ?? "";
    if (line.trim() === "") {
      consumed += 1;
      continue;
    }
    const action = parseActionLine(line);
    if (!action) break;
    hasExplicitAction = hasExplicitAction || isExplicitActionLine(line);
    actions.push(action);
    consumed += 1;
  }

  if (actions.length === 0) return null;
  if (!hasActionHeading && !hasExplicitAction) return null;
  return { actions, consumed: consumed - startIndex };
}

export function parseAssistantResponseBlocks(content: string): AssistantResponseBlock[] {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: AssistantResponseBlock[] = [];
  let bodyLines: string[] = [];
  let bodyHasText = false;
  let pendingTitle: string | undefined;
  let pendingTitleLevel: 1 | 2 | 3 | undefined;
  let inFence = false;
  let sawContent = false;

  const pushBodyLine = (line: string) => {
    bodyLines.push(line);
    if (line.trim().length > 0) {
      bodyHasText = true;
    }
  };

  const flushBody = () => {
    const body = bodyLines.join("\n").trim();
    if (body || pendingTitle) {
      blocks.push({
        type: "body",
        content: body,
        title: pendingTitle,
        titleLevel: pendingTitleLevel
      });
      sawContent = true;
    }
    bodyLines = [];
    bodyHasText = false;
    pendingTitle = undefined;
    pendingTitleLevel = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      pushBodyLine(line);
      continue;
    }

    if (inFence) {
      pushBodyLine(line);
      continue;
    }

    if (isDividerLine(line)) {
      flushBody();
      blocks.push({ type: "divider" });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = stripInlineMarkdown(heading[2] ?? "");
      const titleLevel = heading[1]!.length as 1 | 2 | 3;
      const actionBlock = maybeExtractActionBlock(lines, i + 1);
      if (ACTION_HEADING_RE.test(title) && actionBlock) {
        flushBody();
        blocks.push({ type: "actions", actions: actionBlock.actions });
        i += actionBlock.consumed;
        continue;
      }
      flushBody();
      pendingTitle = title;
      pendingTitleLevel = titleLevel;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      flushBody();
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      i -= 1;
      const [first, ...rest] = quoteLines;
      const firstText = stripInlineMarkdown(first ?? "");
      const hasLabel = CALLOUT_HEADING_RE.test(firstText);
      blocks.push({
        type: "callout",
        label: hasLabel ? firstText : undefined,
        content: (hasLabel ? rest : quoteLines).join("\n").trim()
      });
      sawContent = true;
      continue;
    }

    if (pendingTitle === undefined && !sawContent && !bodyHasText && isShortHeaderCandidate(line)) {
      blocks.push({ type: "header", content: stripInlineMarkdown(line) });
      sawContent = true;
      continue;
    }

    const actionBlock = maybeExtractActionBlock(lines, i);
    if (actionBlock) {
      flushBody();
      blocks.push({ type: "actions", actions: actionBlock.actions });
      i += actionBlock.consumed - 1;
      continue;
    }

    pushBodyLine(line);
  }

  flushBody();
  return blocks.length > 0 ? blocks : [{ type: "body", content }];
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  chatId?: string | null;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  /** When false, the absolute left-gutter avatar is omitted (narrow panes). */
  showAssistantAvatar?: boolean | undefined;
  preResponseStatus?:
    | { kind: "thinking" | "activity"; event?: ActivityEvent | undefined }
    | undefined;
  showShadowRoutingLabel?: boolean | undefined;
  onAssistantAction?: ((text: string) => void) | undefined;
  onDoNotRemember?: ((messageId: string) => void) | undefined;
  forgotten?: boolean | undefined;
  /**
   * When this bubble is the single failed pending-send slot, the parent
   * passes retry/cancel handlers so the user can recover in place.
   * Both are undefined when there is nothing to recover.
   */
  onRetryPendingSend?: (() => void) | undefined;
  onCancelPendingSend?: (() => void) | undefined;
  onDocumentJobAccepted?: (() => void) | undefined;
  /**
   * ADR-157 D4.1 — while subscribed/background notify jobs are open, show a
   * quiet italic line under this assistant reply (not a free-floating status
   * above the composer).
   */
  backgroundWaitFooter?: string | null | undefined;
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("chat");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
      title={t("copy")}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function InlineStreamingStatus({
  preResponseStatus,
  showShadowRoutingLabel = false
}: {
  preResponseStatus:
    | { kind: "thinking" | "activity"; event?: ActivityEvent | undefined }
    | undefined;
  showShadowRoutingLabel?: boolean | undefined;
}) {
  const t = useTranslations("chat");
  const activityEvent =
    preResponseStatus?.kind === "activity" ? preResponseStatus.event : undefined;
  const awaitDeadlineMatch = activityEvent?.detail?.match(/^await-deadline:(\d+)$/);
  const awaitDeadlineMs =
    awaitDeadlineMatch?.[1] === undefined ? null : Number(awaitDeadlineMatch[1]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (awaitDeadlineMs === null) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [awaitDeadlineMs]);
  const statusParts = activityEvent
    ? getActivityDisplayParts(activityEvent, t, showShadowRoutingLabel)
    : {
        label: t("preResponseThinking"),
        detail: undefined,
        shellCommand: undefined,
        shellProgressLines: undefined
      };
  const label =
    awaitDeadlineMs === null
      ? statusParts.label
      : t("awaitCountdown", {
          seconds: Math.max(0, Math.ceil((awaitDeadlineMs - nowMs) / 1000))
        });

  return (
    <span className="animate-fade-in-inline-status inline-flex max-w-full items-start gap-2 text-sm text-text-muted/78 italic motion-reduce:animate-none">
      <span className="mt-[0.2em] inline-block h-4 w-1.5 shrink-0 animate-pulse rounded-sm bg-accent/65" />
      <span className="inline-flex min-w-0 flex-col items-start gap-0.5">
        <span className="inline-flex max-w-full items-baseline gap-1.5 leading-5">
          <span className="shrink-0">{label}</span>
          {statusParts.shellCommand ? (
            <>
              <span className="shrink-0 text-text-subtle/45 not-italic">—</span>
              <ActivityCommandPreview command={statusParts.shellCommand} />
            </>
          ) : statusParts.detail && awaitDeadlineMs === null ? (
            <span className="text-text-subtle/62 not-italic">{statusParts.detail}</span>
          ) : null}
        </span>
        {statusParts.shellProgressLines && statusParts.shellProgressLines.length > 0 ? (
          <span className="font-mono text-xs leading-4 text-text-subtle/55 not-italic tracking-tight">
            {statusParts.shellProgressLines.map((line, index) => (
              <span key={`inline-shell-${String(index)}`} className="block max-w-[28rem] truncate">
                {line}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </span>
  );
}

const COLLAPSE_LINE_THRESHOLD = 15;

function buildThoughtPreview(thought: string): string {
  return thought
    .replace(/^Reasoning:\s*/i, "")
    .replace(/[_*`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function CodeBlock({
  className,
  children
}: {
  className: string | undefined;
  children?: React.ReactNode;
}) {
  const t = useTranslations("chat");
  const text = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "";
  const lineCount = text.split("\n").length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!codeRef.current) return;
    try {
      const result =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(text, { language: lang })
          : hljs.highlightAuto(text);
      codeRef.current.innerHTML = result.value;
    } catch {
      codeRef.current.textContent = text;
    }
  }, [text, lang]);

  return (
    <div className="code-block group relative my-3 overflow-hidden rounded-xl border border-border">
      <div className="flex w-full items-center justify-between border-b border-border bg-surface-raised/45 py-1.5 ps-4 pe-1.5 md:ps-5">
        <span className="min-w-0 max-w-[75%] truncate text-[11px] font-medium text-text-subtle">
          {lang || t("code")}
          {isLong && (
            <span className="ml-1.5 text-text-subtle/50">{t("lines", { count: lineCount })}</span>
          )}
        </span>
        <CopyButton text={text} />
      </div>
      <div className={cn("relative", !expanded && "max-h-[240px] overflow-hidden")}>
        <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed md:p-4">
          <code ref={codeRef} className={className} />
        </pre>
        {!expanded && (
          <div className="code-block-fade absolute inset-x-0 bottom-0 flex items-end justify-center pb-2 pt-10">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="cursor-pointer rounded-md bg-surface-raised px-3 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              {t("showAllLines", { count: lineCount })}
            </button>
          </div>
        )}
      </div>
      {expanded && isLong && (
        <div className="border-t border-border px-3 py-1">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="cursor-pointer text-[11px] text-text-subtle transition-colors hover:text-text-muted"
          >
            {t("collapse")}
          </button>
        </div>
      )}
    </div>
  );
}

function ThoughtBlock({ message }: { message: ChatMessage }) {
  const t = useTranslations("chat");
  const thought = message.thought?.trim() ?? "";
  const [expanded, setExpanded] = useState(message.status === "streaming");

  if (!thought) {
    return null;
  }

  const preview = buildThoughtPreview(thought);

  const thoughtLabel =
    !message.thoughtStartedAt || !message.thoughtFinishedAt
      ? t("thinking")
      : (() => {
          const s = Date.parse(message.thoughtStartedAt);
          const f = Date.parse(message.thoughtFinishedAt);
          if (Number.isNaN(s) || Number.isNaN(f)) return t("thinking");
          return t("thoughtFor", { seconds: Math.max(1, Math.round((f - s) / 1000)) });
        })();

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border/70 bg-surface-raised/50">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover/60"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          {thoughtLabel}
        </span>
        <span className="ml-auto text-text-subtle">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-border/70 px-3 py-2 text-xs text-text-muted">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {thought}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="relative border-t border-border/70 px-3 py-2 text-xs text-text-subtle">
          <div className="max-h-10 overflow-hidden pr-6">{preview}</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-raised/90 to-transparent" />
        </div>
      )}
    </div>
  );
}

function isSafeMarkdownHref(href: unknown): href is string {
  if (typeof href !== "string") {
    return false;
  }
  const normalized = href.trim().toLowerCase();
  return (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("/api/assistant-file/")
  );
}

export type InternalChatCtaMeta = {
  kind: "pricing" | "packages" | "payment";
  href: string;
};

const USER_MEDIA_BUBBLE_RADIUS_CLASS = "rounded-[18px] rounded-br-md";
const USER_MEDIA_CARD_RADIUS_CLASS = "rounded-[14px] rounded-br-[10px]";

const CHAT_FILE_PILL_BADGE_CLASS =
  "inline-flex h-6 min-w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(92,72,48,0.12)] bg-bg/70 px-2 text-[10px] font-semibold tracking-[0.08em] text-text/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] dark:border-white/14 dark:bg-bg/72 dark:text-text dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

const CHAT_FILE_PILL_SURFACE_CLASS =
  "inline-flex w-fit max-w-[min(100%,320px)] min-w-0 flex-nowrap items-center gap-2 overflow-hidden rounded-full border border-[rgba(92,72,48,0.12)] bg-surface-raised/70 px-3 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.74),inset_0_-1px_0_rgba(92,72,48,0.07),0_16px_30px_-24px_rgba(92,72,48,0.42)] dark:border-white/14 dark:bg-surface-raised/72 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),inset_0_-1px_0_rgba(0,0,0,0.24),0_14px_26px_-22px_rgba(0,0,0,0.8)]";

const CHAT_FILE_PILL_FILENAME_CLASS =
  "min-w-0 flex-1 truncate text-[13px] font-medium text-text-muted";

const CHAT_FILE_PILL_SURFACE_HOVER_CLASS =
  "transition-colors hover:border-[rgba(92,72,48,0.18)] hover:bg-surface-raised/84 dark:hover:border-white/20 dark:hover:bg-surface-hover/70";

const CHAT_FILE_PILL_META_CLASS =
  "shrink-0 whitespace-nowrap text-[12px] tabular-nums text-text-subtle";

function internalCtaBadge(kind: InternalChatCtaMeta["kind"]): string {
  switch (kind) {
    case "pricing":
      return "PLAN";
    case "packages":
      return "PKG";
    case "payment":
      return "PAY";
  }
}

export function resolveInternalChatCta(href: string): InternalChatCtaMeta | null {
  const normalizedHref = href.trim();
  if (!normalizedHref) return null;

  const normalizedPath = (() => {
    if (normalizedHref.startsWith("http://") || normalizedHref.startsWith("https://")) {
      try {
        const url = new URL(normalizedHref);
        if (url.hostname !== "persai.dev" && url.hostname !== "www.persai.dev") return null;
        return `${url.pathname}${url.search}`;
      } catch {
        return null;
      }
    }
    if (normalizedHref.startsWith("/")) {
      return normalizedHref;
    }
    return null;
  })();

  if (normalizedPath === null) return null;
  const pathOnly = normalizedPath.split("?")[0] ?? normalizedPath;

  if (pathOnly === "/app/pricing") {
    return { kind: "pricing", href: normalizedPath };
  }
  if (pathOnly === "/app/packages") {
    return { kind: "packages", href: normalizedPath };
  }
  if (pathOnly.startsWith("/app/billing/checkout/")) {
    return { kind: "payment", href: normalizedPath };
  }
  return null;
}

function InternalChatCtaLink({ meta }: { meta: InternalChatCtaMeta }) {
  const t = useTranslations("chat");
  const label =
    meta.kind === "pricing"
      ? t("internalCtaPricing")
      : meta.kind === "packages"
        ? t("internalCtaPackages")
        : t("internalCtaCheckout");

  return (
    <Link
      href={meta.href as Parameters<typeof Link>[0]["href"]}
      className={cn("my-2", CHAT_FILE_PILL_SURFACE_CLASS, CHAT_FILE_PILL_SURFACE_HOVER_CLASS)}
    >
      <span className={CHAT_FILE_PILL_BADGE_CLASS}>{internalCtaBadge(meta.kind)}</span>
      <span className="truncate text-[13px] font-medium text-text-muted">{label}</span>
      <span className={CHAT_FILE_PILL_META_CLASS} aria-hidden>
        ›
      </span>
    </Link>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const markdownComponents: Record<string, React.ComponentType<any>> = {
  code: ({
    className,
    children,
    ...props
  }: {
    className: string | undefined;
    children?: React.ReactNode;
  }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code className="rounded bg-surface-raised px-1.5 py-0.5 text-[13px] text-accent" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<"table">) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<"th">) => (
    <th
      className="border-b border-border bg-surface-raised px-3 py-2 text-left text-xs font-semibold text-text-muted"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<"td">) => (
    <td className="border-b border-border px-3 py-2 text-text" {...props}>
      {children}
    </td>
  ),
  a: ({ children, href, ...props }: React.ComponentPropsWithoutRef<"a">) => {
    if (isSafeMarkdownHref(href)) {
      const internalCta = resolveInternalChatCta(href);
      if (internalCta) {
        return <InternalChatCtaLink meta={internalCta} />;
      }
      return (
        <a
          className="text-accent underline decoration-accent/30 hover:decoration-accent"
          target="_blank"
          rel="noopener noreferrer"
          href={href}
          {...props}
        >
          {children}
        </a>
      );
    }
    return <span className="text-text-muted">{children}</span>;
  },
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
    <p className="mb-3 whitespace-pre-wrap last:mb-0 leading-relaxed" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<"ul">) => (
    <ul
      className="mb-3 list-disc space-y-1 pl-7 marker:text-text-subtle last:mb-0 [&>li]:pl-1"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<"ol">) => (
    <ol
      className="mb-3 list-decimal space-y-1 pl-7 marker:text-text-subtle last:mb-0 [&>li]:pl-1"
      {...props}
    >
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="my-3 border-l-2 border-accent/40 pl-4 text-text-muted italic" {...props}>
      {children}
    </blockquote>
  ),
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<"h1">) => (
    <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<"h2">) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0" {...props}>
      {children}
    </h3>
  )
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function MarkdownFragment({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

type IterationProcessPiece =
  | { kind: "text"; markdown: string }
  | { kind: "tool"; tool: RuntimeTurnToolInvocation };

type IterationBlock =
  | { kind: "content"; markdown: string }
  | { kind: "process"; pieces: IterationProcessPiece[] };

function isContentBlock(text: string): boolean {
  if (/^\s*\|.*\|.*\|/m.test(text)) return true;
  if (/^\s*#{2,}\s+\S/m.test(text)) return true;
  if (/```/.test(text)) return true;

  const lines = text.split(/\r?\n/);
  let consecutiveListLines = 0;
  for (const line of lines) {
    if (/^\s*([-*+]|\d+\.)\s+\S/.test(line)) {
      consecutiveListLines += 1;
      if (consecutiveListLines >= 3) return true;
    } else if (line.trim().length === 0) {
      // Blank lines keep a markdown list visually continuous.
    } else {
      consecutiveListLines = 0;
    }
  }
  return false;
}

function buildIterationBlocks(
  workingNotes: string[],
  toolInvocations: RuntimeTurnToolInvocation[],
  options: { committed: boolean }
): IterationBlock[] {
  const allPieces: IterationProcessPiece[] = [];
  const contentBlocks: Array<{ insertAfterPieceIndex: number; markdown: string }> = [];
  const iterations = Math.max(
    workingNotes.length,
    ...toolInvocations.map((tool) => tool.iteration + 1),
    0
  );

  for (let i = 0; i < iterations; i += 1) {
    const text = (workingNotes[i] ?? "").trim();
    if (text.length > 0) {
      if (isContentBlock(text)) {
        contentBlocks.push({ insertAfterPieceIndex: allPieces.length, markdown: text });
      } else {
        allPieces.push({ kind: "text", markdown: text });
      }
    }

    const toolsAtIteration = toolInvocations.filter((tool) => tool.iteration === i);
    for (const tool of toolsAtIteration) {
      allPieces.push({ kind: "tool", tool });
    }
  }

  if (options.committed) {
    const blocks: IterationBlock[] = [];
    if (allPieces.length > 0) {
      blocks.push({ kind: "process", pieces: allPieces });
    }
    for (const contentBlock of contentBlocks) {
      blocks.push({ kind: "content", markdown: contentBlock.markdown });
    }
    return blocks;
  }

  const blocks: IterationBlock[] = [];
  let currentProcess: IterationProcessPiece[] | null = null;
  const flushProcess = () => {
    if (currentProcess && currentProcess.length > 0) {
      blocks.push({ kind: "process", pieces: currentProcess });
    }
    currentProcess = null;
  };
  const contentMap = new Map<number, string>();
  for (const contentBlock of contentBlocks) {
    contentMap.set(contentBlock.insertAfterPieceIndex, contentBlock.markdown);
  }
  for (let i = 0; i <= allPieces.length; i += 1) {
    if (contentMap.has(i)) {
      flushProcess();
      blocks.push({ kind: "content", markdown: contentMap.get(i)! });
    }
    if (i < allPieces.length) {
      currentProcess = currentProcess ?? [];
      currentProcess.push(allPieces[i]!);
    }
  }
  flushProcess();
  return blocks;
}

type ToolFamilyId =
  | "browser"
  | "sandbox"
  | "knowledgeSearch"
  | "knowledgeFetch"
  | "webSearch"
  | "webFetch"
  | "files"
  | "workspaceSearch"
  | "todo"
  | "skill"
  | "imageGenerate"
  | "imageEdit"
  | "videoGenerate"
  | "document"
  | "memory"
  | "cron"
  | "message"
  | "sessions"
  | "requestUserAction"
  | "other";

type ToolFamilyMicroRow = {
  family: ToolFamilyId;
  count: number;
  failedCount: number;
};

function resolveToolFamily(name: string): ToolFamilyId {
  switch (name) {
    case "browser":
      return "browser";
    case "shell":
    case "exec":
      return "sandbox";
    case "knowledge_search":
      return "knowledgeSearch";
    case "knowledge_fetch":
      return "knowledgeFetch";
    case "web_search":
      return "webSearch";
    case "web_fetch":
      return "webFetch";
    case "files":
    case "files_write":
    case "files.write":
    case "files_read":
    case "files.read":
    case "files_list":
    case "files_preview":
      return "files";
    case "grep":
    case "glob":
      return "workspaceSearch";
    case "todo_write":
      return "todo";
    case "skill":
      return "skill";
    case "image_generate":
      return "imageGenerate";
    case "image_edit":
      return "imageEdit";
    case "video_generate":
      return "videoGenerate";
    case "document":
      return "document";
    case "memory_search":
      return "memory";
    case "cron":
      return "cron";
    case "message":
      return "message";
    case "sessions_list":
    case "sessions_history":
    case "sessions_send":
    case "session_status":
      return "sessions";
    case "request_user_action":
      return "requestUserAction";
    default:
      return "other";
  }
}

function buildToolFamilyMicroRows(pieces: IterationProcessPiece[]): ToolFamilyMicroRow[] {
  const order: ToolFamilyId[] = [];
  const counts = new Map<ToolFamilyId, { count: number; failedCount: number }>();

  for (const piece of pieces) {
    if (piece.kind !== "tool") continue;
    const family = resolveToolFamily(piece.tool.name);
    const current = counts.get(family);
    if (!current) {
      order.push(family);
      counts.set(family, {
        count: 1,
        failedCount: piece.tool.ok ? 0 : 1
      });
      continue;
    }
    current.count += 1;
    if (!piece.tool.ok) current.failedCount += 1;
  }

  return order.map((family) => {
    const entry = counts.get(family)!;
    return { family, count: entry.count, failedCount: entry.failedCount };
  });
}

function formatToolFamilyMicroRow(
  row: ToolFamilyMicroRow,
  t: ReturnType<typeof useTranslations>
): string {
  const base = t(`processBadge.micro.${row.family}`, { n: row.count });
  if (row.failedCount <= 0) return base;
  return `${base}${t("processBadge.micro.failedSuffix", { n: row.failedCount })}`;
}

function resolveProcessBadgeLabel(
  pieces: IterationProcessPiece[],
  t: ReturnType<typeof useTranslations>
): string {
  const toolPieces = pieces.filter(
    (piece): piece is Extract<IterationProcessPiece, { kind: "tool" }> => piece.kind === "tool"
  );
  const allTools = toolPieces.length === pieces.length && toolPieces.length > 0;
  const firstToolName = toolPieces[0]?.tool.name;
  const hasSingleToolName =
    allTools &&
    firstToolName !== undefined &&
    toolPieces.every((piece) => piece.tool.name === firstToolName);

  if (hasSingleToolName) {
    switch (firstToolName) {
      case "web_search":
      case "knowledge_search":
        return t("processBadge.exploredSearches", { n: toolPieces.length });
      case "knowledge_fetch":
        return t("processBadge.knowledgeFetches", { n: toolPieces.length });
      case "web_fetch":
        return t("processBadge.readPages", { n: toolPieces.length });
      case "image_generate":
        return t("processBadge.generatedImages", { n: toolPieces.length });
      case "image_edit":
        return t("processBadge.editedImages", { n: toolPieces.length });
      case "video_generate":
        return t("processBadge.generatedVideos", { n: toolPieces.length });
      case "document":
        return t("processBadge.preparedDocuments", { n: toolPieces.length });
      case "files_write":
      case "files.write":
        return t("processBadge.wroteFiles", { n: toolPieces.length });
      case "files_read":
      case "files.read":
      case "files_list":
      case "files_preview":
        return t("processBadge.readFiles", { n: toolPieces.length });
      case "shell":
        return t("processBadge.ranCommands", { n: toolPieces.length });
    }
  }

  return t("processBadge.worked", { steps: pieces.length });
}

function ProcessBadge({ pieces }: { pieces: IterationProcessPiece[] }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations("chat");
  const label = resolveProcessBadgeLabel(pieces, t);
  const textPieces = pieces.filter(
    (piece): piece is Extract<IterationProcessPiece, { kind: "text" }> => piece.kind === "text"
  );
  const toolMicroRows = buildToolFamilyMicroRows(pieces);

  if (pieces.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="group inline-flex items-center gap-1.5 text-sm leading-relaxed text-text-muted/72 transition-colors hover:text-text-muted"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-text-subtle/70 transition-colors group-hover:text-text-muted" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-text-subtle/70 transition-colors group-hover:text-text-muted" />
        )}
        <span>{label}</span>
      </button>
      {expanded ? (
        <div className="mt-2 border-l border-border/70 pl-3">
          {textPieces.length > 0 ? (
            <div className="space-y-2 text-sm text-text-muted/72">
              {textPieces.map((piece, index) => (
                <div key={`text-${index}-${piece.markdown}`} className="leading-relaxed">
                  <MarkdownFragment content={piece.markdown} />
                </div>
              ))}
            </div>
          ) : null}
          {toolMicroRows.length > 0 ? (
            <div
              className={`space-y-0.5 text-xs leading-snug text-text-subtle/80 ${
                textPieces.length > 0 ? "mt-2" : ""
              }`}
            >
              {toolMicroRows.map((row) => (
                <div key={row.family}>{formatToolFamilyMicroRow(row, t)}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IterationBlocks({ blocks }: { blocks: IterationBlock[] }) {
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div className="mb-4 space-y-3">
      {blocks.map((block, index) =>
        block.kind === "content" ? (
          <div key={`content-${index}`} className="text-text">
            <MarkdownMessageContent content={block.markdown} />
          </div>
        ) : (
          <ProcessBadge key={`process-${index}`} pieces={block.pieces} />
        )
      )}
    </div>
  );
}

function AssistantActionChips({
  actions,
  onAction
}: {
  actions: string[];
  onAction?: ((text: string) => void) | undefined;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="assistant-response-actions mt-4" data-testid="assistant-response-actions">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onAction?.(action)}
          className="assistant-response-action-chip"
          disabled={!onAction}
        >
          {action}
        </button>
      ))}
    </div>
  );
}

function AssistantSectionTitle({ title, level }: { title: string; level?: 1 | 2 | 3 | undefined }) {
  const effectiveLevel = level ?? 3;
  const className =
    effectiveLevel === 1
      ? "mb-3 mt-2 text-[19px] font-semibold leading-[1.35] tracking-[-0.02em] text-text"
      : effectiveLevel === 2
        ? "mb-3 mt-1.5 text-[17px] font-semibold leading-[1.4] tracking-[-0.015em] text-text"
        : "mb-2.5 mt-1 text-sm font-semibold leading-[1.45] tracking-[-0.005em] text-text";

  return <div className={className}>{title}</div>;
}

const MarkdownMessageContent = memo(function MarkdownMessageContent({
  content,
  onAction
}: {
  content: string;
  onAction?: ((text: string) => void) | undefined;
}) {
  const blocks = useMemo(() => parseAssistantResponseBlocks(content), [content]);

  return (
    <div className="assistant-response-blocks space-y-3">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "header") {
          return (
            <div key={key} className="assistant-response-header">
              {block.content}
            </div>
          );
        }
        if (block.type === "divider") {
          return <div key={key} className="h-px bg-border/70" />;
        }
        if (block.type === "actions") {
          return <AssistantActionChips key={key} actions={block.actions} onAction={onAction} />;
        }
        if (block.type === "callout") {
          return (
            <div
              key={key}
              className="rounded-2xl border border-accent/20 bg-accent/8 px-3.5 py-3 text-sm shadow-[inset_3px_0_0_rgba(191,148,84,0.45)]"
            >
              {block.label ? (
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent/90">
                  {block.label}
                </div>
              ) : null}
              {block.content ? (
                <div className="text-text-muted">
                  <MarkdownFragment content={block.content} />
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <section key={key} className="py-1.5 first:pt-0 last:pb-0">
            {block.title ? (
              <AssistantSectionTitle title={block.title} level={block.titleLevel} />
            ) : null}
            <MarkdownFragment content={block.content} />
          </section>
        );
      })}
    </div>
  );
});

function StreamingMarkdownMessageContent({
  content,
  onAction
}: {
  content: string;
  onAction?: ((text: string) => void) | undefined;
}) {
  const { stableContent, liveTailPreview } = useMemo(() => {
    const segments = splitStreamingMarkdownContent(content);
    return {
      ...segments,
      liveTailPreview: buildStreamingMarkdownTailPreview(segments.liveTail)
    };
  }, [content]);

  return (
    <>
      {stableContent.length > 0 ? (
        <MarkdownMessageContent content={stableContent} onAction={onAction} />
      ) : null}
      {liveTailPreview.length > 0 ? (
        <div className="streaming-markdown-live text-text/95">
          <MarkdownFragment content={liveTailPreview} />
        </div>
      ) : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentTypeBadge(attachment: ChatAttachment): string {
  const mimeType = attachment.mimeType.toLowerCase();
  const filename = (attachment.originalFilename ?? "").toLowerCase();
  if (mimeType === "application/pdf" || filename.endsWith(".pdf")) return "PDF";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    filename.endsWith(".docx") ||
    filename.endsWith(".doc")
  ) {
    return "WORD";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    filename.endsWith(".pptx") ||
    filename.endsWith(".ppt")
  ) {
    return "PPT";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls")
  ) {
    return "XLS";
  }
  if (mimeType.includes("csv") || filename.endsWith(".csv")) return "CSV";
  if (mimeType.includes("json") || filename.endsWith(".json")) return "JSON";
  if (mimeType.includes("markdown") || filename.endsWith(".md")) return "MD";
  if (mimeType.startsWith("text/") || filename.endsWith(".txt")) return "TXT";
  if (mimeType.includes("zip") || filename.endsWith(".zip")) return "ZIP";
  if (mimeType.startsWith("video/") || attachment.attachmentType === "video") return "VIDEO";
  return "FILE";
}

function userMessageHasVoiceAttachment(attachments: ChatAttachment[] | undefined): boolean {
  return (
    attachments?.some((a) => a.attachmentType === "audio" || a.attachmentType === "voice") ?? false
  );
}

function formatVideoDuration(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }
  const total = Math.round(totalSeconds);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

type VideoPreviewFramePreset = "portrait" | "square" | "landscape";
type ImagePreviewFramePreset = "portrait" | "square" | "landscape";

function captureVideoPreviewFrame(video: HTMLVideoElement): string | null {
  const intrinsicWidth = video.videoWidth;
  const intrinsicHeight = video.videoHeight;
  if (
    !Number.isFinite(intrinsicWidth) ||
    !Number.isFinite(intrinsicHeight) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0
  ) {
    return null;
  }

  const maxCanvasWidth = 480;
  const scale = Math.min(1, maxCanvasWidth / intrinsicWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(intrinsicWidth * scale));
  canvas.height = Math.max(1, Math.round(intrinsicHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return null;
  }
}

function canShowInlineVideoFrameSurface(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const maybeNative = window as unknown as {
    PersaiNative?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (
    maybeNative.PersaiNative ||
    (typeof maybeNative.Capacitor?.isNativePlatform === "function" &&
      maybeNative.Capacitor.isNativePlatform())
  ) {
    return false;
  }
  return !/Android/i.test(window.navigator.userAgent);
}

function resolveVideoPreviewFrame(aspectRatio: number | null): {
  preset: VideoPreviewFramePreset;
  width: number;
  height: number;
  aspectRatio: number;
} {
  const resolvedAspectRatio =
    typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : 4 / 5;
  if (resolvedAspectRatio < 0.85) {
    return {
      preset: "portrait",
      width: 151,
      height: 210,
      aspectRatio: 151 / 210
    };
  }
  if (resolvedAspectRatio <= 1.2) {
    return {
      preset: "square",
      width: 151,
      height: 151,
      aspectRatio: 1
    };
  }
  return {
    preset: "landscape",
    width: 168,
    height: 95,
    aspectRatio: 16 / 9
  };
}

function resolveImagePreviewFrame(aspectRatio: number | null): {
  preset: ImagePreviewFramePreset;
  width: number;
  height: number;
} {
  const resolvedAspectRatio =
    typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : 1;
  if (resolvedAspectRatio < 0.85) {
    return {
      preset: "portrait",
      width: 151,
      height: 210
    };
  }
  if (resolvedAspectRatio <= 1.2) {
    return {
      preset: "square",
      width: 151,
      height: 151
    };
  }
  return {
    preset: "landscape",
    width: 240,
    height: 151
  };
}

function getAttachmentAssetKey(attachment: ChatAttachment): string | null {
  if (typeof attachment.path === "string" && attachment.path.trim().length > 0) {
    return `path:${attachment.path}`;
  }
  if (
    typeof attachment.externalDownloadUrl === "string" &&
    attachment.externalDownloadUrl.trim().length > 0
  ) {
    return `external:${attachment.externalDownloadUrl.trim()}`;
  }
  return null;
}

function shouldSuppressDuplicatePreviewableFile(
  attachment: ChatAttachment,
  previewableAssetKeys: ReadonlySet<string>
): boolean {
  if (
    attachment.attachmentType === "image" ||
    attachment.attachmentType === "video" ||
    attachment.attachmentType === "audio" ||
    attachment.attachmentType === "voice"
  ) {
    return false;
  }
  const assetKey = getAttachmentAssetKey(attachment);
  if (assetKey === null) {
    return false;
  }
  const isPreviewableMime =
    attachment.mimeType.startsWith("image/") || attachment.mimeType.startsWith("video/");
  return isPreviewableMime && previewableAssetKeys.has(assetKey);
}

/**
 * Video attachment preview rendered inline in a chat bubble. Uses compact,
 * fixed portrait/square/landscape presets instead of expanding to a full-width
 * player. The Telegram-style play+duration chip signals that it is playable;
 * tapping the card opens the same {@link ImageLightbox} that images use.
 *
 * A real `<video>` stays mounted for metadata. We only reveal that decoded
 * surface on non-Android browser surfaces. For Android/Capacitor we draw a
 * real decoded frame into a canvas and show that image instead, avoiding the
 * WebView's native grey play fallback while still showing a true thumbnail.
 */
function VideoAttachmentPreview({
  variant,
  fullUrl,
  previewUrl,
  downloadUrl,
  filename,
  isPending,
  progressLabel,
  isLightboxOpen,
  onOpen,
  onClose
}: {
  variant: "default" | "user-media";
  fullUrl: string | null;
  previewUrl: string | null;
  downloadUrl: string | undefined;
  filename: string | undefined;
  isPending: boolean;
  progressLabel: string | null;
  isLightboxOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("chat");
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [previewFrameReady, setPreviewFrameReady] = useState(false);
  const [previewThumbnailUrl, setPreviewThumbnailUrl] = useState<string | null>(null);
  const [showInlineVideoFrameSurface, setShowInlineVideoFrameSurface] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const durationLabel = durationSec !== null ? formatVideoDuration(durationSec) : null;
  const previewFrame = useMemo(
    () => resolveVideoPreviewFrame(videoAspectRatio),
    [videoAspectRatio]
  );

  const capturePreviewThumbnail = useCallback(() => {
    const video = previewVideoRef.current;
    if (video === null) {
      return;
    }
    const frameUrl = captureVideoPreviewFrame(video);
    if (frameUrl !== null) {
      setPreviewThumbnailUrl(frameUrl);
    }
  }, []);

  useEffect(() => {
    setDurationSec(null);
    setVideoAspectRatio(null);
    setPreviewFrameReady(false);
    setPreviewThumbnailUrl(previewUrl);
  }, [fullUrl, previewUrl]);

  useEffect(() => {
    setShowInlineVideoFrameSurface(canShowInlineVideoFrameSurface());
  }, []);

  if (!fullUrl || isPending) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        <span>{filename ?? "Video"}</span>
        {progressLabel ? <span className="text-text-subtle">{progressLabel}</span> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("openVideo")}
        className={cn(
          "group relative block overflow-hidden transition focus:ring-2 focus:ring-accent focus:outline-none",
          variant === "user-media"
            ? `${USER_MEDIA_CARD_RADIUS_CLASS} bg-transparent`
            : "rounded-[18px] border border-border/70 hover:border-border-strong"
        )}
      >
        <div
          data-testid="chat-video-preview-placeholder"
          data-preset={previewFrame.preset}
          data-aspect-ratio={previewFrame.aspectRatio.toFixed(4)}
          data-thumbnail-ready={previewThumbnailUrl === null ? "false" : "true"}
          className="relative flex items-center justify-center overflow-hidden border border-white/8 bg-[radial-gradient(circle_at_24%_18%,rgba(202,162,95,0.32),transparent_32%),linear-gradient(145deg,rgba(42,33,24,0.96),rgba(14,12,10,0.98))] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.72)]"
          style={{
            width: `${previewFrame.width}px`,
            height: `${previewFrame.height}px`
          }}
        >
          <video
            ref={previewVideoRef}
            preload="auto"
            muted
            playsInline
            // `disableRemotePlayback` keeps Android WebView from showing
            // an AirPlay/Cast button in the inline preview.
            disableRemotePlayback
            data-preview-frame-ready={previewFrameReady ? "true" : "false"}
            data-inline-frame-surface={showInlineVideoFrameSurface ? "enabled" : "disabled"}
            className={cn(
              "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
              previewFrameReady && showInlineVideoFrameSurface ? "opacity-100" : "opacity-0"
            )}
            src={fullUrl}
            onLoadedMetadata={(e) => {
              setDurationSec(e.currentTarget.duration);
              const intrinsicWidth =
                typeof e.currentTarget.videoWidth === "number" ? e.currentTarget.videoWidth : 0;
              const intrinsicHeight =
                typeof e.currentTarget.videoHeight === "number" ? e.currentTarget.videoHeight : 0;
              if (intrinsicWidth > 0 && intrinsicHeight > 0) {
                setVideoAspectRatio(intrinsicWidth / intrinsicHeight);
              }
              const duration =
                typeof e.currentTarget.duration === "number" ? e.currentTarget.duration : 0;
              const seekTarget =
                Number.isFinite(duration) && duration > 0 ? Math.min(0.2, duration / 2) : 0;
              if (seekTarget > 0) {
                try {
                  e.currentTarget.currentTime = seekTarget;
                } catch {
                  capturePreviewThumbnail();
                }
              }
            }}
            onLoadedData={() => {
              setPreviewFrameReady(true);
              capturePreviewThumbnail();
            }}
            onSeeked={capturePreviewThumbnail}
            onError={() => setPreviewFrameReady(false)}
          >
            <track kind="captions" />
          </video>
          {previewThumbnailUrl !== null ? (
            <img
              data-testid="chat-video-preview-thumbnail"
              src={previewThumbnailUrl}
              alt={`${filename ?? "Video"} preview`}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_34%,rgba(0,0,0,0.38))]" />
          {durationLabel ? (
            <div className="absolute inset-x-3 top-3 flex items-start justify-end">
              <span className="rounded-full bg-black/42 px-2 py-1 text-[10px] font-medium text-white/88 backdrop-blur-sm">
                {durationLabel}
              </span>
            </div>
          ) : null}
          <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-white/18 bg-white/14 text-white shadow-[0_18px_44px_-24px_rgba(0,0,0,0.9)] backdrop-blur-md transition group-hover:scale-[1.03]">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </div>
      </button>
      <ImageLightbox
        open={isLightboxOpen}
        src={fullUrl}
        downloadUrl={downloadUrl ?? fullUrl}
        filename={filename}
        alt={filename}
        mediaType="video"
        posterSrc={previewUrl}
        videoSourceUrl={fullUrl}
        onClose={onClose}
      />
    </div>
  );
}

function ImageAttachmentPreview({
  src,
  alt,
  pending,
  variant
}: {
  src: string;
  alt: string;
  pending: boolean;
  variant: "default" | "user-media";
}) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const previewFrame = useMemo(() => resolveImagePreviewFrame(aspectRatio), [aspectRatio]);
  const alignClass = previewFrame.preset === "portrait" ? "object-top" : "object-center";

  return (
    <div
      data-testid="chat-image-preview"
      data-preset={previewFrame.preset}
      className={cn(
        "relative overflow-hidden",
        variant === "user-media"
          ? `${USER_MEDIA_CARD_RADIUS_CLASS} bg-transparent`
          : "rounded-[14px] border border-border bg-surface"
      )}
      style={{
        width: `${previewFrame.width}px`,
        height: `${previewFrame.height}px`
      }}
    >
      <AuthenticatedAttachmentImage
        src={src}
        alt={alt}
        onLoad={(event) => {
          const naturalWidth = event.currentTarget.naturalWidth;
          const naturalHeight = event.currentTarget.naturalHeight;
          if (naturalWidth > 0 && naturalHeight > 0) {
            setAspectRatio(naturalWidth / naturalHeight);
          }
        }}
        className={cn(
          "h-full w-full object-cover transition-opacity",
          alignClass,
          pending && "opacity-50"
        )}
      />
    </div>
  );
}

function AttachmentStrip({
  chatId,
  attachments,
  className,
  compactBubble = false,
  variant = "default",
  onDocumentJobAccepted
}: {
  chatId?: string | null | undefined;
  attachments: ChatAttachment[];
  className?: string;
  compactBubble?: boolean;
  variant?: "default" | "user-media";
  onDocumentJobAccepted?: (() => void) | undefined;
}) {
  const t = useTranslations("chat");
  const [openImageId, setOpenImageId] = useState<string | null>(null);
  const resolveInlinePreviewUrl = useCallback(
    (att: ChatAttachment) => {
      if (att.unavailable === true || att.id.startsWith("local-") || !chatId) {
        return null;
      }
      return getAssistantAttachmentPreviewUrl({
        chatId,
        path: att.path,
        thumbnailStoragePath: att.thumbnailStoragePath,
        posterStoragePath: att.posterStoragePath,
        attachmentType: att.attachmentType
      });
    },
    [chatId]
  );
  const galleryImages = useMemo(
    () =>
      attachments
        .filter((att) => att.attachmentType === "image")
        .map((att) => {
          const isUnavailable = att.unavailable === true;
          const downloadUrl =
            isUnavailable || att.id.startsWith("local-") || !chatId || !att.path
              ? undefined
              : buildChatFileUrl({ chatId, storagePath: att.path, download: true });
          const fullUrl =
            isUnavailable || att.id.startsWith("local-") || !chatId || !att.path
              ? att.localPreviewUrl
              : buildChatFileUrl({ chatId, storagePath: att.path });
          return fullUrl
            ? {
                id: att.id,
                src: fullUrl,
                downloadUrl: downloadUrl ?? fullUrl,
                filename: att.originalFilename ?? undefined,
                alt: att.originalFilename ?? undefined
              }
            : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [attachments, chatId]
  );
  const previewableAssetKeys = useMemo(
    () =>
      new Set(
        attachments
          .filter(
            (attachment) =>
              attachment.attachmentType === "image" || attachment.attachmentType === "video"
          )
          .map((attachment) => getAttachmentAssetKey(attachment))
          .filter((assetKey): assetKey is string => assetKey !== null)
      ),
    [attachments]
  );
  const groupedAttachments = useMemo(() => {
    const visuals: ChatAttachment[] = [];
    const audio: ChatAttachment[] = [];
    const files: ChatAttachment[] = [];
    for (const attachment of attachments) {
      if (attachment.attachmentType === "image" || attachment.attachmentType === "video") {
        visuals.push(attachment);
        continue;
      }
      if (attachment.attachmentType === "audio" || attachment.attachmentType === "voice") {
        audio.push(attachment);
        continue;
      }
      if (shouldSuppressDuplicatePreviewableFile(attachment, previewableAssetKeys)) {
        continue;
      }
      files.push(attachment);
    }
    return { visuals, audio, files };
  }, [attachments, previewableAssetKeys]);
  if (attachments.length === 0) return null;

  const renderAttachment = (att: ChatAttachment) => {
    const isPending = att.processingStatus === "pending";
    const isFailed = att.processingStatus === "failed";
    const isUnavailable = att.unavailable === true;
    const progressLabel =
      isPending && typeof att.uploadProgressPercent === "number"
        ? `${String(att.uploadProgressPercent)}%`
        : null;
    const inlineUrl = resolveInlinePreviewUrl(att) ?? undefined;
    const externalDownloadUrl =
      typeof att.externalDownloadUrl === "string" && att.externalDownloadUrl.trim().length > 0
        ? att.externalDownloadUrl.trim()
        : null;
    const link = att.documentLink;
    const downloadUrl =
      externalDownloadUrl ??
      (isUnavailable || att.id.startsWith("local-") || !chatId || !att.path
        ? undefined
        : buildChatFileUrl({
            chatId,
            storagePath: att.path,
            download: true,
            versionId: link?.documentType === "workspace_document" ? link.versionId : null
          }));
    const previewUrl = att.localPreviewUrl ?? inlineUrl;
    const documentLabel = (() => {
      if (!link) return null;
      return typeof link.versionNumber === "number" ? `v${link.versionNumber}` : null;
    })();

    if (att.attachmentType === "image") {
      const fullUrl =
        isUnavailable || att.id.startsWith("local-") || !chatId || !att.path
          ? previewUrl
          : buildChatFileUrl({ chatId, storagePath: att.path });
      return (
        <div key={att.id} className="relative self-start">
          {previewUrl ? (
            <button
              type="button"
              onClick={() => fullUrl && setOpenImageId(att.id)}
              disabled={!fullUrl}
              className={cn("block transition focus:ring-2 focus:ring-accent focus:outline-none")}
            >
              <ImageAttachmentPreview
                src={previewUrl}
                alt={att.originalFilename ?? "image"}
                pending={isPending}
                variant={variant}
              />
            </button>
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-surface-raised">
              <FileText className="h-6 w-6 text-text-subtle" />
            </div>
          )}
          {fullUrl && (
            <ImageLightbox
              open={openImageId === att.id}
              src={fullUrl}
              downloadUrl={downloadUrl ?? fullUrl}
              filename={att.originalFilename ?? undefined}
              alt={att.originalFilename ?? undefined}
              galleryItems={galleryImages.map((image) => ({
                src: image.src,
                downloadUrl: image.downloadUrl,
                filename: image.filename,
                alt: image.alt
              }))}
              currentIndex={galleryImages.findIndex((image) => image.id === att.id)}
              onNavigate={(nextIndex) => setOpenImageId(galleryImages[nextIndex]?.id ?? null)}
              onClose={() => setOpenImageId(null)}
            />
          )}
          {isPending && (
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px]",
                variant === "user-media" ? USER_MEDIA_CARD_RADIUS_CLASS : "rounded-lg"
              )}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised/85 px-2 py-1 text-[10px] font-medium text-text-muted shadow-sm">
                <Loader2 className="h-3 w-3 animate-spin text-accent" />
                {progressLabel}
              </span>
            </div>
          )}
          {isFailed && (
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center bg-destructive/10",
                variant === "user-media" ? USER_MEDIA_CARD_RADIUS_CLASS : "rounded-lg"
              )}
            >
              <span className="text-[10px] font-medium text-destructive">{t("uploadFailed")}</span>
            </div>
          )}
        </div>
      );
    }

    if (att.attachmentType === "audio" || att.attachmentType === "voice") {
      const audioSrc = previewUrl ?? inlineUrl;
      return (
        <div
          key={att.id}
          className={cn(
            "w-full max-w-[min(100%,320px)]",
            isPending && audioSrc && "opacity-80",
            variant === "user-media" && "rounded-lg p-1"
          )}
        >
          {audioSrc ? (
            <VoiceMessagePlayer src={audioSrc} />
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span className="truncate">{att.originalFilename ?? "Audio"}</span>
              {progressLabel ? <span className="text-text-subtle">{progressLabel}</span> : null}
            </div>
          )}
        </div>
      );
    }

    if (att.attachmentType === "video") {
      if (!att.path && externalDownloadUrl) {
        return (
          <a
            key={att.id}
            href={externalDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(CHAT_FILE_PILL_SURFACE_CLASS, CHAT_FILE_PILL_SURFACE_HOVER_CLASS)}
          >
            <span className={CHAT_FILE_PILL_BADGE_CLASS}>VIDEO</span>
            <span className={CHAT_FILE_PILL_FILENAME_CLASS}>
              {att.originalFilename ?? t("externalVideoDefaultName")}
            </span>
            <span className={CHAT_FILE_PILL_META_CLASS}>
              {formatBytes(att.sizeBytes)} · {t("externalVideoDownload")}
            </span>
          </a>
        );
      }

      const fullUrl =
        isUnavailable || att.id.startsWith("local-") || !chatId || !att.path
          ? null
          : buildChatFileUrl({ chatId, storagePath: att.path });
      return (
        <VideoAttachmentPreview
          key={att.id}
          variant={variant}
          fullUrl={fullUrl ?? null}
          previewUrl={previewUrl ?? null}
          downloadUrl={downloadUrl ?? fullUrl ?? undefined}
          filename={att.originalFilename ?? undefined}
          isPending={isPending}
          progressLabel={progressLabel}
          isLightboxOpen={openImageId === att.id}
          onOpen={() => setOpenImageId(att.id)}
          onClose={() => setOpenImageId(null)}
        />
      );
    }

    const fileContent = (
      <>
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-text-subtle" />
        ) : isUnavailable ? (
          <FileText className="h-3.5 w-3.5 text-text-subtle" />
        ) : (
          <span className={CHAT_FILE_PILL_BADGE_CLASS}>{attachmentTypeBadge(att)}</span>
        )}
        <span className={CHAT_FILE_PILL_FILENAME_CLASS}>{att.originalFilename ?? "File"}</span>
        <span className={CHAT_FILE_PILL_META_CLASS}>
          {isUnavailable ? t("fileDeleted") : (progressLabel ?? formatBytes(att.sizeBytes))}
        </span>
        {documentLabel ? (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-border/70 bg-bg/70 px-1.5 py-0.5 text-[10px] font-medium text-text-subtle">
            {documentLabel}
          </span>
        ) : null}
      </>
    );
    const isPresentationAttachment =
      (link?.documentType === "presentation" || link?.descriptorMode === "create_presentation") &&
      (att.mimeType === "application/pdf" ||
        (att.originalFilename ?? "").toLowerCase().endsWith(".pdf"));
    const pptxPrepareUrl =
      isPresentationAttachment && typeof link?.docId === "string"
        ? getAssistantDocumentPptxPrepareUrl(link.docId, { versionId: link.versionId })
        : null;

    if (!downloadUrl) {
      return (
        <div
          key={att.id}
          aria-disabled="true"
          className={cn(CHAT_FILE_PILL_SURFACE_CLASS, "opacity-55")}
        >
          {fileContent}
        </div>
      );
    }

    if (pptxPrepareUrl !== null) {
      // PDF is the primary deliverable; PPTX is explicitly prepared as a
      // second Gamma render only when the user asks for it from the quiet
      // action below the banner.
      return (
        <div key={att.id} className="flex flex-col items-start">
          <a
            href={downloadUrl}
            download={att.originalFilename ?? undefined}
            className={cn(CHAT_FILE_PILL_SURFACE_CLASS, CHAT_FILE_PILL_SURFACE_HOVER_CLASS)}
          >
            {fileContent}
          </a>
          <PresentationPptxPrepareAction
            href={pptxPrepareUrl}
            filename={att.originalFilename}
            onAccepted={onDocumentJobAccepted}
          />
        </div>
      );
    }

    return (
      <a
        key={att.id}
        href={downloadUrl}
        download={att.originalFilename ?? undefined}
        className={cn(CHAT_FILE_PILL_SURFACE_CLASS, CHAT_FILE_PILL_SURFACE_HOVER_CLASS)}
      >
        {fileContent}
      </a>
    );
  };

  return (
    <div
      data-testid="attachment-strip"
      className={cn(
        "mt-3 flex min-w-0 flex-col gap-2.5",
        compactBubble ? "w-auto max-w-full self-start" : "w-full",
        className
      )}
    >
      {groupedAttachments.visuals.length > 0 ? (
        <div
          data-testid="attachment-strip-visuals"
          className="flex min-w-0 flex-wrap items-start gap-2.5"
        >
          {groupedAttachments.visuals.map(renderAttachment)}
        </div>
      ) : null}
      {groupedAttachments.audio.length > 0 ? (
        <div
          data-testid="attachment-strip-audio"
          className="flex min-w-0 flex-col items-start gap-2.5"
        >
          {groupedAttachments.audio.map(renderAttachment)}
        </div>
      ) : null}
      {groupedAttachments.files.length > 0 ? (
        <div
          data-testid="attachment-strip-files"
          className="flex min-w-0 flex-col items-start gap-2"
        >
          {groupedAttachments.files.map(renderAttachment)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ADR-076 Section M — delay before showing the off-bubble `sending` spinner.
 *
 * Fast sends (commit < 250 ms) render no visual artifact at all; the optimistic
 * user bubble settles silently. Only when the request is still in flight
 * past this threshold does a small spinner fade in to the right of the
 * bubble. Lives locally inside `ChatMessageBubble` so neither `useChat` nor
 * the message status union needs to change.
 */
const SENDING_INDICATOR_DELAY_MS = 250;

export const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  chatId,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  showAssistantAvatar = false,
  onDoNotRemember,
  forgotten,
  onAssistantAction,
  onRetryPendingSend,
  onCancelPendingSend,
  onDocumentJobAccepted,
  preResponseStatus,
  showShadowRoutingLabel,
  backgroundWaitFooter
}: ChatMessageBubbleProps) {
  const t = useTranslations("chat");
  const tSend = useTranslations("send");
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" && message.role === "assistant";
  // ADR-158: non-live reattach uses reconciling — show a quiet wait cursor, not «Думаю».
  const isAssistantReconciling = message.role === "assistant" && message.status === "reconciling";
  const assistantSegments = useMemo(() => {
    if (message.role !== "assistant") {
      return { iterationBlocks: [], answerText: message.content };
    }
    // workingNotes is the structured multi-step field from the server (one entry
    // per tool-loop step); content is always the clean final answer.
    const workingNotes = Array.isArray(message.workingNotes)
      ? message.workingNotes.map((note) => note.trim()).filter((note) => note.length > 0)
      : [];
    const toolInvocations = Array.isArray(message.toolInvocations) ? message.toolInvocations : [];
    return {
      iterationBlocks: buildIterationBlocks(workingNotes, toolInvocations, {
        committed: message.status === "committed"
      }),
      answerText: message.content
    };
  }, [
    message.content,
    message.role,
    message.status,
    message.toolInvocations,
    message.workingNotes
  ]);
  const hasVisibleAnswerText = assistantSegments.answerText.trim().length > 0;
  const isStreamingTextActive = message.streamingTextActive === true;
  const showInlineStreamingStatus =
    isStreaming && preResponseStatus !== undefined && !isStreamingTextActive;
  const showCursorOnlyStatus =
    isStreaming && (preResponseStatus === undefined || isStreamingTextActive);
  const isUserSending =
    isUser && (message.status === "sending" || message.status === "reconciling");
  const isUserSendFailed = isUser && message.status.startsWith("send_failed");
  const hasUserAttachments = isUser && (message.attachments?.length ?? 0) > 0;
  const hasUserVisualAttachments =
    isUser &&
    (message.attachments?.some(
      (attachment) =>
        attachment.attachmentType === "image" ||
        attachment.attachmentType === "video" ||
        attachment.attachmentType === "audio" ||
        attachment.attachmentType === "voice"
    ) ??
      false);
  const hideUserVoiceTranscript = isUser && userMessageHasVoiceAttachment(message.attachments);
  // FIX 3 — when a user sends only attachments, the composer fills `content`
  // with the canonical placeholder so the API contract stays satisfied. The
  // bubble must not echo that placeholder back as visible text — the
  // attachment strip below already conveys what was sent.
  const hideUserTextForAttachmentsOnly =
    isUser &&
    (message.attachments?.length ?? 0) > 0 &&
    isAttachmentsOnlyPlaceholderText(message.content);
  const hasUserCaption =
    isUser &&
    !hideUserVoiceTranscript &&
    !hideUserTextForAttachmentsOnly &&
    message.content.trim().length > 0;

  // ADR-076 Section M — arm the short delay only while the bubble is in
  // `sending`. Any status change (committed / send_failed) clears the timer
  // and removes the spinner immediately, so a fast-path commit produces no
  // visible artifact and a pre-1 s failure flows straight to the existing
  // `Not delivered` block without a spinner flash.
  const [showSendingIndicator, setShowSendingIndicator] = useState(false);
  useEffect(() => {
    if (!isUserSending || hasUserAttachments) {
      setShowSendingIndicator(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowSendingIndicator(true);
    }, SENDING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasUserAttachments, isUserSending]);

  if (message.platformNotice?.kind === "safety_inbound_warn") {
    return null;
  }

  return (
    <div
      className={cn(
        "group relative flex py-2 md:py-3",
        isUser ? "items-center justify-end pb-4 md:pb-5" : "justify-start"
      )}
    >
      {!isUser && showAssistantAvatar ? (
        <AssistantAvatar
          avatarUrl={assistantAvatarUrl}
          avatarEmoji={assistantAvatarEmoji}
          size="sm"
          className="absolute top-3 -left-11"
        />
      ) : null}

      <div
        className={cn(
          "min-w-0",
          isUser
            ? cn(
                "flex max-w-[92%] flex-col items-end gap-2 sm:max-w-[85%] md:max-w-[75%]",
                hideUserVoiceTranscript && "w-[min(100%,320px)] max-w-[min(100%,320px)]"
              )
            : "w-full flex-1"
        )}
      >
        {isUser ? (
          <>
            {hasUserAttachments && hasUserVisualAttachments ? (
              <div className="flex w-full flex-col items-end gap-2">
                <div
                  className={cn(
                    "inline-flex min-w-0 max-w-[min(100%,28rem)] flex-col overflow-hidden bg-accent/15 p-1 text-text",
                    USER_MEDIA_BUBBLE_RADIUS_CLASS,
                    isUserSendFailed && "opacity-80"
                  )}
                >
                  <AttachmentStrip
                    chatId={chatId}
                    attachments={message.attachments ?? []}
                    compactBubble
                    variant="user-media"
                    className="mt-0 gap-1.5"
                    onDocumentJobAccepted={onDocumentJobAccepted}
                  />
                </div>
                {hasUserCaption ? (
                  <div
                    className={cn(
                      "min-w-0 max-w-[min(100%,22rem)] rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-text md:px-4 md:py-2.5",
                      isUserSendFailed && "opacity-80"
                    )}
                  >
                    <p className="max-w-full whitespace-pre-wrap text-left text-sm leading-relaxed break-words">
                      {message.content}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className={cn(
                  "min-w-0 max-w-full rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-text md:px-4 md:py-2.5",
                  hasUserAttachments && "inline-flex w-fit max-w-[min(100%,20rem)] flex-col",
                  isUserSendFailed && "opacity-80"
                )}
              >
                {!hideUserVoiceTranscript && !hideUserTextForAttachmentsOnly && (
                  <p className="max-w-full whitespace-pre-wrap text-sm leading-relaxed break-words text-left">
                    {message.content}
                  </p>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <AttachmentStrip
                    chatId={chatId}
                    attachments={message.attachments}
                    compactBubble
                    className={cn(
                      hideUserVoiceTranscript || hideUserTextForAttachmentsOnly ? "mt-0" : "mt-2"
                    )}
                    onDocumentJobAccepted={onDocumentJobAccepted}
                  />
                )}
              </div>
            )}
            {isUserSendFailed && (
              <div
                role="group"
                aria-label={tSend("failedShort")}
                className="flex items-center gap-2 px-1 text-[11px] leading-none text-text-subtle"
              >
                <span className="flex items-center gap-1.5 text-destructive/85">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-destructive/80"
                  />
                  <span>
                    {message.status === "send_failed_unconfirmed"
                      ? tSend("failedUnconfirmed")
                      : message.status === "send_failed_confirmed"
                        ? tSend("failedConfirmed")
                        : tSend("failedShort")}
                  </span>
                </span>
                {onRetryPendingSend ? (
                  <>
                    <span aria-hidden="true" className="text-border-strong">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={onRetryPendingSend}
                      className="cursor-pointer font-medium text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
                    >
                      {tSend("retry")}
                    </button>
                  </>
                ) : null}
                {onCancelPendingSend ? (
                  <>
                    <span aria-hidden="true" className="text-border-strong">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={onCancelPendingSend}
                      className="cursor-pointer text-text-subtle underline-offset-4 transition-colors hover:text-text hover:underline"
                    >
                      {tSend("cancel")}
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="prose-invert min-w-0 max-w-full text-sm break-words text-text [overflow-wrap:anywhere]">
            <ThoughtBlock message={message} />
            <IterationBlocks blocks={assistantSegments.iterationBlocks} />
            {isStreaming ? (
              <>
                {hasVisibleAnswerText ? (
                  <StreamingMarkdownMessageContent
                    content={assistantSegments.answerText}
                    onAction={onAssistantAction}
                  />
                ) : null}
                {(showInlineStreamingStatus || showCursorOnlyStatus) && (
                  <div className="mt-2 flex items-center gap-2">
                    {showInlineStreamingStatus ? (
                      <InlineStreamingStatus
                        preResponseStatus={preResponseStatus}
                        showShadowRoutingLabel={showShadowRoutingLabel}
                      />
                    ) : null}
                    {!showInlineStreamingStatus ? (
                      <span
                        aria-hidden="true"
                        data-testid="streaming-cursor"
                        className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-middle"
                      />
                    ) : null}
                  </div>
                )}
              </>
            ) : isAssistantReconciling ? (
              <>
                {hasVisibleAnswerText ? (
                  <MarkdownMessageContent
                    content={assistantSegments.answerText}
                    onAction={onAssistantAction}
                  />
                ) : null}
                {!hasVisibleAnswerText ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      data-testid="reconciling-cursor"
                      className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/45 align-middle"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <MarkdownMessageContent
                content={assistantSegments.answerText}
                onAction={onAssistantAction}
              />
            )}
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentStrip
                chatId={chatId}
                attachments={message.attachments}
                onDocumentJobAccepted={onDocumentJobAccepted}
              />
            )}
            {backgroundWaitFooter !== undefined &&
            backgroundWaitFooter !== null &&
            backgroundWaitFooter.length > 0 ? (
              <p
                role="status"
                aria-live="polite"
                data-testid="background-wait-footer"
                className="mt-2 text-sm text-text-muted italic"
              >
                {backgroundWaitFooter}
              </p>
            ) : null}
          </div>
        )}

        {/* Message actions (assistant only, on hover) */}
        {!isUser && message.status === "committed" && message.content.length > 0 && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
            {forgotten ? (
              <span className="rounded-md p-1.5 text-text-subtle/40" title={t("wontRemember")}>
                <EyeOff className="h-3.5 w-3.5" />
              </span>
            ) : onDoNotRemember ? (
              <button
                type="button"
                onClick={() => onDoNotRemember(message.id)}
                className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
                title={t("dontRemember")}
              >
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title={t("regenerate")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title={t("helpful")}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title={t("notHelpful")}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ADR-076 Section M — quiet, off-bubble pending-send indicator. The
          motion.div animates its own width so the user bubble naturally
          shifts left as the spinner enters; AnimatePresence ties the exit
          animation to the same path on commit / pre-headers failure. */}
      {isUser && (
        <AnimatePresence initial={false}>
          {showSendingIndicator && (
            <motion.div
              key="sending-indicator"
              data-testid="message-sending-indicator"
              role="status"
              aria-label={message.status === "reconciling" ? tSend("checking") : tSend("sending")}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 22, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex shrink-0 items-center justify-end overflow-hidden"
            >
              <Loader2 className="h-3 w-3 animate-spin text-text-subtle" aria-hidden="true" />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
});
